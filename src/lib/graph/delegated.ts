import "server-only";

import { cookies } from "next/headers";
import { decode, type JWT } from "next-auth/jwt";
import { GraphError } from "./client";

// 위임(delegated) Graph 접근 — 로그인 사용자 본인의 데이터(메일·일정)만 읽는다.
// 아키텍처 규칙: app-only(관리)와 위임(개인) 자격 증명을 섞지 않는다.
// 토큰은 Auth.js JWT 쿠키에서 직접 복호화해 읽고, 절대 클라이언트로 내려보내지 않는다.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

/** Auth.js 세션 JWT 복호화 — 토큰이 커지면 쿠키가 `<name>.0`, `<name>.1`로 청크되므로 재조립 */
async function readSessionJwt(): Promise<JWT | null> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  const store = await cookies();

  for (const name of SESSION_COOKIES) {
    const whole = store.get(name)?.value;
    const chunks = store
      .getAll()
      .filter((c) => c.name.startsWith(`${name}.`))
      .sort(
        (a, b) =>
          Number(a.name.slice(name.length + 1)) -
          Number(b.name.slice(name.length + 1)),
      )
      .map((c) => c.value);
    const raw = whole ?? (chunks.length > 0 ? chunks.join("") : undefined);
    if (!raw) continue;
    try {
      // salt = 쿠키 이름 (Auth.js v5 규약)
      return await decode({ token: raw, secret, salt: name });
    } catch {
      return null;
    }
  }
  return null;
}

function ssoTenantId(): string | null {
  return (
    process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.match(
      /login\.microsoftonline\.com\/([0-9a-f-]{36})/i,
    )?.[1] ?? null
  );
}

// 리프레시 결과 인메모리 캐시 (oid 키) — RSC 렌더 중에는 쿠키를 다시 쓸 수 없어
// 갱신된 토큰을 JWT에 되돌려 넣지 못한다. 대신 프로세스 수명 동안 캐시로 재사용.
// origin = 이 갱신 체인을 시작한 쿠키의 리프레시 토큰 — 재로그인(새 쿠키) 감지 시 폐기 기준
const refreshCache = new Map<
  string,
  {
    value: string;
    expiresAt: number;
    refreshToken: string;
    origin: string;
    lastUsedAt: number;
  }
>();

// 리프레시 토큰은 장기 자격 증명 — 미사용 엔트리를 오래 들고 있지 않는다 (최소 보유)
const CACHE_IDLE_MS = 60 * 60 * 1000;

function pruneRefreshCache(now: number) {
  for (const [key, entry] of refreshCache) {
    if (now - entry.lastUsedAt > CACHE_IDLE_MS) refreshCache.delete(key);
  }
}

async function refreshDelegatedToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number; refreshToken?: string }> {
  const tenantId = ssoTenantId();
  const clientId = process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  const clientSecret = process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new GraphError(500, "config_missing", "SSO 환경변수가 필요합니다");
  }
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "openid profile email User.Read Mail.Read Calendars.Read offline_access",
      }),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new GraphError(
      res.status,
      body.error ?? "refresh_error",
      "위임 토큰 갱신 실패",
    );
  }
  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
    refreshToken: data.refresh_token,
  };
}

/**
 * 현재 로그인 사용자의 위임 Graph 액세스 토큰.
 * null = 위젯 강등 신호: 스코프 확장 전 구세션(재로그인 필요) 또는 갱신 실패.
 */
export async function getDelegatedGraphToken(): Promise<string | null> {
  const jwt = await readSessionJwt();
  if (!jwt?.graphAccessToken) return null;

  if ((jwt.graphExpiresAt ?? 0) - 60_000 > Date.now()) {
    return jwt.graphAccessToken;
  }

  // 만료 — oid 키 캐시 확인 후 리프레시
  const oid = jwt.oid;
  if (!oid || !jwt.graphRefreshToken) return null;
  const now = Date.now();
  pruneRefreshCache(now);

  let cached = refreshCache.get(oid);
  // 재로그인으로 쿠키의 리프레시 토큰이 바뀌었으면 이전 체인 캐시는 폐기 —
  // 구세션의 (무효화됐을 수 있는) 토큰이 새 세션의 유효 토큰을 가리면 안 된다
  if (cached && cached.origin !== jwt.graphRefreshToken) {
    refreshCache.delete(oid);
    cached = undefined;
  }
  if (cached && cached.expiresAt - 60_000 > now) {
    cached.lastUsedAt = now;
    return cached.value;
  }

  try {
    const next = await refreshDelegatedToken(
      cached?.refreshToken ?? jwt.graphRefreshToken,
    );
    refreshCache.set(oid, {
      value: next.accessToken,
      expiresAt: now + next.expiresIn * 1000,
      refreshToken: next.refreshToken ?? cached?.refreshToken ?? jwt.graphRefreshToken,
      origin: jwt.graphRefreshToken,
      lastUsedAt: now,
    });
    return next.accessToken;
  } catch {
    return null; // 위젯 강등 — 페이지는 계속 동작
  }
}

/** 위임 토큰으로 Graph 호출. 429/503은 Retry-After 존중 1회 재시도
 *  (대기 요구가 10초를 넘으면 즉시 실패 — app-only 클라이언트와 동일 정책, 위젯은 강등 처리) */
export async function delegatedGraphFetch<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let retried = false;
  for (;;) {
    const res = await fetch(`${GRAPH_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if ((res.status === 429 || res.status === 503) && !retried) {
      await res.body?.cancel();
      const parsed = Number(res.headers.get("Retry-After"));
      const waitSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
      if (waitSeconds > 10) {
        throw new GraphError(
          res.status,
          "throttled",
          `Graph API 대기 요구 ${waitSeconds}초 — 상한 초과로 중단`,
        );
      }
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      retried = true;
      continue;
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      throw new GraphError(
        res.status,
        body.error?.code ?? String(res.status),
        body.error?.message ?? res.statusText,
      );
    }
    return (await res.json()) as T;
  }
}
