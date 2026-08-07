"use client";

import type { StepEvent } from "@/lib/lifecycle";

const STATUS_ICON: Record<StepEvent["status"], string> = {
  running: "◌",
  ok: "✓",
  error: "✕",
  skipped: "―",
};

const STATUS_CLS: Record<StepEvent["status"], string> = {
  running: "text-blue-600",
  ok: "text-emerald-600",
  error: "text-red-600",
  skipped: "text-zinc-300",
};

export function StepList({ steps }: { steps: StepEvent[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mt-4 space-y-1.5">
      {steps.map((s) => (
        <li key={s.key} className="flex items-start gap-2 text-sm">
          <span className={`w-4 shrink-0 text-center font-bold ${STATUS_CLS[s.status]}`}>
            {s.status === "running" ? (
              <span className="inline-block animate-pulse">{STATUS_ICON.running}</span>
            ) : (
              STATUS_ICON[s.status]
            )}
          </span>
          <span className={s.status === "skipped" ? "text-zinc-400" : ""}>
            {s.label}
            {s.message && (
              <span
                className={`ml-2 text-xs ${
                  s.status === "error" ? "text-red-500" : "text-zinc-400"
                }`}
              >
                {s.message}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * 단계 이벤트를 목록에 반영 — 제자리 갱신으로 순서를 유지하고,
 * 재시도의 skipped 이벤트가 이전 실행의 ok 기록을 덮어쓰지 않게 한다
 */
export function upsertStep(prev: StepEvent[], e: StepEvent): StepEvent[] {
  const i = prev.findIndex((p) => p.key === e.key);
  if (i < 0) return [...prev, e];
  if (e.status === "skipped" && prev[i].status === "ok") return prev;
  const next = [...prev];
  next[i] = e;
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
