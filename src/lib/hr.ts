// 인사 정정 권한 판정 — 순수 함수 (단위 테스트 대상).
// role(결재 서열: employee<manager<admin)과 직교한 플래그다. 인사 담당자가
// 동시에 부서 매니저일 수 있어야 하므로 roleEnum에 값을 더하지 않는다.
// admin이 항상 겸하는 이유: 본인 기록 정정을 전면 금지하므로, 권한자가 1명뿐인
// 조직에서 그 사람의 기록을 아무도 고칠 수 없는 데드락이 생긴다.
import type { Role } from "@/lib/leave";

export type HrActor = { id: string; role: Role; hrAdmin: boolean };

export function isHrEditor(actor: Pick<HrActor, "role" | "hrAdmin">): boolean {
  return actor.role === "admin" || actor.hrAdmin === true;
}

/** 본인 기록 셀프 정정 차단 — 휴가 상태머신의 '본인 신청 결재 금지'와 같은 이중 통제 */
export function canEditRecordOf(actor: HrActor, targetUserId: string): boolean {
  return isHrEditor(actor) && actor.id !== targetUserId;
}
