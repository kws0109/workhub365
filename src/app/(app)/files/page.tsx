import Link from "next/link";
import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth-helpers";
import {
  appendPathSegment,
  parsePathParam,
  slicePathParam,
  type PathSegment,
} from "@/lib/drive-path";
import { formatBytes, formatDateKst } from "@/lib/format";
import { GraphError } from "@/lib/graph/client";
import { getDelegatedGraphToken } from "@/lib/graph/delegated";
import {
  getDriveChildren,
  getDriveQuota,
  getSharedWithMe,
  type DriveEntry,
  type DriveQuota,
} from "@/lib/graph/drive";
import {
  Card,
  FileTypeIcon,
  PageHeader,
  ProgressBar,
  SourceChip,
} from "@/components/ui";

export const metadata = { title: "문서함" };

// 문서함(B5, R8.5) — 위임 Files.Read 읽기 전용 OneDrive 탐색.
// 내 파일(폴더 진입·브레드크럼)·나와 공유됨·저장 공간 게이지만 구현하고
// 팀 문서함·휴지통·파일 검색은 범위 밖(feature-map 7절). 파일 클릭은
// Office 웹앱(webUrl) 딥링크, 업로드·새 폴더는 OneDrive 딥링크 위임.
// 브레드크럼은 ?path= 쿼리 누적으로 복원해 Graph 추가 호출이 없다.

const ONEDRIVE_DEEPLINK = "https://www.office.com/launch/onedrive";

function folderHref(id: string, path: string): string {
  const params = new URLSearchParams({ folder: id });
  if (path) params.set("path", path);
  return `/files?${params.toString()}`;
}

