"use client";

import { useEffect, useRef, useState } from "react";
import {
  approveAssistantRequest,
  rejectAssistantRequest,
} from "@/app/(app)/assistant/actions";

// AI 어시스턴트 채팅. NDJSON 스트림 소비는 온보딩 마법사(readPipelineStream)와
// 같은 버퍼-분할 패턴, 단 단계 upsert 대신 텍스트 델타 append로 변형했다.
//
// 대화 이력은 Anthropic 원본 블록(rawHistory)을 그대로 보관해 다음 요청에
// 되돌려 보낸다 — thinking/tool_use 블록을 편집하면 API가 거부하므로 불투명하게 다룬다.
// 스트림이 중단되면 이력 끝의 미완결 tool_use를 롤백해(repairHistory) 다음 요청이
// tool_result 페어링 400으로 죽지 않게 한다.

type ApprovalCardStatus =
  | "pending"
  | "executing"
  | "executed"
  | "failed"
  | "rejected"
  | "expired";

type ChatItem =
  | { kind: "user"; id: number; text: string }
  | { kind: "assistant"; id: number; text: string; streaming: boolean }
  | {
      kind: "tool";
      id: number;
      name: string;
      status: "run" | "ok" | "error";
      brief?: string;
    }
  | {
      kind: "approval";
      id: number;
      requestId: string;
      toolName: string;
      summary: string;
      input: unknown;
      status: ApprovalCardStatus;
      /** 만료 시각(ISO) — 카운트 표시 전용, 만료 판정의 진실은 서버 */
      expiresAt?: string;
      resultText?: string;
      tempPassword?: string;
      error?: string;
      warning?: string;
    }
  | { kind: "error"; id: number; text: string }
  | { kind: "notice"; id: number; text: string };

type Role = "admin" | "manager" | "employee";

// 추천 프롬프트 칩 — 클릭 시 입력창만 채운다 (자동 전송 없음).
// R5.1: employee/manager는 본인 조회 도구 3종에 맞는 질문을 제안한다
const PROMPT_CHIPS: Record<"admin" | "member", string[]> = {
  // admin 3종은 목업 규격 유지 (연차 신청·오프보딩 상태·감사 로그 요약)
  admin: [
    "다음 주 금요일 연차 신청해줘",
    "박태호 오프보딩 상태 알려줘",
    "이번 달 감사 로그 요약해줘",
  ],
  member: [
    "내 연차 며칠 남았어?",
    "이번 주 내 근무시간 알려줘",
    "내 기안 결재 어디까지 갔어?",
  ],
};

/** 서버 에러 코드 → 사용자 안내문 */
const ERROR_LABELS: Record<string, string> = {
  TOO_MANY_MESSAGES:
    "대화가 너무 길어졌습니다. '새 대화'로 초기화한 뒤 이어서 질문하세요.",
  BODY_TOO_LARGE:
    "대화 내용이 너무 커졌습니다. '새 대화'로 초기화한 뒤 이어서 질문하세요.",
  INVALID_MESSAGES: "대화 이력이 손상되었습니다. '새 대화'로 초기화해 주세요.",
  FORBIDDEN: "세션이 만료되었거나 접근 권한이 없습니다. 다시 로그인해 주세요.",
  ANTHROPIC_API_KEY_MISSING: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다.",
};

let nextId = 1;
function newId() {
  return nextId++;
}

