// 도구가 필요로 하는 실행 컨텍스트(의존성 주입 인터페이스)와 결과 타입.
// 이 패키지는 앱(src/)을 import하지 않는다 — Graph/DB 구현은 호스트가 주입한다
// (Next.js in-process·stdio 서버 모두 src/lib/assistant/ops.ts의 동일 구현을 사용).

export type LicenseOverview = {
  inactiveDays: number;
  /** signInActivity 조회 불가(P1 미보유) 시 false — 휴면 판정이 제한된다 */
  signInAvailable: boolean;
  totalsKrw: { unassigned: number; assigned: number; total: number };
  skus: {
    skuPartNumber: string;
    displayName: string | null;
    purchased: number;
    assigned: number;
    unassigned: number;
    monthlyPriceKrw: number;
  }[];
  /** 낭비 금액 상위 사용자 (최대 15명) */
  topWasteUsers: {
    displayName: string;
    userPrincipalName: string;
    status: string;
    monthlyWasteKrw: number;
  }[];
};

export type UserSummary = {
  id: string;
  displayName: string;
  userPrincipalName: string;
  department: string | null;
  jobTitle: string | null;
  accountEnabled: boolean;
};

export type UserDetail = UserSummary & {
  licenses: { skuId: string; skuPartNumber: string }[];
  groups: { id: string; displayName: string; dynamic: boolean }[];
};

export type OvertimeRow = {
  name: string;
  department: string | null;
  weeklyMinutes: number;
  level: "ok" | "warn" | "over";
};

export type GroupSummary = { id: string; displayName: string };

export type CreateUserInput = {
  displayName: string;
  /** 이메일 로컬파트(영문 소문자·숫자). UPN = mailNickname@기본도메인 */
  mailNickname: string;
  department?: string;
  jobTitle?: string;
  skuIds?: string[];
  groupIds?: string[];
};

export type CreatedUser = {
  id: string;
  userPrincipalName: string;
  /** 1회 표시용 — 호스트는 DB/감사 로그에 저장하지 않아야 한다 */
  tempPassword: string;
  /** 실제 할당에 성공한 skuId만 */
  assignedSkuIds: string[];
  addedGroups: { id: string; ok: boolean; error?: string }[];
  /** 계정 생성 후 라이선스 할당이 실패한 경우 — 계정·비밀번호는 유효하다 */
  licenseError?: string;
};

/** 도구 실행에 필요한 외부 의존성. 변경형 메서드는 승인 게이트 통과 후에만 호출되어야 한다 */
export interface ToolContext {
  // 조회형
  getLicenseOverview(inactiveDays: number): Promise<LicenseOverview>;
  findUsers(query: string): Promise<UserSummary[]>;
  getUserDetail(userId: string): Promise<UserDetail | null>;
  getOvertimeStatus(): Promise<{ weekStart: string; rows: OvertimeRow[] }>;
  listGroups(): Promise<GroupSummary[]>;
  // 변경형 (requiresApproval 도구에서만 사용)
  createUser(input: CreateUserInput): Promise<CreatedUser>;
  blockUser(userId: string): Promise<void>;
  revokeUserSessions(userId: string): Promise<void>;
  removeUserLicense(userId: string, skuId: string): Promise<void>;
  removeUserFromGroup(userId: string, groupId: string): Promise<void>;
}

export type ToolExecutionResult =
  | { kind: "ok"; result: unknown }
  | {
      kind: "approval_required";
      toolName: string;
      input: unknown;
      summary: string;
    }
  | { kind: "error"; message: string };
