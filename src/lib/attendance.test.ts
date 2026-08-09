import { describe, expect, it } from "vitest";
import {
  aggregateWeeklyMinutes,
  isInWeek,
  kstDateOf,
  overtimeLevel,
  weekStartKst,
  workedMinutesBetween,
} from "./attendance";

describe("kstDateOf", () => {
  it("UTC 저녁은 KST 다음날", () => {
    // UTC 2026-08-07 16:00 = KST 2026-08-08 01:00
    expect(kstDateOf(new Date("2026-08-07T16:00:00Z"))).toBe("2026-08-08");
  });

  it("UTC 오전은 KST 같은 날", () => {
    expect(kstDateOf(new Date("2026-08-07T03:00:00Z"))).toBe("2026-08-07");
  });
});

describe("weekStartKst", () => {
  it("금요일 → 그 주 월요일", () => {
    // 2026-08-07은 금요일 (KST)
    expect(weekStartKst(new Date("2026-08-07T03:00:00Z"))).toBe("2026-08-03");
  });

  it("KST 월요일 자정 직후 = 그날이 주 시작 (UTC로는 일요일 저녁)", () => {
    // UTC 2026-08-09(일) 15:30 = KST 2026-08-10(월) 00:30
    expect(weekStartKst(new Date("2026-08-09T15:30:00Z"))).toBe("2026-08-10");
  });

  it("KST 일요일 밤 = 아직 이전 주", () => {
    // UTC 2026-08-09(일) 14:00 = KST 2026-08-09(일) 23:00
    expect(weekStartKst(new Date("2026-08-09T14:00:00Z"))).toBe("2026-08-03");
  });
});

describe("isInWeek", () => {
  it("월요일 포함, 다음 월요일 제외", () => {
    expect(isInWeek("2026-08-03", "2026-08-03")).toBe(true);
    expect(isInWeek("2026-08-09", "2026-08-03")).toBe(true);
    expect(isInWeek("2026-08-10", "2026-08-03")).toBe(false);
    expect(isInWeek("2026-08-02", "2026-08-03")).toBe(false);
  });
});

describe("aggregateWeeklyMinutes", () => {
  const week = "2026-08-03";

  it("주 내 확정 기록만 합산 — 미퇴근(null)은 제외", () => {
    const total = aggregateWeeklyMinutes(
      [
        { date: "2026-08-03", workedMinutes: 480 },
        { date: "2026-08-04", workedMinutes: 600 },
        { date: "2026-08-05", workedMinutes: null }, // 미퇴근
        { date: "2026-08-10", workedMinutes: 480 }, // 다음 주
      ],
      week,
    );
    expect(total).toBe(1080);
  });
});

describe("overtimeLevel", () => {
  it("48h 미만 ok / 48h 이상 warn / 52h 이상 over (경계 포함)", () => {
    expect(overtimeLevel(48 * 60 - 1)).toBe("ok");
    expect(overtimeLevel(48 * 60)).toBe("warn");
    expect(overtimeLevel(52 * 60 - 1)).toBe("warn");
    expect(overtimeLevel(52 * 60)).toBe("over");
  });
});

describe("workedMinutesBetween", () => {
  it("자정 넘김 근무도 단순 차이로 계산", () => {
    expect(
      workedMinutesBetween(
        new Date("2026-08-07T13:00:00Z"), // KST 22:00
        new Date("2026-08-07T17:30:00Z"), // KST 다음날 02:30
      ),
    ).toBe(270);
  });

  it("역전 시각은 0", () => {
    expect(
      workedMinutesBetween(
        new Date("2026-08-07T10:00:00Z"),
        new Date("2026-08-07T09:00:00Z"),
      ),
    ).toBe(0);
  });
});

// --- 인사팀 근태 정정 (W4) — 기존 블록은 그대로 두고 아래에 추가한다 ---
import {
  MAX_SHIFT_MINUTES,
  kstToUtc,
  nextKstDate,
  validateAttendanceCorrection,
  type AttendanceCorrectionCtx,
  type AttendanceCorrectionInput,
} from "./attendance";

