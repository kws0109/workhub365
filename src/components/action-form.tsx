"use client";

import { useActionState } from "react";

export type ActionState = { error?: string; ok?: boolean };

type ServerAction = (
  prev: ActionState,
  formData: FormData,
) => Promise<ActionState>;

/**
 * 서버 액션의 검증 오류를 인라인으로 표시하는 폼.
 * throw 대신 { error }를 반환하는 액션과 짝을 이룬다 —
 * 프로덕션에서 서버 액션의 throw 메시지는 사용자에게 전달되지 않기 때문.
 * fieldset이 pending 동안 비활성화되어 더블클릭 중복 제출도 막는다.
 */
export function ActionForm({
  action,
  className,
  children,
}: {
  action: ServerAction;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state.error && (
        <p className="mt-1.5 text-xs font-medium text-red-600">{state.error}</p>
      )}
    </form>
  );
}
