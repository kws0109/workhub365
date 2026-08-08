// 기안(전자결재) — 템플릿 정의와 순수 로직 (단위 테스트 대상).
// 템플릿이 진실의 원천: 유형별 입력 필드와 기본 결재선 규칙을 코드로 정의한다.
// 결재는 순차(1차 → n차): 전원 승인 시 approved, 한 명이라도 반려 시 rejected.

export type FieldType = "text" | "textarea" | "number" | "date" | "select";

export type TemplateField = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[]; // select 전용
  placeholder?: string;
};

// 기본 결재선 규칙: 작성자 기준으로 순서대로 구성한다
//  - dept_manager: 작성자와 같은 부서의 manager (작성자 본인 제외)
//  - admin: 관리자
export type ApproverRule = "dept_manager" | "admin";

export type ProposalTemplate = {
  key: string;
  name: string;
  description: string;
  fields: TemplateField[];
  defaultLine: ApproverRule[];
};

export const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  {
    key: "expense",
    name: "경비 신청",
    description: "업무 관련 지출의 사전/사후 승인",
    fields: [
      { key: "amount", label: "금액 (원)", type: "number", required: true },
      { key: "usedAt", label: "사용(예정)일", type: "date", required: true },
      { key: "vendor", label: "사용처", type: "text", required: true, placeholder: "예: OO식당, OO소프트웨어" },
      { key: "category", label: "분류", type: "select", required: true, options: ["식대", "교통비", "소프트웨어/구독", "교육", "기타"] },
      { key: "reason", label: "사유", type: "textarea", required: true },
    ],
    defaultLine: ["dept_manager", "admin"],
  },
  {
    key: "data-export",
    name: "데이터 반출 신청",
    description: "사내 데이터의 외부 반출 승인 (보안 검토 포함)",
    fields: [
      { key: "dataset", label: "대상 데이터", type: "text", required: true, placeholder: "예: 8월 고객사 계약 목록" },
      { key: "destination", label: "반출 대상/방식", type: "text", required: true, placeholder: "예: OO사에 이메일 전달" },
      { key: "period", label: "반출일", type: "date", required: true },
      { key: "purpose", label: "반출 목적", type: "textarea", required: true },
      { key: "sensitivity", label: "민감도", type: "select", required: true, options: ["일반", "대외비", "개인정보 포함"] },
    ],
    defaultLine: ["dept_manager", "admin"],
  },
  {
    key: "leave-of-absence",
    name: "휴직 신청",
    description: "육아·질병·개인 사유 등 장기 휴직",
    fields: [
      { key: "kind", label: "휴직 유형", type: "select", required: true, options: ["육아휴직", "질병휴직", "개인사유", "기타"] },
      { key: "startDate", label: "시작일", type: "date", required: true },
      { key: "endDate", label: "종료(예정)일", type: "date", required: true },
      { key: "reason", label: "사유", type: "textarea", required: true },
    ],
    defaultLine: ["dept_manager", "admin"],
  },
  {
    key: "purchase",
    name: "구매 요청",
    description: "비품·장비·소프트웨어 구매",
    fields: [
      { key: "item", label: "품목", type: "text", required: true },
      { key: "quantity", label: "수량", type: "number", required: true },
      { key: "estimatedCost", label: "예상 금액 (원)", type: "number", required: true },
      { key: "neededBy", label: "필요 시점", type: "date", required: false },
      { key: "reason", label: "구매 사유", type: "textarea", required: true },
    ],
    defaultLine: ["dept_manager", "admin"],
  },
];

export function getTemplate(key: string): ProposalTemplate | undefined {
  return PROPOSAL_TEMPLATES.find((t) => t.key === key);
}

// ── 결재선 구성 ─────────────────────────────────────────

export type UserLike = {
  id: string;
  name: string;
  department: string | null;
  role: "admin" | "manager" | "employee";
};

/**
 * 템플릿의 기본 결재선 규칙을 실제 사용자로 해석한다.
 * 작성자 본인은 제외하고, 중복 인원은 한 번만 넣는다.
 * 해석 결과가 비면(예: 부서에 매니저 없음 + 작성자가 유일한 admin) 빈 배열 —
 * 호출부에서 "결재자를 직접 지정하세요"로 처리한다
 */
