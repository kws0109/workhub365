"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import {
  StepList,
  readPipelineStream,
  upsertStep,
  type UiStepEvent,
} from "./step-list";

type SkuOption = { skuId: string; label: string; remaining: number };
type GroupOption = { id: string; displayName: string };

const INPUT_CLS =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] outline-none placeholder:text-ink-muted focus:border-line-strong";

export function OnboardWizard({
  domain,
  skuOptions,
  groupOptions,
}: {
  domain: string;
  skuOptions: SkuOption[];
  groupOptions: GroupOption[];
}) {
  const [form, setForm] = useState({
    displayName: "",
    mailNickname: "",
    department: "",
    jobTitle: "",
  });
  const [skuIds, setSkuIds] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<UiStepEvent[]>([]);
  const [result, setResult] = useState<{
    ok: boolean;
    failedStep?: string | null;
    tempPassword?: string;
    upn?: string;
    error?: string;
  } | null>(null);
  const [createdUserId, setCreatedUserId] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const params = { ...form, skuIds, groupIds };
  // 계정이 이미 생성된 부분 실패 상태에서 전체 재실행은 UPN 충돌로 반드시 실패한다
  const partialFailure = !!(result && !result.ok && createdUserId);
  const canSubmit =
    !running &&
    !partialFailure &&
    form.displayName.trim() &&
    /^[a-zA-Z0-9._-]+$/.test(form.mailNickname);

  function resetWizard() {
    setForm({ displayName: "", mailNickname: "", department: "", jobTitle: "" });
    setSkuIds([]);
    setGroupIds([]);
    setSteps([]);
    setResult(null);
    setCreatedUserId(undefined);
    setCopied(false);
  }

  async function run(resumeFrom?: string) {
    setRunning(true);
    setResult(null);
    if (!resumeFrom) {
      setSteps([]);
      setCreatedUserId(undefined);
    }
    try {
      const res = await fetch("/api/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "onboard",
          params,
          resumeFrom,
          createdUserId,
        }),
      });
      if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
      await readPipelineStream(
        res,
        (e) => {
          if (e.context?.createdUserId) setCreatedUserId(e.context.createdUserId);
          setSteps((prev) => upsertStep(prev, e));
        },
        (final) => setResult(final as typeof result),
      );
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "오류" });
    } finally {
      setRunning(false);
    }
  }

  const failedStepLabel = result?.failedStep
    ? (steps.find((s) => s.key === result.failedStep)?.label ??
      result.failedStep)
    : null;

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">온보딩 — 새 구성원</h2>
        <span className="text-xs text-ink-muted">
          계정 생성 → 라이선스 → 그룹 배정
        </span>
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="이름">
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="홍길동"
            className={INPUT_CLS}
          />
        </Field>
        <Field label="이메일 (계정 ID)">
          <div className="flex items-center gap-1.5">
            <input
              value={form.mailNickname}
              onChange={(e) => setForm({ ...form, mailNickname: e.target.value })}
              placeholder="hong.gd"
              className={INPUT_CLS}
            />
            <span className="shrink-0 text-xs text-ink-muted">@{domain}</span>
          </div>
        </Field>
        <Field label="부서">
          <input
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
            placeholder="개발"
            className={INPUT_CLS}
          />
        </Field>
        <Field label="직급">
          <input
            value={form.jobTitle}
            onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
            placeholder="사원"
            className={INPUT_CLS}
          />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-1 text-xs font-medium text-ink-secondary">
            임시 비밀번호
          </p>
          <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-ink-muted">
            생성 후 1회만 표시 — DB·감사 로그에 저장하지 않음
          </p>
        </div>
      </div>

      <div className="mt-3.5">
        <p className="mb-1.5 text-xs font-medium text-ink-secondary">
          라이선스 (잔여 좌석)
        </p>
        <div className="flex flex-wrap gap-1.5">
          {skuOptions.map((s) => (
            <CheckChip
              key={s.skuId}
              checked={skuIds.includes(s.skuId)}
              disabled={s.remaining <= 0 && !skuIds.includes(s.skuId)}
              onToggle={() =>
                setSkuIds((prev) =>
                  prev.includes(s.skuId)
                    ? prev.filter((x) => x !== s.skuId)
                    : [...prev, s.skuId],
                )
              }
            >
              {s.label} · 잔여 {s.remaining}
            </CheckChip>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-1.5 text-xs font-medium text-ink-secondary">그룹</p>
        <div className="flex flex-wrap gap-1.5">
          {groupOptions.length === 0 && (
            <span className="text-xs text-ink-muted">
              테넌트에 그룹이 없습니다
            </span>
          )}
          {groupOptions.map((gr) => (
            <CheckChip
              key={gr.id}
              checked={groupIds.includes(gr.id)}
              onToggle={() =>
                setGroupIds((prev) =>
                  prev.includes(gr.id)
                    ? prev.filter((x) => x !== gr.id)
                    : [...prev, gr.id],
                )
              }
            >
              {gr.displayName}
            </CheckChip>
          ))}
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          onClick={() => run()}
          disabled={!canSubmit}
          className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-ink-body disabled:opacity-40"
        >
          {running ? "실행 중…" : "계정 생성 시작"}
        </button>
      </div>

      <StepList
        steps={steps}
        retryStep={
          !running && result && !result.ok
            ? (result.failedStep ?? undefined)
            : undefined
        }
        onRetry={
          result?.failedStep ? () => run(result.failedStep!) : undefined
        }
        retrying={running}
      />

      {result && !result.ok && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          <p>
            실패:{" "}
            {result.error ?? `${failedStepLabel} 단계에서 중단되었습니다`}
          </p>
          <button
            onClick={resetWizard}
            disabled={running}
            className="mt-2 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-100 disabled:opacity-40"
          >
            처음부터 새로 시작
          </button>
        </div>
      )}

      {/* 계정이 생성됐다면 성공 여부와 무관하게 비밀번호를 보여준다 — 유실 방지 */}
      {result?.tempPassword && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px]">
          <p className="font-medium text-emerald-700">
            {result.ok ? "온보딩 완료" : "계정은 생성됨"} — {result.upn}
          </p>
          <p className="mt-1 text-emerald-700">
            임시 비밀번호:{" "}
            <code className="rounded bg-white px-2 py-0.5 font-mono">
              {result.tempPassword}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(result.tempPassword!);
                setCopied(true);
              }}
              className="ml-2 rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white transition hover:bg-emerald-700"
            >
              {copied ? "복사됨" : "복사"}
            </button>
          </p>
          <p className="mt-1 text-xs text-emerald-600">
            이 비밀번호는 지금만 표시됩니다. 첫 로그인 시 변경이 강제됩니다.
          </p>
        </div>
      )}
    </Card>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-ink-secondary">
        {label}
      </span>
      {children}
    </label>
  );
}

/** 선택 칩 — 목업 규격: 필 999, 선택 시 ink 반전, 미선택 hover 보더 강조 */
function CheckChip({
  checked,
  disabled,
  onToggle,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`rounded-full border px-3 py-[5px] text-xs font-medium transition ${
        checked
          ? "border-ink bg-ink text-white"
          : "border-line bg-surface text-ink-sub hover:border-ink-muted"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
