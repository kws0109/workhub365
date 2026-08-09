// 게시판 데모 데이터 시드 (B4/R8.4): DB users에서 저자를 골라
// 고정 공지 2건(notice·pinned, 그중 1건 필독) + 카테고리별 일반 글 10건 구성.
// 실행: node --env-file=.env.local scripts/seed-board-demo.mjs
//
// 사전 조건: users가 시드되어 있어야 한다 (seed-leave-demo.mjs 또는 SSO 로그인).
// 조회수는 고정 값. 작성 시각은 실행 시점 기준 상대값 — "이번 주 인기 글" 카드가
// 항상 채워지도록 일부 글은 이번 주(KST 월요일~) 안에 배치한다.
// 주의: 재실행 시 post_reads·posts를 전부 지우고 다시 만든다 (데모 리셋).
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// ── 저자 선택: DB users에서 이름으로, 없으면 admin으로 대체 ──
const userRows = await sql`select id, name, department, role from users`;
const admin = userRows.find((u) => u.role === "admin");
if (!admin) {
  console.error("admin 사용자가 없습니다 — 먼저 로그인 또는 seed-leave-demo를 실행하세요");
  process.exit(1);
}
const byName = new Map(userRows.map((u) => [u.name, u]));
function author(name) {
  const u = byName.get(name);
  if (!u) console.log(`! 저자 ${name} 없음 → admin(${admin.name})으로 대체`);
  return u ?? admin;
}

// ── 작성 시각 헬퍼 (앱과 동일한 KST 월요일 주 경계) ──────────
const KST = 9 * 3600e3;
const DAY = 86400e3;
const now = Date.now();
const kstNow = new Date(now + KST);
const daysFromMonday = (kstNow.getUTCDay() + 6) % 7;
const weekStartMs =
  Date.parse(`${kstNow.toISOString().slice(0, 10)}T00:00:00Z`) -
  daysFromMonday * DAY -
  KST;

// 이번 주 안에 확실히 들어가는 시각 — now에서 hoursAgo만큼 뺀 뒤 주 시작으로 클램프
function thisWeek(hoursAgo) {
  return new Date(Math.max(weekStartMs + 3600e3, now - hoursAgo * 3600e3)).toISOString();
}
function daysAgo(d) {
  return new Date(now - d * DAY).toISOString();
}