export function AssistantChat({
  initialPrompt,
  role,
}: {
  initialPrompt?: string;
  role: Role;
}) {
  const promptChips = PROMPT_CHIPS[role === "admin" ? "admin" : "member"];
  const [items, setItems] = useState<ChatItem[]>([]);
  // ?prompt= 프리필 — 서버(page)에서 받은 초기값으로 입력창만 채운다
  const [input, setInput] = useState(initialPrompt ?? "");
  const [busy, setBusy] = useState(false);
  const rawHistory = useRef<unknown[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // 사용자가 위로 스크롤해 읽는 중이면 끌어내리지 않는다 (하단 근처일 때만 추적)
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight });
  }, [items]);

  function patchItem(id: number, patch: Partial<ChatItem>) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? ({ ...it, ...patch } as ChatItem) : it)),
    );
  }

  /** 이력 끝이 tool_result 없는 tool_use로 끝나면 롤백 — 스트림 중단 복구 */
  function repairHistory() {
    const h = rawHistory.current;
    const last = h[h.length - 1] as
      | { role?: string; content?: unknown }
      | undefined;
    if (
      last?.role === "assistant" &&
      Array.isArray(last.content) &&
      (last.content as { type?: string }[]).some((b) => b.type === "tool_use")
    ) {
      h.pop();
    }
  }

  function resetConversation() {
    if (busy) return;
    rawHistory.current = [];
    setItems([]);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setInput("");
    setItems((prev) => [...prev, { kind: "user", id: newId(), text: trimmed }]);
    const historyLengthBeforeSend = rawHistory.current.length;
    rawHistory.current.push({ role: "user", content: trimmed });

    let assistantId: number | null = null;
    let lastToolId: number | null = null;
    let requestFailed = false;

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: rawHistory.current }),
      });
      if (!res.ok) {
        requestFailed = true;
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        const code = body?.error ?? "";
        throw new Error(ERROR_LABELS[code] ?? `요청 실패 (${res.status})`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("스트림을 읽을 수 없습니다");
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as Record<string, unknown>;

          if (ev.type === "delta" && typeof ev.text === "string") {
            if (assistantId === null) {
              const id = newId();
              assistantId = id;
              setItems((prev) => [
                ...prev,
                { kind: "assistant", id, text: ev.text as string, streaming: true },
              ]);
            } else {
              const id = assistantId;
              setItems((prev) =>
                prev.map((it) =>
                  it.id === id && it.kind === "assistant"
                    ? { ...it, text: it.text + (ev.text as string) }
                    : it,
                ),
              );
            }
          } else if (ev.type === "append") {
            rawHistory.current.push(ev.message);
            if (assistantId !== null) {
              patchItem(assistantId, { streaming: false } as Partial<ChatItem>);
              assistantId = null;
            }
          } else if (ev.type === "tool") {
            const id = newId();
            lastToolId = id;
            setItems((prev) => [
              ...prev,
              { kind: "tool", id, name: ev.name as string, status: "run" },
            ]);
          } else if (ev.type === "tool_done") {
            if (lastToolId !== null) {
              patchItem(lastToolId, {
                status: ev.ok ? "ok" : "error",
                brief: ev.brief as string,
              } as Partial<ChatItem>);
            }
          } else if (ev.type === "approval") {
            // 승인 카드 — tool 칩을 카드로 승격
            if (lastToolId !== null) {
              const toolId = lastToolId;
              setItems((prev) => prev.filter((it) => it.id !== toolId));
              lastToolId = null;
            }
            setItems((prev) => [
              ...prev,
              {
                kind: "approval",
                id: newId(),
                requestId: ev.requestId as string,
                toolName: ev.toolName as string,
                summary: ev.summary as string,
                input: ev.input,
                status: "pending",
                expiresAt:
                  typeof ev.expiresAt === "string" ? ev.expiresAt : undefined,
              },
            ]);
          } else if (ev.type === "warning" && ev.code === "AUDIT_WRITE_FAILED") {
            setItems((prev) => [
              ...prev,
              {
                kind: "notice",
                id: newId(),
                text: "경고: 감사 로그 기록에 실패했습니다 (AUDIT_WRITE_FAILED)",
              },
            ]);
          } else if (ev.done === true) {
            if (assistantId !== null) {
              patchItem(assistantId, { streaming: false } as Partial<ChatItem>);
              assistantId = null;
            }
            if (ev.ok === false) {
              setItems((prev) => [
                ...prev,
                { kind: "error", id: newId(), text: String(ev.error ?? "오류") },
              ]);
            }
          }
        }
      }
    } catch (e) {
      // 전송 자체가 거부된 경우(400 등) 방금 넣은 user 메시지를 되돌려
      // 재시도가 이력을 계속 불리지 않게 한다
      if (requestFailed) {
        rawHistory.current.length = historyLengthBeforeSend;
      }
      setItems((prev) => [
        ...prev,
        {
          kind: "error",
          id: newId(),
          text: e instanceof Error ? e.message : "알 수 없는 오류",
        },
      ]);
    } finally {
      repairHistory();
      if (assistantId !== null) {
        patchItem(assistantId, { streaming: false } as Partial<ChatItem>);
      }
      setBusy(false);
    }
  }

  async function approve(item: Extract<ChatItem, { kind: "approval" }>) {
    patchItem(item.id, { status: "executing" } as Partial<ChatItem>);
    try {
      const r = await approveAssistantRequest(item.requestId);
      if (r.ok) {
        patchItem(item.id, {
          status: "executed",
          resultText: JSON.stringify(r.result, null, 2),
          tempPassword: r.tempPassword,
          warning: r.warning,
        } as Partial<ChatItem>);
        // 다음 턴에서 모델이 실행 결과를 알 수 있게 이력에만 기록 (임시 비밀번호 제외)
        rawHistory.current.push({
          role: "user",
          content: `(시스템) 승인 요청 실행 완료 — ${item.summary}. 결과: ${JSON.stringify(r.result)}`,
        });
      } else {
        const expired = r.error.includes("만료");
        patchItem(item.id, {
          status: expired ? "expired" : "failed",
          error: r.error,
        } as Partial<ChatItem>);
        rawHistory.current.push({
          role: "user",
          content: `(시스템) 승인 요청 처리 실패 — ${item.summary}: ${r.error}`,
        });
      }
    } catch {
      patchItem(item.id, {
        status: "failed",
        error:
          "요청 처리 중 연결 오류가 발생했습니다. 실제 실행 여부는 감사 로그에서 확인하세요.",
      } as Partial<ChatItem>);
    }
  }

  async function reject(item: Extract<ChatItem, { kind: "approval" }>) {
    try {
      const r = await rejectAssistantRequest(item.requestId);
      if (r.ok) {
        patchItem(item.id, { status: "rejected" } as Partial<ChatItem>);
        rawHistory.current.push({
          role: "user",
          content: `(시스템) 승인 요청 거부됨 — ${item.summary}`,
        });
      } else {
        patchItem(item.id, {
          status: "failed",
          error: r.error,
        } as Partial<ChatItem>);
      }
    } catch {
      patchItem(item.id, {
        status: "failed",
        error: "요청 처리 중 연결 오류가 발생했습니다. 다시 시도해 주세요.",
      } as Partial<ChatItem>);
    }
  }

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col rounded-xl border border-zinc-200 bg-white">
      {items.length > 0 && (
        <div className="flex justify-end border-b border-zinc-100 px-3 py-1.5">
          <button
            type="button"
            onClick={resetConversation}
            disabled={busy}
            className="text-xs text-zinc-400 hover:text-zinc-600 disabled:opacity-40"
          >
            새 대화
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-4"
        style={{ minHeight: "20rem", maxHeight: "60vh" }}
      >
        {items.length === 0 && (
          <div className="py-10 text-center text-sm text-zinc-400">
            <p>
              무엇을 도와드릴까요? 아래 추천 프롬프트를 눌러 시작해 보세요 —
              조회는 즉시, 변경 작업은 승인 후 실행됩니다.
            </p>
          </div>
        )}
        {items.map((item) => (
          <ChatItemView
            key={item.id}
            item={item}
            busy={busy}
            onApprove={approve}
            onReject={reject}
          />
        ))}
        {busy && (
          <div className="text-xs text-zinc-400" aria-live="polite">
            어시스턴트가 응답 중…
          </div>
        )}
      </div>
      <div className="border-t border-zinc-200 p-3">
        {/* 추천 프롬프트 칩 — 클릭 시 입력창 채움 (목업 규격: 필 999 · 12px) */}
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {promptChips.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setInput(s);
                inputRef.current?.focus();
              }}
              disabled={busy}
              className="rounded-full border border-line px-3 py-1 text-xs text-ink-sub transition hover:border-ink-muted disabled:opacity-40"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder="예: 영업팀에서 최근 30일 미사용 계정 찾아줘"
          className="min-h-[3rem] flex-1 resize-none rounded-lg border border-zinc-200 px-3 py-2 text-sm focus:border-zinc-400 focus:outline-none"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
        >
          보내기
        </button>
        </form>
      </div>
    </div>
  );
}

