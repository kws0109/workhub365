import "server-only";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// neon-http가 아닌 neon-serverless(WebSocket)를 쓰는 이유:
// http 드라이버는 db.transaction()이 타입은 통과하지만 런타임에서 던진다.
// 휴가 승인(차감 1회), 승인 게이트(실행+감사로그)의 원자성에 트랜잭션이 필요하다.
// Node 22+의 전역 WebSocket을 드라이버가 자동 사용한다.

type Db = ReturnType<typeof createDb>;

function createDb() {
  return drizzle(new Pool({ connectionString: process.env.DATABASE_URL! }), {
    schema,
  });
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
