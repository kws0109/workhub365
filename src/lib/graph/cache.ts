import "server-only";

// Graph 조회 결과의 프로세스 내 TTL 캐시.
// Graph 호출은 수백 ms~1초 — 짧은 TTL로도 페이지 이동 체감이 크게 개선된다.
// 서버리스 다중 인스턴스에서는 인스턴스별 캐시라 최대 TTL만큼의 지연이 있을 수 있다(허용).

type Entry = { at: number; value: unknown };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export async function cachedGraph<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T;

  // single-flight: 동시 요청이 같은 Graph 호출을 중복 발사하지 않게
  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const p = fn()
    .then((value) => {
      store.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/**
 * 디렉터리를 변경한 직후(온보딩/오프보딩 등) 호출 — 이전 조회 결과를 버린다.
 * inflight도 함께 버려야 한다: 변경 전에 시작된 조회가 bust 이후 완료되며
 * 옛 데이터를 새 타임스탬프로 재적재하는 것을 막는다.
 * 주의: 이 무효화는 현재 인스턴스에만 적용된다 — 다른 인스턴스는 TTL(최대 60초)
 * 동안 이전 데이터를 볼 수 있다 (허용된 트레이드오프, 다중 인스턴스 배포 시 유의)
 */
export function bustGraphCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    inflight.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of inflight.keys()) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}