function ChatItemView({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: ChatItem;
  busy: boolean;
  onApprove: (item: Extract<ChatItem, { kind: "approval" }>) => void;
  onReject: (item: Extract<ChatItem, { kind: "approval" }>) => void;
}) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-zinc-900 px-4 py-2 text-sm text-white">
          {item.text}
        </div>
      </div>
    );
  }
  if (item.kind === "assistant") {
    return (
      <div className="flex">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-800">
          {item.text}
          {item.streaming && <span className="animate-pulse">▍</span>}
        </div>
      </div>
    );
  }
  if (item.kind === "tool") {
    return (
      <div className="flex items-center gap-2 pl-1 text-xs text-zinc-500">
        <span
          className={
            item.status === "run"
              ? "inline-block h-2 w-2 animate-pulse rounded-full bg-zinc-400"
              : item.status === "ok"
                ? "inline-block h-2 w-2 rounded-full bg-emerald-500"
                : "inline-block h-2 w-2 rounded-full bg-red-500"
          }
        />
        <code className="font-mono">{item.name}</code>
        {item.status === "run" ? "실행 중…" : (item.brief ?? "")}
        {item.status === "error" && <span className="text-red-500">실패</span>}
      </div>
    );
  }
  if (item.kind === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
        {item.text}
      </div>
    );
  }
  if (item.kind === "notice") {
    return (
      <div className="rounded-lg bg-amber-50 px-4 py-2 text-xs text-amber-700">
        {item.text}
      </div>
    );
  }

  // 승인 카드 — 만료 카운트 훅이 필요해 별도 컴포넌트로 위임
  // (이 함수는 kind별 조기 return이 있어 훅을 직접 둘 수 없다)
  return (
    <ApprovalCardView
      item={item}
      busy={busy}
      onApprove={onApprove}
      onReject={onReject}
    />
  );
}

