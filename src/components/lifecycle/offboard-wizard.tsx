"use client";

import { useState } from "react";
import type { StepEvent } from "@/lib/lifecycle";
import { StepList, readPipelineStream, upsertStep } from "./step-list";

type TargetUser = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  department: string | null;
  licenseCount: number;
};

export function OffboardWizard({ users }: { users: TargetUser[] }) {
  const [targetId, setTargetId] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [result, setResult] = useState<{
    ok: boolean;
    failedStep?: string | null;
    error?: string;
  } | null>(null);

  const target = users.find((u) => u.id === targetId);

  async function run(resumeFrom?: string) {
    if (!target) return;
    setRunning(true);
    setResult(null);
    if (!resumeFrom) setSteps([]);
    try {
      const res = await fetch("/api/lifecycle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "offboard",
          targetUserId: target.id,
          resumeFrom,
        }),
      });
      if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
      await readPipelineStream(
        res,
        (e) => setSteps((prev) => upsertStep(prev, e)),
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
      <h2 className="font-semibold">오프보딩 — 퇴사 처리</h2>
      <p className="mt-1 text-xs text-zinc-400">
        로그인 차단 → 세션 철회 → 라이선스 회수 → 그룹 제거를 순서대로 실행합니다.
      </p>

      <select
        value={targetId}
        onChange={(e) => {
          setTargetId(e.target.value);
          setConfirmed(false);
          setSteps([]);
          setResult(null);
        }}
        className="mt-4 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
      >
        <option value="">대상 선택…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.displayName} ({u.userPrincipalName})
          </option>
        ))}
      </select>

      {target && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
          <p className="font-medium text-red-700">실행 전 확인</p>
          <ul className="mt-2 space-y-0.5 text-red-600">
            <li>대상: {target.displayName} ({target.userPrincipalName})</li>
            <li>부서: {target.department ?? "—"}</li>
            <li>회수될 라이선스: {target.licenseCount}개</li>
          </ul>
          <label className="mt-3 flex items-center gap-2 text-red-700">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            위 사용자를 오프보딩하는 것을 확인했습니다
          </label>
          <button
            onClick={() => run()}
            disabled={!confirmed || running}
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
          >
            {running ? "실행 중…" : "오프보딩 실행"}
          </button>
        </div>
      )}

      <StepList steps={steps} />

      {result && !result.ok && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <p>
            실패: {result.error ?? `${result.failedStep} 단계에서 중단되었습니다`}
          </p>
          {result.failedStep && (
            <button
              onClick={() => run(result.failedStep!)}
              disabled={running}
              className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500"
            >
              실패 단계부터 재시도
            </button>
          )}
        </div>
      )}

      {result?.ok && (
        <div className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          오프보딩 완료 — 모든 단계가 성공했습니다
        </div>
      )}
    </div>
  );
}
