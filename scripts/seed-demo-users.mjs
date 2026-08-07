// 데모 사용자 시드: 부서·라이선스·활성 상태가 다양한 사용자 8명을 생성한다.
// 실행: node --env-file=.env.local scripts/seed-demo-users.mjs
// 생성 계정의 임시 비밀번호는 demo-users.local.json(gitignore)에 저장되며 콘솔에 출력하지 않는다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const tenant = process.env.GRAPH_TENANT_ID;

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

// 기본 도메인 확인
const domains = await g("GET", "/domains");
const domain = domains.value.find((d) => d.isDefault)?.id;
if (!domain) throw new Error("기본 도메인을 찾을 수 없습니다");
console.log(`도메인: ${domain}`);

// E3 skuId 확인
const skus = await g("GET", "/subscribedSkus");
const e3 = skus.value.find((s) => s.skuPartNumber === "SPE_E3");
if (!e3) throw new Error("SPE_E3 SKU가 없습니다");

function password() {
  // Entra 복잡성 요건 충족: 대소문자+숫자+특수문자
  return `Wh${randomBytes(9).toString("base64url")}!3`;
}

const DEMO_USERS = [
  { nick: "sales1", name: "박서준", dept: "영업", title: "매니저", licensed: true, enabled: true },
  { nick: "sales2", name: "이지은", dept: "영업", title: "사원", licensed: true, enabled: true },
  { nick: "dev1", name: "김민준", dept: "개발", title: "선임", licensed: true, enabled: true },
  { nick: "dev2", name: "최수아", dept: "개발", title: "사원", licensed: true, enabled: true },
  { nick: "hr1", name: "정도윤", dept: "인사", title: "매니저", licensed: true, enabled: true },
  { nick: "fin1", name: "한은우", dept: "재무", title: "사원", licensed: true, enabled: false }, // 퇴사자 시나리오
  { nick: "fin2", name: "오하린", dept: "재무", title: "사원", licensed: true, enabled: false }, // 퇴사자 시나리오
  { nick: "intern1", name: "유시우", dept: "개발", title: "인턴", licensed: false, enabled: true },
];

// 잔여 좌석 사전 점검 — 부족하면 계정을 만들기 전에 실패시킨다
const needed = DEMO_USERS.filter((u) => u.licensed).length;
const free = e3.prepaidUnits.enabled - e3.consumedUnits;
if (free < needed) {
  console.error(`E3 잔여 좌석 부족: 필요 ${needed}, 잔여 ${free}`);
  process.exit(1);
}

// 자격 증명은 사용자 1명 생성 직후마다 즉시 파일에 반영한다 —
// 중간 실패 시 이미 만든 계정의 비밀번호가 유실되지 않도록
const CRED_FILE = "demo-users.local.json";
const credentials = existsSync(CRED_FILE)
  ? JSON.parse(readFileSync(CRED_FILE, "utf8"))
  : [];
const flush = () =>
  writeFileSync(CRED_FILE, JSON.stringify(credentials, null, 2), "utf8");

for (const u of DEMO_USERS) {
  const upn = `${u.nick}@${domain}`;
  const pwd = password();

  const existing = await g(
    "GET",
    `/users?$filter=userPrincipalName eq '${upn}'&$select=id,assignedLicenses`,
  );
  if (existing.value.length > 0) {
    // 재실행: 라이선스가 누락된 반쪽 시드는 여기서 복구한다
    const ex = existing.value[0];
    if (u.licensed && !ex.assignedLicenses?.some((l) => l.skuId === e3.skuId)) {
      await g("POST", `/users/${ex.id}/assignLicense`, {
        addLicenses: [{ skuId: e3.skuId, disabledPlans: [] }],
        removeLicenses: [],
      });
      console.log(`- ${upn}: 이미 존재, 누락 라이선스 복구`);
    } else {
      console.log(`- ${upn}: 이미 존재, 건너뜀`);
    }
    continue;
  }

  const created = await g("POST", "/users", {
    accountEnabled: u.enabled,
    displayName: u.name,
    mailNickname: u.nick,
    userPrincipalName: upn,
    department: u.dept,
    jobTitle: u.title,
    usageLocation: "KR", // assignLicense 필수 조건
    passwordProfile: {
      password: pwd,
      forceChangePasswordNextSignIn: true,
    },
  });
  credentials.push({ upn, name: u.name, password: pwd });
  flush(); // 이후 단계가 실패해도 비밀번호는 보존

  if (u.licensed) {
    await g("POST", `/users/${created.id}/assignLicense`, {
      addLicenses: [{ skuId: e3.skuId, disabledPlans: [] }],
      removeLicenses: [],
    });
  }

  console.log(
    `- ${upn}: 생성 (${u.dept}/${u.title}, 라이선스=${u.licensed ? "E3" : "없음"}, 활성=${u.enabled})`,
  );
}

console.log(`\n자격 증명 ${credentials.length}건이 ${CRED_FILE}에 있습니다 (gitignore됨)`);
console.log("완료");