/** expiresAt(ISO) 기준 잔여 분 — 올림. 표시 전용이며 만료 판정의 진실은 서버 */
function remainingMinutes(expiresAt: string): number {
  return Math.ceil((Date.parse(expiresAt) - Date.now()) / 60_000);
}

/** B16: 잔여 분을 1분 단위로 갱신. pending이 아니면 타이머를 돌리지 않는다 */
function useRemainingMinutes(
  expiresAt: string | undefined,
  active: boolean,
): number | null {
  const [remaining, setRemaining] = useState<number | null>(() =>
    expiresAt ? remainingMinutes(expiresAt) : null,
  );
  useEffect(() => {
    // 초기값은 useState 지연 초기화가 계산 — 여기서는 1분 주기 갱신만 담당
    if (!expiresAt || !active) return;
    const timer = setInterval(
      () => setRemaining(remainingMinutes(expiresAt)),
      60_000,
    );
    return () => clearInterval(timer);
  }, [expiresAt, active]);
  return remaining;
}

function ApprovalCardView({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: Extract<ChatItem, { kind: "approval" }>;
  busy: boolean;
  onApprove: (item: Extract<ChatItem, { kind: "approval" }>) => void;
  onReject: (item: Extract<ChatItem, { kind: "approval" }>) => void;
}) {
  const remaining = useRemainingMinutes(
    item.expiresAt,
    item.status === "pending",
  );
  // UI상 만료 — 승인 버튼만 잠근다. 최종 만료 판정은 서버(canDecide)가 한다
  const uiExpired =
    item.status === "pending" && remaining !== null && remaining <= 0;

  const badge: Record<ApprovalCardStatus, { label: string; cls: string }> = {
    pending: { label: "승인 대기", cls: "bg-amber-100 text-amber-800" },
    executing: { label: "실행 중…", cls: "bg-zinc-100 text-zinc-600" },
    executed: { label: "실행 완료", cls: "bg-emerald-50 text-emerald-600" },
    failed: { label: "실패", cls: "bg-red-50 text-red-600" },
    rejected: { label: "거부됨", cls: "bg-zinc-100 text-zinc-500" },
    expired: { label: "만료됨", cls: "bg-zinc-100 text-zinc-500" },
  };
  const badgeStatus: ApprovalCardStatus = uiExpired ? "expired" : item.status;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-zinc-900">
          승인 필요: {item.summary}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge[badgeStatus].cls}`}
        >
          {badge[badgeStatus].label}
        </span>
      </div>
      <div className="mt-1 text-xs text-zinc-500">
        도구 <code className="font-mono">{item.toolName}</code> · 15분 내 승인
        필요 · 승인 전에는 실행되지 않습니다
      </div>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-white/70 p-2 text-xs text-zinc-600">
        {JSON.stringify(item.input, null, 2)}
      </pre>
      {item.status === "pending" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onApprove(item)}
            disabled={busy || uiExpired}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
          >
            승인하고 실행
          </button>
          <button
            type="button"
            onClick={() => onReject(item)}
            disabled={busy}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
          >
            거부
          </button>
          {/* B16: 만료 카운트 — 11px amber-700(#b45309), 1분 단위 갱신 */}
          {remaining !== null && (
            <span className="text-[11px] text-amber-700">
              {uiExpired
                ? "만료됨 — 새로 요청해 주세요"
                : `만료까지 ${remaining}분 — 만료된 요청은 실행할 수 없습니다`}
            </span>
          )}
          {busy && (
            <span className="text-xs text-zinc-400">응답 완료 후 결정할 수 있습니다</span>
          )}
        </div>
      )}
      {item.status === "executed" && item.resultText && (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">
          {item.resultText}
        </pre>
      )}
      {item.warning && (
        <div className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-800">
          {item.warning}
        </div>
      )}
      {item.tempPassword && (
        <div className="mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm">
          임시 비밀번호 (지금만 표시됩니다):{" "}
          <code className="font-mono font-semibold">{item.tempPassword}</code>
        </div>
      )}
      {item.status === "failed" && item.error && (
        <div className="mt-2 text-sm text-red-600">{item.error}</div>
      )}
      {item.status === "expired" && item.error && (
        <div className="mt-2 text-sm text-zinc-500">{item.error}</div>
      )}
    </div>
  );
}
