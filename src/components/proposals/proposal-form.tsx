"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ActionState } from "@/components/action-form";
import {
  PROPOSAL_TEMPLATES,
  resolveDefaultLine,
  type ProposalTemplate,
  type UserLike,
} from "@/lib/proposal";

/**
 * 기안 작성 폼: 유형 선택 → 템플릿 필드 세팅 + 기본 결재선 자동 구성.
 * 결재선은 추가/삭제/순서 변경이 가능하다 (작성자 본인 제외).
 */
export function ProposalForm({
  action,
  author,
  allUsers,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  author: UserLike;
  allUsers: UserLike[];
}) {
  const [template, setTemplate] = useState<ProposalTemplate | null>(null);

  if (!template) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PROPOSAL_TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTemplate(t)}
            className="rounded-xl border border-line bg-surface p-5 text-left transition hover:border-ink-muted"
          >
            <p className="font-semibold">{t.name}</p>
            <p className="mt-1 text-sm text-ink-secondary">{t.description}</p>
            <p className="mt-2 text-xs text-ink-muted">
              기본 결재선:{" "}
              {t.defaultLine
                .map((r) => (r === "dept_manager" ? "부서 매니저" : "관리자"))
                .join(" → ")}
            </p>
          </button>
        ))}
      </div>
    );
  }

  return (
    <TemplateForm
      key={template.key}
      template={template}
      author={author}
      allUsers={allUsers}
      action={action}
      onBack={() => setTemplate(null)}
    />
  );
}

function TemplateForm({
  template,
  author,
  allUsers,
  action,
  onBack,
}: {
  template: ProposalTemplate;
  author: UserLike;
  allUsers: UserLike[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  onBack: () => void;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, {});
  // 기본 결재선 자동 세팅 — 이후 자유롭게 수정
  const [line, setLine] = useState<UserLike[]>(() =>
    resolveDefaultLine(template.defaultLine, author, allUsers),
  );
  const [addId, setAddId] = useState("");

  useEffect(() => {
    if (state.ok) router.push("/proposals");
  }, [state.ok, router]);

  const candidates = useMemo(
    () =>
      allUsers.filter(
        (u) => u.id !== author.id && !line.some((l) => l.id === u.id),
      ),
    [allUsers, author.id, line],
  );

  function move(i: number, dir: -1 | 1) {
    setLine((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  return (
    <form action={formAction}>
      <fieldset disabled={pending} className="contents">
        <input type="hidden" name="templateKey" value={template.key} />
        <input
          type="hidden"
          name="approverIds"
          value={JSON.stringify(line.map((l) => l.id))}
        />

        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{template.name}</h2>
          <button
            type="button"
            onClick={onBack}
            className="text-xs text-ink-muted underline-offset-2 hover:underline"
          >
            ← 다른 유형 선택
          </button>
        </div>

        <div className="mt-4 space-y-3 rounded-xl border border-line bg-surface p-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-secondary">제목</span>
            <input
              name="title"
              required
              defaultValue={`${template.name} - ${author.name}`}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </label>
          {template.fields.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-xs font-medium text-ink-secondary">
                {f.label}
                {f.required && <span className="text-red-500"> *</span>}
              </span>
              {f.type === "textarea" ? (
                <textarea
                  name={`field:${f.key}`}
                  required={f.required}
                  rows={3}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              ) : f.type === "select" ? (
                <select
                  name={`field:${f.key}`}
                  required={f.required}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                >
                  <option value="">선택…</option>
                  {f.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  name={`field:${f.key}`}
                  required={f.required}
                  min={f.type === "number" ? 0 : undefined}
                  placeholder={f.placeholder}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              )}
            </label>
          ))}
        </div>

        {/* 결재선 편집기 */}
        <div className="mt-4 rounded-xl border border-line bg-surface p-5">
          <h3 className="text-sm font-semibold">결재선</h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            유형에 따라 자동 구성되며, 순서 변경·추가·삭제할 수 있습니다 (1차부터 순서대로 결재)
          </p>
          <ol className="mt-3 space-y-1.5">
            {line.length === 0 && (
              <li className="text-sm text-red-500">
                결재자를 1명 이상 지정하세요
              </li>
            )}
            {line.map((u, i) => (
              <li
                key={u.id}
                className="flex items-center gap-2 rounded-lg border border-fill px-3 py-1.5 text-sm"
              >
                <span className="w-8 shrink-0 text-xs font-semibold text-ink-muted">
                  {i + 1}차
                </span>
                <span className="flex-1">
                  {u.name}
                  <span className="ml-1 text-xs text-ink-muted">
                    {u.department ?? "—"} ·{" "}
                    {u.role === "admin" ? "관리자" : u.role === "manager" ? "매니저" : "직원"}
                  </span>
                </span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  className="rounded px-1.5 text-ink-muted hover:bg-fill disabled:opacity-30">↑</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === line.length - 1}
                  className="rounded px-1.5 text-ink-muted hover:bg-fill disabled:opacity-30">↓</button>
                <button
                  type="button"
                  onClick={() => setLine((prev) => prev.filter((x) => x.id !== u.id))}
                  className="rounded px-1.5 text-red-400 hover:bg-red-50"
                >
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-center gap-2">
            <select
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
              className="rounded-lg border border-line px-3 py-1.5 text-sm"
            >
              <option value="">결재자 추가…</option>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.department ?? "—"})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!addId || line.length >= 5}
              onClick={() => {
                const u = candidates.find((c) => c.id === addId);
                if (u) setLine((prev) => [...prev, u]);
                setAddId("");
              }}
              className="rounded-lg border border-line-strong px-3 py-1.5 text-sm hover:bg-canvas disabled:opacity-40"
            >
              추가
            </button>
          </div>
        </div>

        {state.error && (
          <p className="mt-3 text-sm font-medium text-red-600">{state.error}</p>
        )}
        <button
          type="submit"
          disabled={line.length === 0 || pending}
          className="mt-4 rounded-lg bg-ink px-5 py-2.5 text-sm font-medium text-white hover:bg-ink-body disabled:opacity-40"
        >
          {pending ? "상신 중…" : "결재 요청"}
        </button>
      </fieldset>
    </form>
  );
}
