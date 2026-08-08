// drizzle/manual/*.sql 을 순서대로 실행한다.
// drizzle-kit push는 EXCLUDE 제약 같은 고급 DDL을 표현하지 못하므로
// 그런 변경은 여기 수동 마이그레이션으로 관리한다 (멱등하게 작성할 것).
// 실행: node --env-file=.env.local scripts/apply-manual-migrations.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "@neondatabase/serverless";

const dir = "drizzle/manual";
// HTTP 드라이버는 다중 명령을 지원하지 않는다 — WebSocket Pool(simple query) 사용
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

try {
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    console.log(`적용: ${f}`);
    // DO $$ 블록이 있어 문장 단위 분리는 위험 — 파일 전체를 단일 실행
    await pool.query(text);
  }
  console.log(`완료 (${files.length}개 파일)`);
} finally {
  await pool.end();
}
