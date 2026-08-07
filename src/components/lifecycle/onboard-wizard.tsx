"use client";

import { useState } from "react";
import type { StepEvent } from "@/lib/lifecycle";
import { StepList, readPipelineStream, upsertStep } from "./step-list";

type SkuOption = { skuId: string; label: string; remaining: number };
type GroupOption = { id: string; displayName: string };

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
  const [steps, setSteps] = useState<StepEvent[]>([]);
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

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="font-semibold">온보딩 — 신규 입사자</h2>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="이름">
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="홍길동"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="계정 ID">
          <div className="flex items-center gap-1">
            <input
              value={form.mailNickname}
              onChange={(e) => setForm({ ...form, mailNickname: e.target.value })}
              placeholder="hong.gd"
              className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
            />
            <span className="shrink-0 text-xs text-zinc-400">@{domain}</span>
          </div>
        </Field>
        <Field label="부서">
          <input
            value={form.department}
            onChange={(e) => setForm({ ...form, department: e.target.value })}
            placeholder="개발"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="직급">
          <input
            value={form.jobTitle}
            onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
            placeholder="사원"
            className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <Field label="라이선스" className="mt-4">
        <div className="flex flex-wrap gap-2">
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
              {s.label}
              <span className="ml-1 text-xs opacity-60">잔여 {s.remaining}</span>
            </CheckChip>
          ))}
        </div>
      </Field>

      <Field label="그룹" className="mt-3">
        <div className="flex flex-wrap gap-2">
          {groupOptions.length === 0 && (
            <span className="text-xs text-zinc-400">테넌트에 그룹이 없습니다</span>
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
      </Field>

      <button
        onClick={() => run()}
        disabled={!canSubmit}
        className="mt-5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-40"
      >
        {running ? "실행 중…" : "온보딩 실행"}
      </button>

      <StepList steps={steps} />

      {result && !result.ok && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>
            실패: {result.error ?? `${result.failedStep} 단계에서 중단되었습니다`}
          </p>
          <div className="mt-2 flex gap-2">
            {result.failedStep && (
              <button
                onClick={() => run(result.failedStep!)}
                disabled={running}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
              >
                실패 단계부터 재시도
              </button>
            )}
            <button
              onClick={resetWizard}
              disabled={running}
              className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100"
            >
              처음부터 새로 시작
            </button>
          </div>
        </div>
      )}

      {/* 계정이 생성됐다면 성공 여부와 무관하게 비밀번호를 보여준다 — 유실 방지 */}
      {result?.tempPassword && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
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
              className="ml-2 rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-500"
            >
              {copied ? "복사됨" : "복사"}
            </button>
          </p>
          <p className="mt-1 text-xs text-emerald-600">
            이 비밀번호는 지금만 표시됩니다. 첫 로그인 시 변경이 강제됩니다.
          </p>
        </div>
      )}
    </div>
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
      <span className="mb-1 block text-xs font-medium text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

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
      className={`rounded-full border px-3 py-1 text-sm transition ${
        checked
          ? "border-zinc-900 bg-zinc-900 text-white"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}
