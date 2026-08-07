import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit CLI는 Next.js와 달리 .env.local을 자동 로드하지 않는다
config({ path: ".env.local" });

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
