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

export function formatDateTimeKst(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("ko-KR", {
    timeZone: KST,
    dateStyle: "medium",
    timeStyle: "short",
  });
}
