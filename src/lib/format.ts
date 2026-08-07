const krw = new Intl.NumberFormat("ko-KR");

export function formatKrw(amount: number): string {
  return `₩${krw.format(Math.round(amount))}`;
}

const KST = "Asia/Seoul";

export function formatDateKst(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("ko-KR", { timeZone: KST, dateStyle: "medium" });
}

export function formatDateTimeKst(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("ko-KR", {
    timeZone: KST,
    dateStyle: "medium",
    timeStyle: "short",
  });
}