describe("kstToUtc", () => {
  it("KST 09:00은 같은 날 UTC 00:00", () => {
    expect(kstToUtc("2026-08-05", "09:00")?.toISOString()).toBe(
      "2026-08-05T00:00:00.000Z",
    );
  });

  it("KST 자정 = 전날 UTC 15시", () => {
    expect(kstToUtc("2026-08-05", "00:00")?.toISOString()).toBe(
      "2026-08-04T15:00:00.000Z",
    );
  });

  it("월말 경계", () => {
    expect(kstToUtc("2026-08-01", "00:30")?.toISOString()).toBe(
      "2026-07-31T15:30:00.000Z",
    );
  });

  it("연말 경계", () => {
    expect(kstToUtc("2027-01-01", "08:00")?.toISOString()).toBe(
      "2026-12-31T23:00:00.000Z",
    );
  });

  it("kstDateOf와 왕복 항등", () => {
    for (const date of ["2026-08-05", "2026-01-01", "2026-12-31"]) {
      for (const time of ["00:00", "12:00", "23:59"]) {
        expect(kstDateOf(kstToUtc(date, time)!)).toBe(date);
      }
    }
  });

  it("형식 위반은 null", () => {
    expect(kstToUtc("2026-8-5", "09:00")).toBeNull();
    expect(kstToUtc("2026-08-05", "9:0")).toBeNull();
    expect(kstToUtc("2026-08-05", "24:00")).toBeNull();
    expect(kstToUtc("2026-08-05", "25:61")).toBeNull();
    expect(kstToUtc("", "09:00")).toBeNull();
    expect(kstToUtc("2026-08-05", "")).toBeNull();
    expect(kstToUtc("2026-13-01", "09:00")).toBeNull(); // 정규식은 통과하나 실재하지 않는 달
  });
});

describe("nextKstDate", () => {
  it("평년 2월 말 → 3월 1일", () => {
    expect(nextKstDate("2026-02-28")).toBe("2026-03-01");
  });

  it("윤년 2월 말 → 2월 29일", () => {
    expect(nextKstDate("2024-02-28")).toBe("2024-02-29");
  });

  it("연말 → 다음 해 1월 1일", () => {
    expect(nextKstDate("2025-12-31")).toBe("2026-01-01");
  });

  it("형식 위반은 null", () => {
    expect(nextKstDate("2026-2-28")).toBeNull();
    expect(nextKstDate("20260228")).toBeNull();
    expect(nextKstDate("")).toBeNull();
    expect(nextKstDate("2026-13-01")).toBeNull();
  });
});