// ── 시드 데이터: [저자, 카테고리, 제목, 조회수(고정), 작성시각, pinned, mustRead, 본문] ──
const POSTS = [
  [
    admin.name, "notice",
    "8월 전사 워크숍 안내 (8/27~28, 양양) — 참석 여부 회신 요청",
    214, thisWeek(30), true, false,
    "안녕하세요, 경영지원팀입니다.\n\n8월 전사 워크숍을 아래와 같이 진행합니다.\n\n- 일시: 8/27(목) ~ 8/28(금), 1박 2일\n- 장소: 양양 쏠비치 리조트\n- 집결: 8/27(목) 08:30 본사 로비 (버스 이동)\n\n참석 여부를 8/18(화)까지 부서장에게 회신해 주세요. 식단 알레르기·차량 이동 희망 등 특이사항은 회신 시 함께 적어 주시면 됩니다.",
  ],
  [
    "임태양", "notice",
    "정보보호 교육 이수 안내 — 8/20(목) 마감, 미이수자 개별 안내",
    187, thisWeek(50), true, true,
    "전 직원 필수 정보보호 교육 이수 기간입니다.\n\n- 대상: 전 직원\n- 기간: ~ 8/20(목) 18:00\n- 방법: 사내 교육 포털 접속 → [2026 정보보호 교육] 수강 (약 40분)\n\n마감일까지 미이수 시 개별 안내가 나가며, 이수 현황은 감사 대응 자료로 보관됩니다. 이 글을 읽으셨다면 하단의 확인 버튼을 눌러 주세요.",
  ],
  [
    "임태양", "hr",
    "사내 추천 채용 보상 제도 개편 안내",
    342, thisWeek(20), false, false,
    "사내 추천 채용 보상 제도가 9월부터 개편됩니다.\n\n- 추천 보상금: 입사 확정 시 100만 원 → 150만 원 상향\n- 지급 시점: 피추천인 수습 종료 시 일괄 지급\n- 대상 직군: 전 직군 (기존 개발 직군 한정에서 확대)\n\n추천은 채용 포털의 [사내 추천] 메뉴로 접수해 주세요. 자세한 기준은 인사팀 위키 문서를 참고 바랍니다.",
  ],
  [
    "윤지호", "free",
    "점심 배드민턴 동호회 신규 멤버 모집",
    96, thisWeek(8), false, false,
    "매주 화·목 점심시간에 근처 체육관에서 배드민턴을 치고 있습니다.\n\n- 시간: 화·목 12:00~13:00\n- 장소: 시청스포츠센터 (도보 5분)\n- 회비: 월 1만 원 (코트비·셔틀콕)\n\n라켓은 여분이 있으니 몸만 오셔도 됩니다. 관심 있으신 분은 댓글 대신 저에게 Teams로 연락 주세요.",
  ],
  [
    "조은별", "general_affairs",
    "8월 사무실 정기 소독 안내 (8/14 금 저녁)",
    58, daysAgo(9), false, false,
    "8/14(금) 19:00부터 사무실 전체 정기 소독을 진행합니다.\n\n- 소독 시간: 19:00 ~ 21:00\n- 협조 사항: 퇴근 시 책상 위 개인 물품(컵·서류)을 서랍에 보관해 주세요\n- 입실 가능: 당일 21:30 이후\n\n소독 후 환기가 필요하므로 야근 예정이신 분은 총무팀에 미리 알려 주세요.",
  ],
  [
    "임태양", "hr",
    "하반기 건강검진 예약 안내",
    143, daysAgo(12), false, false,
    "하반기 건강검진 예약이 시작되었습니다.\n\n- 대상: 전 직원 (배우자 검진은 근속 3년 이상)\n- 기간: 9/1 ~ 11/30\n- 기관: 한국의료재단, KMI (검진 포털에서 선택)\n\n예약 후 검진일은 공가 처리되며, 근태 화면에서 휴가 신청 없이 자동 반영됩니다. 문진표는 검진 3일 전까지 작성해 주세요.",
  ],
  [
    "조은별", "general_affairs",
    "주차 등록 차량 변경 신청 방법",
    41, daysAgo(15), false, false,
    "차량을 변경하신 분은 주차 등록을 갱신해야 건물 출입이 가능합니다.\n\n1. 총무팀 포털 → [주차 등록 변경] 작성\n2. 차량등록증 사진 첨부\n3. 영업일 기준 2일 내 처리 완료 문자 수신\n\n방문객 주차는 기존과 동일하게 당일 오전까지 신청해 주세요.",
  ],
  [
    "최수아", "free",
    "탕비실 커피 원두 추천 받습니다",
    77, daysAgo(6), false, false,
    "탕비실 원두를 다음 달부터 바꿔보려고 합니다.\n\n지금까지 후보는 이렇습니다.\n- 과테말라 안티구아 (산미 있음)\n- 브라질 세하도 (고소한 쪽)\n- 디카페인 콜롬비아 (오후용)\n\n다른 추천이나 의견 있으시면 Teams 총무 채널로 남겨 주세요. 다음 주 금요일까지 취합합니다.",
  ],
  [
    admin.name, "notice",
    "7월 전사 회의록 공유",
    120, daysAgo(18), false, false,
    "7월 전사 회의록을 공유합니다.\n\n주요 안건\n- 상반기 실적 리뷰 및 하반기 목표 확정\n- 신규 프로덕트 라인 일정 공유\n- 사무 공간 재배치 논의 (9월 중 확정 예정)\n\n전체 회의록 문서는 문서함의 경영지원 폴더에 있습니다. 정정할 내용이 있으면 이번 주 안에 알려 주세요.",
  ],
  [
    "김민준", "free",
    "사내 스터디(TypeScript) 참여자 모집",
    65, daysAgo(4), false, false,
    "격주 수요일 저녁에 TypeScript 스터디를 시작합니다.\n\n- 일정: 격주 수 19:00~20:30, 회의실 B\n- 교재: Effective TypeScript 2판\n- 방식: 챕터 발제 + 실습 코드 리뷰\n\n정원은 8명이고 선착순입니다. 참여를 원하시면 저에게 메일 주세요. 회사 도서 지원으로 교재는 전원 제공됩니다.",
  ],
  [
    "임태양", "hr",
    "경조사 지원 규정 개정 안내",
    88, daysAgo(21), false, false,
    "8월부터 경조사 지원 규정이 아래와 같이 개정됩니다.\n\n- 결혼: 축의금 50만 원 + 유급휴가 5일 (기존 3일)\n- 출산: 축하금 100만 원 (첫째 기준, 둘째부터 200만 원)\n- 조사: 부의금 50만 원 + 유급휴가 5일, 화환 지원\n\n신청은 인사팀 포털 [경조사 신청]에서 증빙과 함께 접수해 주세요.",
  ],
  [
    "조은별", "general_affairs",
    "비품 신청 마감 안내 (매월 25일)",
    33, daysAgo(2), false, false,
    "매월 비품 신청 마감일을 다시 안내드립니다.\n\n- 신청 마감: 매월 25일 18:00\n- 지급: 익월 첫째 주\n- 신청 방법: 총무팀 포털 → [비품 신청]\n\n마감 이후 신청분은 다음 달로 이월됩니다. 모니터·의자 등 고가 비품은 부서장 승인이 먼저 필요합니다.",
  ],
];

// ── 리셋 + 삽입 ──────────────────────────────────────────
await sql`delete from post_reads`;
await sql`delete from posts`;
console.log("기존 게시판 데이터 초기화");

for (const [name, category, title, views, createdAt, pinned, mustRead, body] of POSTS) {
  const a = author(name);
  await sql`
    insert into posts (category, title, body, author_id, pinned, must_read, view_count, created_at)
    values (${category}, ${title}, ${body}, ${a.id}, ${pinned}, ${mustRead}, ${views}, ${createdAt})
  `;
  console.log(
    `글: [${category}] ${title.slice(0, 30)}… (${a.name}, 조회 ${views}${pinned ? ", 고정" : ""}${mustRead ? ", 필독" : ""})`,
  );
}

console.log(`완료 — 총 ${POSTS.length}건 (고정 공지 2, 필독 1)`);
