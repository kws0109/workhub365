import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// neon-http가 아닌 neon-serverless(WebSocket)를 쓰는 이유:
// http 드라이버는 db.transaction()이 타입은 통과하지만 런타임에서 던진다.
// 휴가 승인(차감 1회), 승인 게이트(실행+감사로그)의 원자성에 트랜잭션이 필요하다.
// Node 22+의 전역 WebSocket을 드라이버가 자동 사용한다.
//
// 연결 문자열은 Neon의 풀러(-pooler) 엔드포인트를 사용할 것 (docs/setup-guide.md)
// — 서버리스 다중 인스턴스에서 Postgres 커넥션 고갈을 막는다.

type Db = ReturnType<typeof createDb>;

function createDb() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL!,
    max: 10,
    // 유휴 소켓을 짧게 유지 — 인스턴스 일시정지 중 끊긴 소켓이 살아남지 않게
    idleTimeoutMillis: 10_000,
    // 풀 대기 무한정 금지 — 고갈 시 조용히 매달리는 대신 빠르게 실패
    connectionTimeoutMillis: 10_000,
  });
  // 유휴 커넥션의 에러는 리스너가 없으면 프로세스 전체를 죽인다(uncaught).
  // Fluid Compute에서는 한 프로세스가 다수 사용자의 요청을 나르므로 반드시 흡수
  pool.on("error", (e: Error) => {
    console.error("pg pool idle connection error:", e.message);
  });
  return drizzle(pool, { schema });
}

let _db: Db | null = null;

// 지연 초기화: 모듈 로드(빌드 타임)가 아니라 첫 쿼리 시점에 DATABASE_URL을 읽는다.
// 환경변수 없이도 빌드가 가능해야 CI에서 시크릿 없이 컴파일 검증을 돌릴 수 있다.
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    _db ??= createDb();
    return Reflect.get(_db, prop);
  },
});
