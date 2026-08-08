import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  date,
  integer,
  bigint,
  numeric,
  boolean,
  jsonb,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "manager", "employee"]);
export const leaveTypeEnum = pgEnum("leave_type", ["annual", "half", "sick"]);
export const leaveStatusEnum = pgEnum("leave_status", [
  "pending",
  "approved_1",
  "approved",
  "rejected",
  "cancelled",
]);
export const actorTypeEnum = pgEnum("actor_type", ["user", "assistant"]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "executed",
  "failed",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Entra ID의 oid 클레임. SSO 최초 로그인 시 채워진다
  entraId: text("entra_id").unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  department: text("department"),
  role: roleEnum("role").notNull().default("employee"),
  managerId: uuid("manager_id").references((): AnyPgColumn => users.id),
  // 반차(0.5일)를 위해 numeric
  annualLeaveDays: numeric("annual_leave_days", { precision: 4, scale: 1 })
    .notNull()
    .default("15"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  type: leaveTypeEnum("type").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  days: numeric("days", { precision: 4, scale: 1 }).notNull(),
  reason: text("reason"),
  status: leaveStatusEnum("status").notNull().default("pending"),
  approverId: uuid("approver_id").references(() => users.id),
  rejectReason: text("reject_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    // KST 기준 근무일. 자정 넘김 근무는 체크인 날짜에 귀속된다
    date: date("date").notNull(),
    checkInAt: timestamp("check_in_at", { withTimezone: true }).notNull(),
    checkOutAt: timestamp("check_out_at", { withTimezone: true }),
    workedMinutes: integer("worked_minutes"),
    note: text("note"),
  },
  // 하루 1행 불변식을 DB에서 강제 — 더블클릭 경합의 중복 체크인 차단
  (t) => [uniqueIndex("attendance_user_date_uq").on(t.userId, t.date)],
);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // 커밋 순서 재구성용 단조 증가 순번 — createdAt은 트랜잭션 시작 시각이라
  // 동시 쓰기에서 순서가 뒤집힐 수 있다 (포렌식 모호성 제거)
  seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
  actorId: uuid("actor_id").references(() => users.id),
  actorType: actorTypeEnum("actor_type").notNull().default("user"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  detail: jsonb("detail"),
  success: boolean("success").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// AI 어시스턴트의 변경형 도구 실행 요청. 승인 게이트(human-in-the-loop)의 저장소
export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull().default("assistant_action"),
  payload: jsonb("payload").notNull(),
  status: approvalStatusEnum("status").notNull().default("pending"),
  requestedBy: uuid("requested_by").references(() => users.id),
  decidedBy: uuid("decided_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const proposalStatusEnum = pgEnum("proposal_status", [
  "in_progress",
  "approved",
  "rejected",
  "cancelled",
]);
export const proposalStepStatusEnum = pgEnum("proposal_step_status", [
  "pending",
  "approved",
  "rejected",
]);

// 기안(전자결재) 문서. 템플릿 정의는 코드(src/lib/proposal.ts)가 진실의 원천 —
// content는 템플릿 필드 키→값의 jsonb 스냅샷
export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateKey: text("template_key").notNull(),
  title: text("title").notNull(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  content: jsonb("content").notNull(),
  status: proposalStatusEnum("status").notNull().default("in_progress"),
  // 순차 결재 — 현재 결재 차례 (1부터). 전이는 조건부 UPDATE로만
  currentStep: integer("current_step").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const proposalApprovers = pgTable(
  "proposal_approvers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id),
    step: integer("step").notNull(),
    approverId: uuid("approver_id")
      .notNull()
      .references(() => users.id),
    status: proposalStepStatusEnum("status").notNull().default("pending"),
    comment: text("comment"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("proposal_step_uq").on(t.proposalId, t.step),
    // 같은 사람이 결재선에 두 번 들어갈 수 없다
    uniqueIndex("proposal_approver_uq").on(t.proposalId, t.approverId),
  ],
);

export const holidaySourceEnum = pgEnum("holiday_source", ["public", "company"]);

// 휴일: public = 공휴일 API 동기화, company = 관리자가 설정한 전사 휴일/임시 공휴일
export const holidays = pgTable("holidays", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull().unique(),
  name: text("name").notNull(),
  source: holidaySourceEnum("source").notNull().default("company"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 라이선스 낭비 금액 환산용 단가표. skuId는 Graph subscribedSkus의 skuId(GUID)
export const skuPrices = pgTable("sku_prices", {
  skuId: text("sku_id").primaryKey(),
  skuPartNumber: text("sku_part_number").notNull(),
  displayName: text("display_name"),
  monthlyPriceKrw: integer("monthly_price_krw").notNull().default(0),
});