function extOf(name: string): string {
  const at = name.lastIndexOf(".");
  return at > 0 ? name.slice(at + 1) : "?";
}

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; folder?: string; path?: string }>;
}) {
  await requireSession();
  const { view, folder, path } = await searchParams;
  const shared = view === "shared";
  // 브레드크럼 세그먼트 — 손상 세그먼트는 파서가 버리므로 재직렬화한 값을 정본으로 쓴다
  const segments = shared ? [] : parsePathParam(path);
  const canonicalPath = slicePathParam(segments, segments.length);
  const folderId = shared ? undefined : folder;

  const token = await getDelegatedGraphToken();

  // 강등 1 — 위임 토큰 없음: Files.Read 스코프 확장 전 구세션이면 이 카드가 정상 경로
  if (!token) {
    return (
      <div className="max-w-[1240px]">
        <FilesHeader />
        <Card className="mt-5 border-dashed p-6 text-sm text-ink-secondary">
          문서함을 보려면 <span className="font-semibold">다시 로그인</span>이
          필요합니다 — 로그인 시 Microsoft 동의 화면에서 파일 읽기 권한을
          승인해 주세요 (사이드바 하단 로그아웃 → 재로그인)
        </Card>
      </div>
    );
  }

  // 저장 공간·목록을 병렬 조회 — 각각 독립 강등 (한쪽 실패가 페이지를 막지 않는다)
  const [quotaResult, listResult] = await Promise.all([
    getDriveQuota(token).then(
      (quota) => ({ ok: true as const, quota }),
      () => ({ ok: false as const }),
    ),
    (shared ? getSharedWithMe(token) : getDriveChildren(token, folderId)).then(
      (entries) => ({ ok: true as const, entries }),
      (e: unknown) => ({
        ok: false as const,
        error:
          e instanceof GraphError ? `${e.code}: ${e.message}` : "알 수 없는 오류",
      }),
    ),
  ]);
  const quota = quotaResult.ok ? quotaResult.quota : null;

  return (
    <div className="max-w-[1240px]">
      <FilesHeader />

      <div className="mt-5 grid grid-cols-[200px_minmax(0,1fr)] items-start gap-4">
        {/* 좌측 내비 + 저장 공간 게이지 */}
        <Card className="p-3">
          <nav className="flex flex-col gap-0.5">
            <NavLink href="/files" active={!shared}>
              내 파일
            </NavLink>
            <NavLink href="/files?view=shared" active={shared}>
              나와 공유됨
            </NavLink>
          </nav>
          <div className="mt-3 border-t border-fill px-2.5 pb-1 pt-3">
            <p className="text-[11px] text-ink-muted">저장 공간</p>
            <div className="mt-1.5">
              <QuotaGauge quota={quota} />
            </div>
          </div>
        </Card>

        {/* 우측 파일 목록 */}
        {!listResult.ok ? (
          <Card className="border-red-200 bg-red-50 p-6 text-sm text-red-700">
            <p className="font-semibold">파일 목록 조회에 실패했습니다</p>
            <p className="mt-1">{listResult.error}</p>
          </Card>
        ) : (
          <Card className="min-w-0 overflow-hidden">
            <Breadcrumb shared={shared} segments={segments} />
            <div className="flex items-center gap-3 border-b border-fill px-5 py-2 text-[11px] font-medium text-ink-muted">
              <span className="min-w-0 flex-1">이름</span>
              <span className="w-[90px] flex-none">수정일</span>
              <span className="w-[70px] flex-none">수정한 사람</span>
              <span className="w-[76px] flex-none text-right">크기</span>
            </div>
            {listResult.entries.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-ink-muted">
                {shared ? "나와 공유된 항목이 없습니다" : "폴더가 비어 있습니다"}
              </p>
            ) : (
              listResult.entries.map((entry) => (
                <FileRow
                  key={entry.id}
                  entry={entry}
                  shared={shared}
                  currentPath={canonicalPath}
                />
              ))
            )}
            <p className="px-5 py-2.5 text-xs text-ink-muted">
              {shared
                ? "공유받은 항목은 원본 위치(OneDrive·SharePoint)의 Office 웹앱에서 열립니다"
                : "파일은 OneDrive에 저장되며 클릭 시 Office 웹앱에서 열립니다 · 업로드·새 폴더는 우측 상단 OneDrive에서 열기를 이용하세요"}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

/** 헤더 — 출처 칩 + OneDrive 딥링크(업로드·새 폴더는 딥링크 위임이라 별도 버튼 없음) */
function FilesHeader() {
  return (
    <PageHeader
      title="문서함"
      subtitle={<SourceChip brand="onedrive">OneDrive 연동 · Files.Read</SourceChip>}
      actions={
        <a
          href={ONEDRIVE_DEEPLINK}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white transition hover:bg-ink-body"
        >
          OneDrive에서 열기
        </a>
      }
    />
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-md px-2.5 py-1.5 text-[13px] transition ${
        active ? "bg-fill font-semibold" : "text-ink-sub hover:bg-canvas"
      }`}
    >
      {children}
    </Link>
  );
}

/** 저장 공간 게이지 — quota 조회 실패 시 캡션만 강등 */
function QuotaGauge({ quota }: { quota: DriveQuota | null }) {
  if (!quota) {
    return <p className="text-[11px] text-ink-muted">조회할 수 없습니다</p>;
  }
  const percent = quota.total > 0 ? (quota.used / quota.total) * 100 : 0;
  return (
    <>
      <ProgressBar percent={percent} barClassName="bg-ink-sub" />
      <p className="mt-1.5 text-[11px] text-ink-muted">
        {formatBytes(quota.used)} / {formatBytes(quota.total)}
      </p>
    </>
  );
}

/** 브레드크럼 — 내 파일 루트 + ?path= 세그먼트. 마지막(현재 위치)만 비링크 강조 */
function Breadcrumb({
  shared,
  segments,
}: {
  shared: boolean;
  segments: PathSegment[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-fill px-5 py-3 text-[13px]">
      {shared ? (
        <span className="font-semibold">나와 공유됨</span>
      ) : (
        <>
          {segments.length === 0 ? (
            <span className="font-semibold">내 파일</span>
          ) : (
            <Link href="/files" className="text-ink-secondary hover:underline">
              내 파일
            </Link>
          )}
          {segments.map((seg, i) => {
            const last = i === segments.length - 1;
            return (
              <span key={`${seg.id}-${i}`} className="flex items-center gap-1.5">
                <span className="text-line-strong">/</span>
                {last ? (
                  <span className="font-semibold">{seg.name}</span>
                ) : (
                  <Link
                    href={folderHref(seg.id, slicePathParam(segments, i + 1))}
                    className="text-ink-secondary hover:underline"
                  >
                    {seg.name}
                  </Link>
                )}
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}

/** 파일·폴더 행 — 내 파일의 폴더만 내부 진입, 나머지는 webUrl 새 탭(Office 웹앱 딥링크) */
function FileRow({
  entry,
  shared,
  currentPath,
}: {
  entry: DriveEntry;
  shared: boolean;
  currentPath: string;
}) {
  const rowClass =
    "flex items-center gap-3 border-b border-fill px-5 py-2 text-[13px] transition hover:bg-canvas";
  const cells = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2.5">
        {entry.isFolder ? <FolderIcon /> : <FileTypeIcon ext={extOf(entry.name)} size={18} />}
        <span className="truncate font-medium">{entry.name}</span>
      </span>
      <span className="w-[90px] flex-none text-ink-secondary">
        {formatDateKst(entry.lastModifiedAt)}
      </span>
      <span className="w-[70px] flex-none truncate text-ink-secondary">
        {entry.modifiedBy ?? "—"}
      </span>
      <span className="w-[76px] flex-none text-right text-ink-muted">
        {formatBytes(entry.size)}
      </span>
    </>
  );

  // 내 파일의 폴더 — ?folder=·?path= 누적으로 진입 (나와 공유됨은 webUrl로만, R8.5)
  if (entry.isFolder && !shared) {
    return (
      <Link
        href={folderHref(
          entry.id,
          appendPathSegment(currentPath, entry.id, entry.name),
        )}
        className={rowClass}
      >
        {cells}
      </Link>
    );
  }
  if (entry.webUrl) {
    return (
      <a
        href={entry.webUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={rowClass}
      >
        {cells}
      </a>
    );
  }
  return <div className={rowClass}>{cells}</div>;
}

function FolderIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px] flex-none text-amber-600"
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}
