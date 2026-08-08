// 승인 요청 상태머신의 순수 로직. DB 접근 없음 — 호출부(assistant 서버 액션)가
// 이 판정을 조건부 UPDATE(CAS)로 재현해 동시성을 DB에서 최종 강제한다.
//
// 상태 흐름:
//   pending ─승인→ executing ─성공→ executed
//                          └─실패→ failed
//   pending ─거부→ rejected
//   pending + 만료 경과 → (저장 상태는 pending 유지, 판정상 expired 취급)

export const APPROVAL_TTL_MS = 15 * 60 * 1000; // 승인 유효 15분

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "executed"
  | "failed";

export type ApprovalLike = {
  status: ApprovalStatus;
  expiresAt: Date | null;
};

export type DecideCheck = { ok: true } | { ok: false; reason: string };

export function isExpired(req: ApprovalLike, now: Date): boolean {
  return req.status === "pending" && req.expiresAt !== null && req.expiresAt <= now;
}

/** 승인/거부 가능 여부 판정. CAS 전 사전 검사와 사용자 오류 메시지에 사용 */
export function canDecide(req: ApprovalLike, now: Date): DecideCheck {
  if (isExpired(req, now)) {
    return { ok: false, reason: "만료된 요청입니다. 어시스턴트에게 다시 요청하세요." };
  }
  if (req.status !== "pending") {
    return { ok: false, reason: "이미 처리된 요청입니다." };
  }
  return { ok: true };
}

/** UI 표시용 상태 — 저장 상태에 만료 판정을 겹친다 */
export function displayStatus(
  req: ApprovalLike,
  now: Date,
): ApprovalStatus | "expired" {
  return isExpired(req, now) ? "expired" : req.status;
}

export function expiryFrom(createdAt: Date): Date {
  return new Date(createdAt.getTime() + APPROVAL_TTL_MS);
}