describe("validateAttendanceCorrection", () => {
  const NOW = new Date("2026-08-09T12:00:00Z"); // KST 2026-08-09 21:00
  const at = (date: string, time: string) => kstToUtc(date, time)!;

  const input = (
    over: Partial<AttendanceCorrectionInput> = {},
  ): AttendanceCorrectionInput => ({
    checkInAt: at("2026-08-07", "09:00"),
    checkOutAt: at("2026-08-07", "18:00"),
    targetUserId: "emp-1",
    ...over,
  });

  const ctx = (
    over: Partial<AttendanceCorrectionCtx> = {},
  ): AttendanceCorrectionCtx => ({
    now: NOW,
    actor: { id: "hr-1", hrEditor: true },
    wasOpen: false,
    lockedCheckInAt: null,
    ...over,
  });

  it("권한 없는 actor는 거부", () => {
    const r = validateAttendanceCorrection(
      input(),
      ctx({ actor: { id: "hr-1", hrEditor: false } }),
    );
    expect(r).toEqual({ ok: false, reason: "인사 정정 권한이 없습니다" });
  });

  it("본인 기록 셀프 정정은 거부", () => {
    const r = validateAttendanceCorrection(
      input({ targetUserId: "hr-1" }),
      ctx(),
    );
    expect(r).toEqual({ ok: false, reason: "본인 기록은 정정할 수 없습니다" });
  });

  it("근무 중인 기록의 출근 시각 이동은 거부 (폭주 경로 봉쇄)", () => {
    const locked = at("2026-08-09", "09:00");
    const r = validateAttendanceCorrection(
      input({ checkInAt: at("2026-08-09", "08:00"), checkOutAt: at("2026-08-09", "18:00") }),
      ctx({ wasOpen: true, lockedCheckInAt: locked }),
    );
    expect(r).toEqual({
      ok: false,
      reason: "근무 중인 기록은 출근 시각을 바꿀 수 없습니다",
    });
  });

  it("근무 중인 기록도 출근 시각이 같으면 퇴근 누락 정정 가능", () => {
    const locked = at("2026-08-09", "09:00");
    const r = validateAttendanceCorrection(
      input({ checkInAt: locked, checkOutAt: at("2026-08-09", "18:00") }),
      ctx({ wasOpen: true, lockedCheckInAt: locked }),
    );
    expect(r).toEqual({ ok: true, date: "2026-08-09", workedMinutes: 540 });
  });

  it("역전 시각은 거부 (기존에는 조용히 0분으로 저장되던 케이스)", () => {
    const r = validateAttendanceCorrection(
      input({
        checkInAt: at("2026-08-07", "18:00"),
        checkOutAt: at("2026-08-07", "09:00"),
      }),
      ctx(),
    );
    expect(r).toEqual({
      ok: false,
      reason: "퇴근 시각은 출근 시각보다 뒤여야 합니다",
    });
  });

  it("동일 시각도 거부", () => {
    const same = at("2026-08-07", "09:00");
    const r = validateAttendanceCorrection(
      input({ checkInAt: same, checkOutAt: same }),
      ctx(),
    );
    expect(r).toEqual({
      ok: false,
      reason: "퇴근 시각은 출근 시각보다 뒤여야 합니다",
    });
  });

  it("1441분은 거부", () => {
    const checkInAt = at("2026-08-07", "09:00");
    const r = validateAttendanceCorrection(
      input({
        checkInAt,
        checkOutAt: new Date(checkInAt.getTime() + 1441 * 60_000),
      }),
      ctx(),
    );
    expect(r).toEqual({
      ok: false,
      reason: "한 건의 근무는 24시간을 넘을 수 없습니다",
    });
  });

  it("정확히 1440분은 통과 (경계 포함)", () => {
    const checkInAt = at("2026-08-07", "09:00");
    const r = validateAttendanceCorrection(
      input({
        checkInAt,
        checkOutAt: new Date(checkInAt.getTime() + MAX_SHIFT_MINUTES * 60_000),
      }),
      ctx(),
    );
    expect(r).toEqual({
      ok: true,
      date: "2026-08-07",
      workedMinutes: MAX_SHIFT_MINUTES,
    });
  });

  it("미래 출근 시각은 거부", () => {
    const r = validateAttendanceCorrection(
      input({
        checkInAt: at("2026-08-10", "09:00"),
        checkOutAt: at("2026-08-10", "18:00"),
      }),
      ctx(),
    );
    expect(r).toEqual({ ok: false, reason: "미래 시각은 입력할 수 없습니다" });
  });

  it("미래 퇴근 시각은 거부", () => {
    const r = validateAttendanceCorrection(
      input({
        checkInAt: at("2026-08-09", "09:00"), // NOW 이전
        checkOutAt: at("2026-08-09", "23:00"), // NOW 이후
      }),
      ctx(),
    );
    expect(r).toEqual({ ok: false, reason: "미래 시각은 입력할 수 없습니다" });
  });

  it("정상 09:00→18:00은 540분, 근무일은 체크인 날짜", () => {
    const checkInAt = at("2026-08-07", "09:00");
    const r = validateAttendanceCorrection(input({ checkInAt }), ctx());
    expect(r).toEqual({
      ok: true,
      date: kstDateOf(checkInAt),
      workedMinutes: 540,
    });
  });

  it("자정 넘김 근무는 체크인 날짜에 귀속", () => {
    const r = validateAttendanceCorrection(
      input({
        checkInAt: at("2026-08-04", "23:00"),
        checkOutAt: at("2026-08-05", "02:00"),
      }),
      ctx(),
    );
    expect(r).toEqual({ ok: true, date: "2026-08-04", workedMinutes: 180 });
  });

  it("자정 오귀속 정정 — 체크인을 전날로 옮기면 근무일도 파생 재계산", () => {
    const wrong = at("2026-08-05", "00:10"); // 정정 전: 2026-08-05로 귀속돼 있었다
    expect(kstDateOf(wrong)).toBe("2026-08-05");

    const r = validateAttendanceCorrection(
      input({
        checkInAt: at("2026-08-04", "23:50"),
        checkOutAt: at("2026-08-05", "03:50"),
      }),
      ctx(),
    );
    expect(r).toEqual({ ok: true, date: "2026-08-04", workedMinutes: 240 });
  });
});
