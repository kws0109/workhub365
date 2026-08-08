// 휴가 데모 데이터 시드: Entra에 팀원 5명 추가 생성 + 전체 활성 사용자의
// DB 행 upsert + 상태가 다양한 휴가 신청(승인/대기/1차/반려/취소) 구성.
// 실행: node --env-file=.env.local scripts/seed-leave-demo.mjs
//
// 불변식 준수: 승인된 연차·반차만큼 잔여 연차를 차감해 "총=잔여+사용"이 성립하고,
// 같은 사람의 활성 신청(대기/1차/승인)은 기간이 겹치지 않는다.
// 주의: admin 외 사용자의 기존 leave_requests를 지우고 다시 만든다 (데모 리셋).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const tenant = process.env.GRAPH_TENANT_ID;

// ── Graph 헬퍼 ──────────────────────────────────────────
const tokenRes = await fetch(
  `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
  {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GRAPH_CLIENT_ID,
      client_secret: process.env.GRAPH_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  },
);
if (!tokenRes.ok) {
  console.error("토큰 발급 실패:", tokenRes.status);
  process.exit(1);
}
const { access_token } = await tokenRes.json();

async function g(method, path, body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status} ${json?.error?.code ?? ""}: ${json?.error?.message?.slice(0, 150) ?? ""}`,
    );
  }
  return json;
}

const domain = (await g("GET", "/domains")).value.find((d) => d.isDefault)?.id;
const e3 = (await g("GET", "/subscribedSkus")).value.find(
  (s) => s.skuPartNumber === "SPE_E3",
);

function password() {
  return `Wh${randomBytes(9).toString("base64url")}!3`;
}

// ── 1) Entra에 팀원 5명 추가 (이미 있으면 건너뜀) ──────────
const NEW_USERS = [
  { nick: "sales3", name: "강하늘", dept: "영업", title: "사원" },
  { nick: "dev3", name: "윤지호", dept: "개발", title: "사원" },
  { nick: "dev4", name: "서예린", dept: "개발", title: "매니저" },
  { nick: "hr2", name: "임태양", dept: "인사", title: "사원" },
  { nick: "fin3", name: "조은별", dept: "재무", title: "매니저" },
];

const credPath = "demo-users.local.json";
const creds = existsSync(credPath)
  ? JSON.parse(readFileSync(credPath, "utf8"))
  : [];

for (const u of NEW_USERS) {
  const upn = `${u.nick}@${domain}`;
  const existing = await g(
    "GET",
    `/users?$filter=userPrincipalName eq '${upn}'&$select=id`,
  );
  if (existing.value.length > 0) {
    console.log(`- ${upn}: 이미 존재, 건너뜀`);
    continue;
  }
  const pwd = password();
  const created = await g("POST", "/users", {
    accountEnabled: true,
    displayName: u.name,
    mailNickname: u.nick,
    userPrincipalName: upn,
    department: u.dept,
    jobTitle: u.title,
    usageLocation: "KR",
    passwordProfile: { password: pwd, forceChangePasswordNextSignIn: true },
  });
  creds.push({ upn, name: u.name, password: pwd });
  writeFileSync(credPath, JSON.stringify(creds, null, 2), "utf8"); // 즉시 flush
  await g("POST", `/users/${created.id}/assignLicense`, {
    addLicenses: [{ skuId: e3.skuId, disabledPlans: [] }],
    removeLicenses: [],
  });
  console.log(`- ${upn}: 생성 (${u.dept}/${u.title}, E3)`);
}

// ── 2) 활성 테넌트 사용자 → DB users upsert ────────────────
const graphUsers = (
  await g(
    "GET",
    "/users?$select=id,displayName,userPrincipalName,department,jobTitle,accountEnabled&$top=999",
  )
).value.filter((u) => u.accountEnabled && u.department); // 부서 있는 활성 사용자만 (admin은 이미 DB에 있음)

// 기본 부여 연차를 사람마다 다르게 (연차 12~20일)
const BASE_DAYS = { 사원: 15, 인턴: 12, 선임: 17, 매니저: 20 };

const dbUsers = new Map(); // name → { id, base }
for (const u of graphUsers) {
  const base = BASE_DAYS[u.jobTitle] ?? 15;
  const role = u.jobTitle === "매니저" ? "manager" : "employee";
  const [row] = await sql`
    insert into users (entra_id, email, name, department, role, annual_leave_days)
    values (${u.id}, ${u.userPrincipalName.toLowerCase()}, ${u.displayName}, ${u.department}, ${role}, ${base})
    on conflict (email) do update
      set entra_id = excluded.entra_id,
          name = excluded.name,
          department = excluded.department,
          role = excluded.role,
          annual_leave_days = excluded.annual_leave_days
    returning id, name
  `;
  dbUsers.set(row.name, { id: row.id, base });
  console.log(`DB upsert: ${row.name} (${u.department}/${u.jobTitle}, 기본 ${base}일, ${role})`);
}

