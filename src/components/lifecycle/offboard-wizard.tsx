"use client";

import Link from "next/link";
import { useState } from "react";
import { Card } from "@/components/ui";
import {
  StepList,
  readPipelineStream,
  upsertStep,
  type UiStepEvent,
} from "./step-list";

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
  const [steps, setSteps] = useState<UiStepEvent[]>([]);
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
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">오프보딩 — 퇴사자 정리</h2>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {target
              ? `대상: ${target.displayName} · ${target.userPrincipalName}`
              : "로그인 차단 → 세션 철회 → 라이선스 회수 → 그룹 제거를 순서대로 실행합니다"}
          </p>
        </div>
        <select
          value={targetId}
          onChange={(e) => {
            setTargetId(e.target.value);
            setConfirmed(false);
            setSteps([]);
            setResult(null);
          }}
          className="max-w-60 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium outline-none hover:bg-canvas"
        >
          <option value="">대상 선택…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.userPrincipalName})
            </option>
          ))}
        </select>
      </div>

      {target && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-[13px]">
          <p className="font-medium text-red-700">실행 전 확인</p>
          <ul className="mt-2 space-y-0.5 text-red-600">
            <li>
              대상: {target.displayName} ({target.userPrincipalName})
            </li>
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
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:opacity-40"
          >
            {running ? "실행 중…" : "오프보딩 실행"}
          </button>
        </div>
      )}

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

      {/* 단계 밖 오류(대상 검증·요청 실패 등) — 단계 실패는 행의 재시도 버튼이 담당 */}
      {result && !result.ok && !result.failedStep && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          실패: {result.error ?? "알 수 없는 오류"}
        </div>
      )}

      {result?.ok && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-700">
          오프보딩 완료 — 모든 단계가 성공했습니다
        </div>
      )}

      <p className="mt-3 text-xs text-ink-muted">
        단계별 진행은 스트리밍으로 실시간 표시되며, 전 과정이 감사 로그에
        기록됩니다 ·{" "}
        <Link
          href="/audit"
          className="text-ink-sub underline underline-offset-2"
        >
          감사 로그 보기
        </Link>
      </p>
    </Card>
  );
}
