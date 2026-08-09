const krw = new Intl.NumberFormat("ko-KR");

export function formatKrw(amount: number): string {
  return `₩${krw.format(Math.round(amount))}`;
}

const KST = "Asia/Seoul";

export function formatDateKst(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("ko-KR", { timeZone: KST, dateStyle: "medium" });
}

export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export function formatTimeKst(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleTimeString("ko-KR", {
    timeZone: KST,
    hour: "2-digit",
    minute: "2-digit",
  });
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** 파일 크기 — 1024 진법, 소수 1자리(정수로 떨어지면 생략). null은 "—" (폴더 등) */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // 반올림 후 승급 재판정 — 1048575는 1023.999KB라 루프를 빠져나오지만
  // toFixed(1)이 1024.0으로 올려 "1024KB"가 된다
  if (unit < BYTE_UNITS.length - 1 && Number(value.toFixed(1)) >= 1024) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${text}${BYTE_UNITS[unit]}`;
}

export function formatDateTimeKst(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("ko-KR", {
    timeZone: KST,
    dateStyle: "medium",
    timeStyle: "short",
  });
}
