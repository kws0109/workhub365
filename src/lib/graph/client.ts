import "server-only";

// Microsoft Graph app-only 클라이언트 (client credentials).
// 아키텍처 규칙: Graph 호출은 이 디렉토리 안에서만. 토큰은 절대 클라이언트로 내려보내지 않는다.

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

let cachedToken: { value: string; expiresAt: number } | null = null;
let tokenInFlight: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new GraphError(
      500,
      "config_missing",
      "GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET 환경변수가 필요합니다",
    );
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };
    throw new GraphError(
      res.status,
      body.error ?? "token_error",
      `앱 토큰 발급 실패: ${body.error_description?.split("\n")[0] ?? res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

async function getAppToken(): Promise<string> {
  // 만료 60초 전까지는 캐시 사용
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.value;
  }
  // single-flight: 동시 요청이 토큰 엔드포인트를 중복 타격하지 않게 한다
  tokenInFlight ??= fetchToken().finally(() => {
    tokenInFlight = null;
  });
  return tokenInFlight;
}

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

const MAX_THROTTLE_RETRIES = 3;
// 서버리스 함수 실행 한도를 넘겨 플랫폼에 강제 종료당하느니, 즉시 실패시켜
// 호출자가 강등 경로(예: "마지막 로그인 알 수 없음")로 빠지게 한다
const MAX_RETRY_AFTER_SECONDS = 10;

/**
 * Graph API 호출. path는 "/users" 같은 v1.0 상대 경로.
 * - 429/503: Retry-After를 존중해 최대 3회 재시도 (상한 10초, 초과 시 즉시 throttled)
 * - 401: 캐시 토큰 폐기 후 1회 재발급 (throttle 재시도 횟수와 독립)
 * - 403: 필요한 권한 안내를 담아 GraphError로 변환
 * - 204: undefined 반환
 */
export async function graphFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = path.startsWith("https://") ? path : `${GRAPH_BASE}${path}`;

  let throttleRetries = 0;
  let tokenRefreshed = false;

  for (;;) {
    const token = await getAppToken();
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ConsistencyLevel: "eventual",
        ...init?.headers,
      },
    });

    if (res.status === 429 || res.status === 503) {
      await res.body?.cancel(); // 버려지는 응답의 커넥션 반환
      if (throttleRetries >= MAX_THROTTLE_RETRIES) {
        throw new GraphError(res.status, "throttled", "Graph API 재시도 한도 초과");
      }
      const parsed = Number(res.headers.get("Retry-After"));
      const waitSeconds =
        Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
      if (waitSeconds > MAX_RETRY_AFTER_SECONDS) {
        throw new GraphError(
          res.status,
          "throttled",
          `Graph API 대기 요구 ${waitSeconds}초 — 상한 초과로 중단`,
        );
      }
      await new Promise((r) => setTimeout(r, waitSeconds * 1000));
      throttleRetries++;
      continue;
    }

    if (res.status === 401 && !tokenRefreshed) {
      await res.body?.cancel();
      tokenRefreshed = true;
      cachedToken = null; // 토큰 폐기 후 1회 재발급
      continue;
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      const code = body.error?.code ?? String(res.status);
      const hint =
        res.status === 403
          ? " (앱 등록의 application 권한과 관리자 동의를 확인하세요)"
          : "";
      throw new GraphError(
        res.status,
        code,
        `${body.error?.message ?? res.statusText}${hint}`,
      );
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

/** @odata.nextLink를 따라 전체 페이지를 수집 */
export async function graphGetAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;
  while (next) {
    const page: { value: T[]; "@odata.nextLink"?: string } =
      await graphFetch(next);
    items.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return items;
}
