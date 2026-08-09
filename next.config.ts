import type { NextConfig } from "next";

// 전 경로 보안 응답 헤더. script-src까지 가는 전체 CSP는 nonce 배선이 필요해
// 범위를 넘어서므로, 배선 없이 실효가 있는 4종만 건다.
const SECURITY_HEADERS = [
  // 클릭재킹 차단 — 이 앱은 어디에도 임베드되지 않는다 (M365 임베드 금지 방침과도 일치)
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 외부로 전체 URL이 새지 않게 — 경로에 대상 GUID가 실리는 화면이 있다
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
