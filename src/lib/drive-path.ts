// 문서함 브레드크럼 경로(B5, R8.5) — 순수 함수.
// 폴더 진입 시 ?path= 쿼리에 "id:이름" 세그먼트를 "/"로 이어 누적한다.
// 경로 복원을 위한 Graph 추가 호출이 필요 없도록 URL에 상태를 싣는 설계.
// 이름은 세그먼트 구분자("/", ":")와 충돌하지 않도록 encodeURIComponent로 감싼다.

export type PathSegment = { id: string; name: string };

/** 기존 path 문자열 뒤에 폴더 세그먼트를 누적 */
export function appendPathSegment(
  path: string,
  id: string,
  name: string,
): string {
  const segment = `${id}:${encodeURIComponent(name)}`;
  return path ? `${path}/${segment}` : segment;
}

/** ?path= 값을 세그먼트 배열로 복원 — 손상된 세그먼트(구분자 없음·빈 id)는 버린다 */
export function parsePathParam(path: string | undefined): PathSegment[] {
  if (!path) return [];
  const out: PathSegment[] = [];
  for (const part of path.split("/")) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const id = part.slice(0, at);
    try {
      out.push({ id, name: decodeURIComponent(part.slice(at + 1)) });
    } catch {
      continue; // 잘못된 인코딩 — 해당 세그먼트만 무시
    }
  }
  return out;
}

/** 앞에서 count개 세그먼트만 남긴 path 문자열 — 브레드크럼 중간 클릭용 */
export function slicePathParam(segments: PathSegment[], count: number): string {
  return segments
    .slice(0, count)
    .map((s) => `${s.id}:${encodeURIComponent(s.name)}`)
    .join("/");
}
