import { describe, expect, it } from "vitest";
import {
  appendPathSegment,
  parsePathParam,
  slicePathParam,
} from "./drive-path";

describe("appendPathSegment", () => {
  it("빈 경로에서 시작", () => {
    expect(appendPathSegment("", "A1", "문서")).toBe("A1:%EB%AC%B8%EC%84%9C");
  });

  it("세그먼트를 /로 누적", () => {
    const p1 = appendPathSegment("", "A1", "docs");
    expect(appendPathSegment(p1, "B2", "2026")).toBe("A1:docs/B2:2026");
  });

  it("이름의 구분자(/ :)는 인코딩되어 충돌하지 않는다", () => {
    const p = appendPathSegment("", "A1", "a/b:c");
    expect(parsePathParam(p)).toEqual([{ id: "A1", name: "a/b:c" }]);
  });
});

describe("parsePathParam", () => {
  it("왕복 보존", () => {
    let p = "";
    p = appendPathSegment(p, "A1", "문서");
    p = appendPathSegment(p, "B2", "회의록");
    expect(parsePathParam(p)).toEqual([
      { id: "A1", name: "문서" },
      { id: "B2", name: "회의록" },
    ]);
  });

  it("빈 값·undefined는 빈 배열", () => {
    expect(parsePathParam(undefined)).toEqual([]);
    expect(parsePathParam("")).toEqual([]);
  });

  it("손상 세그먼트(구분자 없음·빈 id·잘못된 인코딩)는 버린다", () => {
    expect(parsePathParam("noseparator/A1:ok/:noid")).toEqual([
      { id: "A1", name: "ok" },
    ]);
    expect(parsePathParam("A1:%E0%A4%A")).toEqual([]); // 불완전 퍼센트 인코딩
  });
});

describe("slicePathParam", () => {
  const segments = parsePathParam("A1:docs/B2:2026/C3:report");

  it("앞에서 count개만 남긴다", () => {
    expect(slicePathParam(segments, 1)).toBe("A1:docs");
    expect(slicePathParam(segments, 2)).toBe("A1:docs/B2:2026");
  });

  it("전체·0개 경계", () => {
    expect(slicePathParam(segments, 3)).toBe("A1:docs/B2:2026/C3:report");
    expect(slicePathParam(segments, 0)).toBe("");
  });

  it("인코딩 왕복 보존", () => {
    const enc = parsePathParam(appendPathSegment("", "A1", "분기 보고/초안"));
    expect(parsePathParam(slicePathParam(enc, 1))).toEqual([
      { id: "A1", name: "분기 보고/초안" },
    ]);
  });
});
