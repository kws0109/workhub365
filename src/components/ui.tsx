import type { ReactNode } from "react";

// 디자인 시스템 공용 컴포넌트 (design.md "디자인 시스템" 절, 목업 규격).
// 서버 컴포넌트 호환 — 상호작용 없는 표현 전용.

/** 기본 카드 — 무섀도, 보더 기반 (radius 12) */
export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border border-line bg-surface ${className}`}>
      {children}
    </div>
  );
}

/** KPI/스탯 타일 — 라벨 12/500 → 값 30/700 tracking-tight → 캡션 12 muted */
export function StatTile({
  label,
  value,
  caption,
  valueClassName = "",
  compact = false,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  valueClassName?: string;
  compact?: boolean;
}) {
  return (
    <Card className={compact ? "p-4" : "p-5"}>
      <p className="text-xs font-medium text-ink-secondary">{label}</p>
      <p
        className={`mt-1 font-bold tracking-[-0.02em] ${compact ? "text-xl" : "text-3xl"} ${valueClassName}`}
      >
        {value}
      </p>
      {caption && <div className="mt-1 text-xs text-ink-muted">{caption}</div>}
    </Card>
  );
}

export type BadgeTone =
  | "success"
  | "warn"
  | "danger"
  | "info"
  | "neutral"
  | "orange"
  | "indigo";

const BADGE_TONES: Record<BadgeTone, string> = {
  success: "bg-emerald-50 text-emerald-600",
  warn: "bg-amber-100 text-amber-800",
  danger: "bg-red-50 text-red-600",
  info: "bg-blue-50 text-blue-600",
  neutral: "bg-fill text-ink-sub",
  orange: "bg-orange-50 text-orange-600",
  indigo: "bg-indigo-50 text-indigo-600",
};

/** 상태 배지 — 필 형태 11px/500 */
export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export type SourceBrand = "outlook" | "teams" | "onedrive" | "graph" | "ai";

const BRAND_DOTS: Record<SourceBrand, string> = {
  outlook: "bg-brand-outlook",
  teams: "bg-brand-teams",
  onedrive: "bg-brand-onedrive",
  graph: "bg-brand-graph",
  ai: "bg-brand-ai",
};

/** 실연동 출처 칩 (R8.9) — "무엇이 실연동인지" 명시하는 장치 */
export function SourceChip({
  brand,
  children,
}: {
  brand: SourceBrand;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-secondary">
      <span className={`h-1.5 w-1.5 rounded-full ${BRAND_DOTS[brand]}`} />
      {children}
    </span>
  );
}

export type Presence = "online" | "away" | "busy" | "offline";

const PRESENCE_DOTS: Record<Presence, string> = {
  online: "bg-presence-online",
  away: "bg-presence-away",
  busy: "bg-presence-busy",
  offline: "bg-presence-offline",
};

const AVATAR_SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-10 w-10 text-sm",
} as const;

/** 이니셜 아바타 + 선택적 프레즌스 점 */
export function Avatar({
  name,
  size = "md",
  presence,
}: {
  name: string;
  size?: keyof typeof AVATAR_SIZES;
  presence?: Presence;
}) {
  return (
    <span className={`relative inline-flex shrink-0 ${AVATAR_SIZES[size]}`}>
      <span className="flex h-full w-full items-center justify-center rounded-full bg-fill font-semibold text-ink-sub">
        {name.trim().charAt(0)}
      </span>
      {presence && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${PRESENCE_DOTS[presence]}`}
        />
      )}
    </span>
  );
}

/** 페이지 헤더 — h1 24/700 tracking-tight + 서브 + 우측 액션 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-[-0.02em]">{title}</h1>
        {subtitle && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-secondary">
            {subtitle}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** 파일타입 미니 아이콘 (DOC/PPT/XLS/PDF/폴더 등) */
const FILE_COLORS: Record<string, string> = {
  doc: "bg-file-doc",
  docx: "bg-file-doc",
  ppt: "bg-file-ppt",
  pptx: "bg-file-ppt",
  xls: "bg-file-xls",
  xlsx: "bg-file-xls",
  pdf: "bg-file-pdf",
};

export function FileTypeIcon({ ext, size = 20 }: { ext: string; size?: number }) {
  const key = ext.toLowerCase();
  const color = FILE_COLORS[key] ?? "bg-ink-muted";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-md font-bold text-white ${color}`}
      style={{ width: size, height: size, fontSize: Math.max(7, size * 0.35) }}
    >
      {key.replace("x", "").slice(0, 3).toUpperCase()}
    </span>
  );
}

/** 진행바 — 6px 트랙 */
export function ProgressBar({
  percent,
  barClassName = "bg-emerald-500",
}: {
  percent: number;
  barClassName?: string;
}) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-fill">
      <div
        className={`h-full rounded-full ${barClassName}`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}
