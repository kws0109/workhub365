-- 같은 사용자의 활성 휴가(대기/1차/승인) 기간 겹침을 DB가 원천 차단한다.
-- 앱 레벨 검사(check-then-insert)는 TOCTOU가 있고, READ COMMITTED에서
-- 두 결재자가 겹치는 두 대기 신청을 동시에 승인하는 경합을 막지 못한다.
-- 이 제약 하나로 생성·승인 양쪽 경로가 모두 봉쇄된다 (SQLSTATE 23P01).

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leave_requests_no_overlap'
  ) THEN
    ALTER TABLE leave_requests
      ADD CONSTRAINT leave_requests_no_overlap
      EXCLUDE USING gist (
        user_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
      )
      WHERE (status IN ('pending', 'approved_1', 'approved'));
  END IF;
END $$;