export function resolveDefaultLine(
  rules: ApproverRule[],
  author: UserLike,
  allUsers: UserLike[],
): UserLike[] {
  const line: UserLike[] = [];
  for (const rule of rules) {
    let candidate: UserLike | undefined;
    if (rule === "dept_manager") {
      candidate = allUsers.find(
        (u) =>
          u.role === "manager" &&
          u.id !== author.id &&
          u.department !== null &&
          u.department === author.department,
      );
    } else {
      candidate = allUsers.find((u) => u.role === "admin" && u.id !== author.id);
    }
    if (candidate && !line.some((l) => l.id === candidate!.id)) {
      line.push(candidate);
    }
  }
  return line;
}

// ── 입력 검증 ───────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type ContentValidation =
  | { ok: true; content: Record<string, string> }
  | { ok: false; error: string };

/** 템플릿 필드 정의에 따라 제출값을 검증·정규화한다 (스냅샷 저장용) */
export function validateContent(
  template: ProposalTemplate,
  raw: Record<string, unknown>,
): ContentValidation {
  const content: Record<string, string> = {};
  for (const f of template.fields) {
    const value = typeof raw[f.key] === "string" ? (raw[f.key] as string).trim() : "";
    if (!value) {
      if (f.required) return { ok: false, error: `'${f.label}'을(를) 입력하세요` };
      continue;
    }
    if (value.length > 2000) {
      return { ok: false, error: `'${f.label}'이(가) 너무 깁니다` };
    }
    if (f.type === "number" && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      return { ok: false, error: `'${f.label}'은(는) 0 이상의 숫자여야 합니다` };
    }
    if (f.type === "date") {
      // 형태만이 아니라 실제 달력 유효성까지 (2026-02-31 차단) —
      // 브라우저 date input은 막지만 위조 POST는 서버만 막을 수 있다
      const valid =
        DATE_RE.test(value) &&
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
      if (!valid) {
        return { ok: false, error: `'${f.label}'의 날짜 형식이 올바르지 않습니다` };
      }
    }
    if (f.type === "select" && !f.options?.includes(value)) {
      return { ok: false, error: `'${f.label}'의 선택값이 올바르지 않습니다` };
    }
    content[f.key] = value;
  }
  return { ok: true, content };
}

/** 결재선 검증: 1~5명, 작성자 제외, 중복 없음 */
export function validateLine(
  approverIds: string[],
  authorId: string,
): { ok: true } | { ok: false; error: string } {
  if (approverIds.length === 0) return { ok: false, error: "결재자를 1명 이상 지정하세요" };
  if (approverIds.length > 5) return { ok: false, error: "결재선은 최대 5명입니다" };
  if (approverIds.includes(authorId))
    return { ok: false, error: "작성자 본인은 결재선에 넣을 수 없습니다" };
  if (new Set(approverIds).size !== approverIds.length)
    return { ok: false, error: "같은 결재자를 중복 지정할 수 없습니다" };
  return { ok: true };
}

// ── 결재 진행 ───────────────────────────────────────────

export type DecideResult =
  | { ok: true; proposalStatus: "in_progress" | "approved" | "rejected"; nextStep: number }
  | { ok: false; reason: string };

/**
 * 현재 단계의 결재 처리 결과를 계산한다.
 * 승인: 마지막 단계면 approved, 아니면 다음 단계로 진행.
 * 반려: 즉시 rejected (사유는 호출부에서 필수 검증)
 */
export function nextProposalState(
  currentStep: number,
  totalSteps: number,
  action: "approve" | "reject",
): DecideResult {
  if (currentStep < 1 || currentStep > totalSteps) {
    return { ok: false, reason: "결재 단계가 올바르지 않습니다" };
  }
  if (action === "reject") {
    return { ok: true, proposalStatus: "rejected", nextStep: currentStep };
  }
  if (currentStep === totalSteps) {
    return { ok: true, proposalStatus: "approved", nextStep: currentStep };
  }
  return { ok: true, proposalStatus: "in_progress", nextStep: currentStep + 1 };
}