const [admin] = await sql`select id, name from users where role = 'admin' limit 1`;

// admin도 팀 화면(같은 부서만 표시)을 볼 수 있도록 부서를 배정한다
await sql`update users set department = '개발' where id = ${admin.id} and department is null`;

// ── 3) 휴일 로드 + 일수 계산 (앱과 동일 규칙) ──────────────
const holidayRows = await sql`select to_char(date, 'YYYY-MM-DD') as d from holidays`;
const holidays = new Set(holidayRows.map((r) => r.d));

function isWorkday(dateStr) {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(dateStr);
}
function countDays(type, start, end) {
  if (type === "half") return isWorkday(start) ? 0.5 : 0;
  let d = 0;
  for (
    let t = Date.parse(`${start}T00:00:00Z`);
    t <= Date.parse(`${end}T00:00:00Z`);
    t += 86_400_000
  ) {
    if (isWorkday(new Date(t).toISOString().slice(0, 10))) d++;
  }
  return d;
}

// ── 4) 휴가 데이터 리셋 + 시드 ─────────────────────────────
// [이름, 유형, 시작, 종료, 상태, 반려사유?, 1차결재자이름?]
const LEAVES = [
  ["박서준", "annual", "2026-08-10", "2026-08-11", "approved"],
  ["박서준", "annual", "2026-08-17", "2026-08-21", "approved"],
  ["이지은", "half", "2026-08-12", "2026-08-12", "approved"],
  ["이지은", "annual", "2026-08-28", "2026-08-28", "pending"],
  ["강하늘", "annual", "2026-09-07", "2026-09-09", "pending"],
  ["김민준", "annual", "2026-08-13", "2026-08-13", "approved"],
  ["김민준", "annual", "2026-08-24", "2026-08-28", "approved_1", null, "서예린"],
  ["최수아", "sick", "2026-08-06", "2026-08-07", "approved"],
  ["최수아", "annual", "2026-08-20", "2026-08-21", "rejected", "프로젝트 마감 주간입니다"],
  ["유시우", "annual", "2026-08-25", "2026-08-25", "approved"],
  ["유시우", "annual", "2026-08-11", "2026-08-11", "cancelled"],
  ["윤지호", "annual", "2026-08-31", "2026-09-01", "approved"],
  ["서예린", "annual", "2026-08-18", "2026-08-19", "approved"],
  // 8/19(수)에 5명 동시 휴가 — 다중 레인·오버플로 표시 확인용
  ["이지은", "annual", "2026-08-18", "2026-08-20", "approved"],
  ["윤지호", "annual", "2026-08-19", "2026-08-20", "approved"],
  ["임태양", "annual", "2026-08-19", "2026-08-19", "approved"],
  ["정도윤", "half", "2026-08-26", "2026-08-26", "pending"],
  ["임태양", "annual", "2026-08-12", "2026-08-13", "approved"],
  ["임태양", "sick", "2026-09-02", "2026-09-03", "pending"],
  ["조은별", "annual", "2026-08-24", "2026-08-24", "approved"],
  ["조은별", "half", "2026-08-27", "2026-08-27", "rejected", "결산 기간입니다"],
];

// admin 외 기존 신청 제거 (데모 리셋)
await sql`delete from leave_requests where user_id <> ${admin.id}`;
console.log("기존 데모 휴가 데이터 초기화");

const usedByUser = new Map();
for (const [name, type, start, end, status, rejectReason, firstApprover] of LEAVES) {
  const u = dbUsers.get(name);
  if (!u) {
    console.log(`! ${name}: DB 사용자 없음, 건너뜀`);
    continue;
  }
  const days = countDays(type, start, end);
  if (days <= 0) {
    console.log(`! ${name} ${start}: 근무일 0, 건너뜀`);
    continue;
  }
  const approverId =
    status === "approved" || status === "rejected"
      ? admin.id
      : status === "approved_1"
        ? (dbUsers.get(firstApprover)?.id ?? admin.id)
        : null;
  const decidedAt =
    status === "pending" ? null : new Date().toISOString();

  await sql`
    insert into leave_requests (user_id, type, start_date, end_date, days, status, approver_id, reject_reason, decided_at)
    values (${u.id}, ${type}, ${start}, ${end}, ${days}, ${status}, ${approverId}, ${rejectReason ?? null}, ${decidedAt})
  `;
  if (status === "approved" && type !== "sick") {
    usedByUser.set(name, (usedByUser.get(name) ?? 0) + days);
  }
  console.log(`휴가: ${name} ${type} ${start}~${end} (${days}일) → ${status}`);
}

// 승인분만큼 잔여 차감 — "총 = 잔여 + 사용" 불변식 유지
for (const [name, used] of usedByUser) {
  const u = dbUsers.get(name);
  await sql`update users set annual_leave_days = ${u.base - used} where id = ${u.id}`;
  console.log(`잔여 조정: ${name} = ${u.base} - ${used} = ${u.base - used}일`);
}

console.log("완료");
