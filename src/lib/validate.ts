// 입력 형식·오류 메시지 위생 — DB·UI에 의존하지 않는 순수 함수 (단위 테스트 대상).
//
// 서버 액션이 받는 ID는 폼 필드라 위조할 수 있다. 형식 검증 없이 uuid 컬럼 비교로
// 넘기면 Postgres가 22P02(invalid input syntax for type uuid: "x")로 죽는데,
// 그 결과는 두 갈래로 새어 나온다:
//  - try/catch가 있는 액션: 드라이버 오류 원문이 그대로 인라인 오류에 노출된다
//  - try/catch가 없는 액션: 서버 액션이 던져 화면이 오류 경계로 떨어진다
// 두 갈래 모두 "잘못된 입력"이라는 사용자 언어로 접는 것이 이 모듈의 목적이다.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Postgres uuid 컬럼 비교에 넣어도 캐스팅 오류가 나지 않는 형식인지.
 * 버전·variant 비트는 보지 않는다 — 목적은 신원 검증이 아니라 캐스팅 방어다.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** 드라이버가 붙인 SQLSTATE 등 code 속성을 가진 오류인지 (앱이 던진 Error에는 없다) */
function hasDriverCode(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code !== undefined
  );
}

/**
 * 서버 액션 catch 공통 — 사용자에게 보여줄 메시지를 고른다.
 * 앱이 의도적으로 던진 Error("신청을 찾을 수 없습니다")는 그대로 통과시키고,
 * code 속성을 가진 드라이버·시스템 오류(22P02, 23505, ECONNREFUSED …)는
 * 내부 사정이 드러나지 않도록 일반 문구로 접는다.
 */
export function actionErrorMessage(
  e: unknown,
  fallback = "처리 중 오류가 발생했습니다",
): string {
  if (e instanceof Error && !hasDriverCode(e) && e.message) return e.message;
  return fallback;
}
