"use client";

import type { StepEvent } from "@/lib/lifecycle";
import { Badge, type BadgeTone } from "@/components/ui";

// 파이프라인 단계 표시 — 목업 규격 정렬(번호 원형 24px, 제목/설명/시각/상태 배지,
// 실패 행에 오류 메시지 + "이 단계부터 재시도" 버튼). 표현 전용 계층이다.

/** 표시용 단계 이벤트 — 서버 이벤트에 클라이언트 도착 시각(KST)만 덧붙인다 */
export type UiStepEvent = StepEvent & { at?: string };

const STATUS_BADGE: Record<
  StepEvent["status"],
  { label: string; tone: BadgeTone }
> = {
  running: { label: "진행 중", tone: "info" },
  ok: { label: "완료", tone: "success" },
  error: { label: "실패", tone: "danger" },
  skipped: { label: "건너뜀", tone: "neutral" },
};

/** 단계별 고정 설명 — 목업의 설명 행 대응 (라벨·결과 메시지는 서버 이벤트가 준다) */
const STEP_DESC: Record<string, string> = {
  create_user: "Entra ID 계정 생성 · 임시 비밀번호 발급",
  assign_license: "선택한 라이선스 할당",
  add_groups: "선택한 그룹 배정",
  block_signin: "로그인 차단 (accountEnabled=false)",
  revoke_sessions: "모든 리프레시 토큰 무효화",
  reclaim_licenses: "할당된 라이선스 회수",
  remove_groups: "소속 그룹에서 제거 (동적 그룹은 건너뜀)",
};

export function StepList({
  steps,
  retryStep,
  onRetry,
  retrying = false,
}: {
  steps: UiStepEvent[];
  /** 실패로 확정된 단계 키 — 해당 행에 재시도 버튼을 붙인다 */
  retryStep?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (steps.length === 0) return null;
  return (
    <ol className="mt-4 flex flex-col gap-1.5">
      {steps.map((s, i) => {
        const badge = STATUS_BADGE[s.status];
        const desc = [STEP_DESC[s.key], s.status === "ok" ? s.message : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <li
            key={s.key}
            className="flex gap-3 rounded-lg border border-fill px-3 py-2.5"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fill text-xs font-semibold text-ink-secondary">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p
                  className={`text-[13px] font-medium ${
                    s.status === "skipped" ? "text-ink-muted" : ""
                  }`}
                >
                  {s.label}
                </p>
                <span className="flex shrink-0 items-center gap-2">
                  {s.at && (
                    <span className="text-[11px] text-ink-muted">{s.at}</span>
                  )}
                  <Badge
                    tone={badge.tone}
                    className={s.status === "running" ? "animate-pulse" : ""}
                  >
                    {badge.label}
                  </Badge>
                </span>
              </div>
              {desc && <p className="mt-0.5 text-xs text-ink-muted">{desc}</p>}
              {s.status === "error" && s.message && (
                <p className="mt-1.5 text-xs text-red-600">{s.message}</p>
              )}
              {s.key === retryStep && onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  disabled={retrying}
                  className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 transition hover:bg-amber-100 disabled:opacity-40"
                >
                  이 단계부터 재시도
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** 단계 완료(성공/실패) 도착 시각 — 목업의 시각 표기 (KST HH:mm:ss) */
function nowKstTime(): string {
  return new Date().toLocaleTimeString("ko-KR", {
    timeZone: "Asia/Seoul",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * 단계 이벤트를 목록에 반영 — 제자리 갱신으로 순서를 유지하고,
 * 재시도의 skipped 이벤트가 이전 실행의 ok 기록을 덮어쓰지 않게 한다.
 * 완료(성공/실패) 이벤트에는 도착 시각을 덧붙인다 (표시 전용).
 */
export function upsertStep(prev: UiStepEvent[], e: StepEvent): UiStepEvent[] {
  const stamped: UiStepEvent =
    e.status === "ok" || e.status === "error" ? { ...e, at: nowKstTime() } : e;
  const i = prev.findIndex((p) => p.key === e.key);
  if (i < 0) return [...prev, stamped];
  if (e.status === "skipped" && prev[i].status === "ok") return prev;
  const next = [...prev];
  next[i] = stamped;
  return next;
}

/** NDJSON 스트림을 읽어 단계 이벤트를 콜백으로 전달한다 */
export async function readPipelineStream(
  res: Response,
  onStep: (e: StepEvent) => void,
  onDone: (final: Record<string, unknown>) => void,
) {
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
      const obj = JSON.parse(line);
      if (obj.done) onDone(obj);
      else onStep(obj as StepEvent);
    }
  }
}
