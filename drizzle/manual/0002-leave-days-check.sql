-- 휴가 일수의 절대 상한을 DB에도 둔다 (앱 상한 MAX_LEAVE_SPAN_DAYS = 366과 대칭).
-- days는 numeric(4,1)이라 999.9를 넘으면 Postgres가 22003(numeric_value_out_of_range)을
-- 던지는데, 그건 '막았다'가 아니라 '터졌다'에 가깝다. CHECK를 두면 366 초과가
-- 23514(check_violation)로 명확히 거부되고, 앱 상한을 우회한 경로(직접 SQL·향후 신규
-- 호출부)도 같은 선에서 걸린다. 앱 catch가 23514·22003을 인라인 오류로 매핑한다.
--
-- 적용 전 기존 위반 행 확인:
--   SELECT id, days FROM leave_requests WHERE days <= 0 OR days > 366;
-- 위반 행이 있으면 ALTER가 실패한다 — 먼저 정정한 뒤 다시 실행한다.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_days_range'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_days_range
      CHECK (days > 0 AND days <= 366);
  END IF;
END $$;
