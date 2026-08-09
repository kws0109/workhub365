import "server-only";

import { delegatedGraphFetch } from "./delegated";

// 문서함(B5, R8.5) — 위임 Files.Read 읽기 전용. 쓰기 호출은 없다
// (업로드·새 폴더는 OneDrive 딥링크 위임, feature-map 7절).
// 브레드크럼은 ?path= 쿼리에 "id:이름" 세그먼트를 누적하는 URL 설계로
// 해결한다(src/lib/drive-path.ts) — 경로 복원용 Graph 추가 호출 없음.

/** OneDrive 저장 공간 (바이트) */
export type DriveQuota = { used: number; total: number };

export async function getDriveQuota(token: string): Promise<DriveQuota> {
  const drive = await delegatedGraphFetch<{
    quota?: { used?: number; total?: number };
  }>(token, "/me/drive?$select=quota");
  return { used: drive.quota?.used ?? 0, total: drive.quota?.total ?? 0 };
}

/** Graph driveItem 원본 (필요 필드만) — createdBy/lastModifiedBy는 기본 포함이라 $select만으로 충분 */
type RawIdentitySet = { user?: { displayName?: string } };
type RawDriveItem = {
  id: string;
  name?: string;
  size?: number;
  webUrl?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount?: number };
  file?: unknown;
  lastModifiedBy?: RawIdentitySet;
  createdBy?: RawIdentitySet;
  /** sharedWithMe 항목은 실체 메타데이터가 remoteItem 안에 있다 */
  remoteItem?: Omit<RawDriveItem, "remoteItem">;
};

/** 화면용으로 평탄화한 드라이브 항목 */
export type DriveEntry = {
  id: string;
  name: string;
  isFolder: boolean;
  /** 폴더는 null (childCount는 표시하지 않음) */
  size: number | null;
  webUrl: string | null;
  lastModifiedAt: Date | null;
  modifiedBy: string | null;
};

function toEntry(raw: RawDriveItem): DriveEntry {
  // 나와 공유됨 항목: name·size·webUrl·수정 정보가 remoteItem 안에 있다
  const r = raw.remoteItem;
  const isFolder = Boolean(r?.folder ?? raw.folder);
  const size = r?.size ?? raw.size;
  const modified = r?.lastModifiedDateTime ?? raw.lastModifiedDateTime;
  return {
    id: raw.id,
    name: r?.name ?? raw.name ?? "(이름 없음)",
    isFolder,
    size: isFolder ? null : (size ?? null),
    webUrl: r?.webUrl ?? raw.webUrl ?? null,
    lastModifiedAt: modified ? new Date(modified) : null,
    modifiedBy:
      r?.lastModifiedBy?.user?.displayName ??
      raw.lastModifiedBy?.user?.displayName ??
      r?.createdBy?.user?.displayName ??
      raw.createdBy?.user?.displayName ??
      null,
  };
}

/** 폴더 우선 → 이름 가나다순 — Graph $orderby의 폴더 우선 정렬이 드라이브 종류에 따라
 *  일관되지 않아 클라이언트 정렬로 통일한다 */
function folderFirst(a: DriveEntry, b: DriveEntry): number {
  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
  return a.name.localeCompare(b.name, "ko");
}

const CHILD_SELECT =
  "$select=id,name,size,lastModifiedDateTime,folder,file,webUrl,lastModifiedBy" +
  "&$top=200";

/** 내 파일 목록 — itemId 없으면 루트. 한 폴더 200건까지(데모 규모 충분, 페이징 생략) */
export async function getDriveChildren(
  token: string,
  itemId?: string,
): Promise<DriveEntry[]> {
  const base = itemId
    ? `/me/drive/items/${encodeURIComponent(itemId)}/children`
    : "/me/drive/root/children";
  const page = await delegatedGraphFetch<{ value: RawDriveItem[] }>(
    token,
    `${base}?${CHILD_SELECT}`,
  );
  return page.value.map(toEntry).sort(folderFirst);
}

/** 나와 공유됨 — remoteItem 평탄화. Graph 기본 정렬(최근 공유 순) 유지 */
export async function getSharedWithMe(token: string): Promise<DriveEntry[]> {
  const page = await delegatedGraphFetch<{ value: RawDriveItem[] }>(
    token,
    "/me/drive/sharedWithMe",
  );
  return page.value.map(toEntry);
}

/** 홈 최근 문서 위젯(B7) — /me/drive/recent에서 파일만 상위 limit건 */
export async function getRecentFiles(
  token: string,
  limit = 3,
): Promise<DriveEntry[]> {
  const page = await delegatedGraphFetch<{ value: RawDriveItem[] }>(
    token,
    "/me/drive/recent?$top=10",
  );
  return page.value
    .map(toEntry)
    .filter((e) => !e.isFolder)
    .slice(0, limit);
}
