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
  // 실행-정확히-1회 클레임 상태. 승인 시 pending→executing 조건부 UPDATE로
  // 선점한 요청만 실행된다 (동시 승인 이중 실행 차단)
  "executing",
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
  // 인사 정정 권한 — role(결재 서열)과 직교. 타인 근태·휴가 정정만 허용 (R4.4/R3.9).
  // roleEnum에 값을 더하지 않는 이유는 src/lib/hr.ts 주석 참조
  hrAdmin: boolean("hr_admin").notNull().default(false),
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
  toolName: text("tool_name").notNull().default(""),
  // { input, summary } — 도구 입력의 jsonb 스냅샷. 실행은 이 스냅샷 기준
  payload: jsonb("payload").notNull(),
  // Claude tool_use 블록 id. 스트림 재시도가 같은 도구 호출로 요청을
  // 두 번 만들지 못하게 하는 멱등 키 (unique 위반 시 기존 행 재사용)
  idempotencyKey: text("idempotency_key").unique(),
  status: approvalStatusEnum("status").notNull().default("pending"),
  requestedBy: uuid("requested_by").references(() => users.id),
  decidedBy: uuid("decided_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  // 승인 유효기한 — 지나면 클레임 조건에서 걸러져 뒤늦은 실행이 차단된다
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  // 실행 결과 스냅샷(민감정보 제외 — 임시 비밀번호는 저장하지 않는다)
  result: jsonb("result"),
  error: text("error"),
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

export const postCategoryEnum = pgEnum("post_category", [
  "notice",
  "hr",
  "general_affairs",
  "free",
]);

// 게시판 글 (B4/R8.4) — 유일한 자체 콘텐츠 테이블. notice 카테고리·pinned·mustRead는
// admin 전용 (서버 액션에서 검증). 게시판 쓰기는 관리 액션이 아니므로 감사 로그 대상 아님
export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: postCategoryEnum("category").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  authorId: uuid("author_id")
    .notNull()
    .references(() => users.id),
  // 목록 상단 고정 (공지)
  pinned: boolean("pinned").notNull().default(false),
  // 필독 — post_reads로 확인 이력을 기록한다
  mustRead: boolean("must_read").notNull().default(false),
  // 상세 열람 시 increment. 중복 방지 없음 — 데모 수준 (design.md M8)
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 필독 확인 이력 — "확인했습니다" 1인 1회 (upsert onConflictDoNothing)
export const postReads = pgTable(
  "post_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    readAt: timestamp("read_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("post_read_uq").on(t.postId, t.userId)],
);
