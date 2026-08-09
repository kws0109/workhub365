"use client";

import { useEffect, useState } from "react";

// 현재 시각 라인(B2) — 서버 스냅샷이 아닌 클라이언트 시계 기준, 1분 갱신.
// 오늘 컬럼에서만 렌더되며 그리드 창(08~19시) 밖이면 숨긴다.
export function NowLine({
  startHour,
  endHour,
  pxPerHour,
}: {
  startHour: number;
  endHour: number;
  pxPerHour: number;
}) {
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    const update = () => {
      // 뷰어 로컬이 아닌 KST 고정 (표시 규칙: 서버 UTC 저장, 표시는 KST)
      const [h, m] = new Date()
        .toLocaleTimeString("en-GB", {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          minute: "2-digit",
        })
        .split(":")
        .map(Number);
      setMinutes(h * 60 + m);
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  if (minutes === null) return null;
  const hours = minutes / 60;
  if (hours < startHour || hours > endHour) return null;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-red-500"
      style={{ top: (hours - startHour) * pxPerHour }}
    >
      <span className="absolute -left-px -top-[2.5px] h-[7px] w-[7px] rounded-full bg-red-500" />
    </div>
  );
}
