import { requireSession } from "@/lib/auth-helpers";

export default async function HomePage() {
  const session = await requireSession();

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        안녕하세요, {session.user.name}님
      </h1>
      <p className="mt-2 text-sm text-zinc-500">
        WorkHub365에 로그인되었습니다. 왼쪽 메뉴에서 기능을 선택하세요.
      </p>
      <div className="mt-8 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <StatusCard
          title="휴가 · 근태"
          body="휴가 신청과 출퇴근 체크 (Phase 4에서 구현)"
        />
        {session.user.role === "admin" && (
          <>
            <StatusCard
              title="라이선스"
              body="현황·낭비 분석 대시보드 (Phase 2에서 구현)"
            />
            <StatusCard
              title="온보딩/오프보딩"
              body="계정 수명주기 자동화 (Phase 3에서 구현)"
            />
            <StatusCard
              title="AI 어시스턴트"
              body="자연어 관리 액션 (Phase 5에서 구현)"
            />
          </>
        )}
      </div>
    </div>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-zinc-500">{body}</p>
    </div>
  );
}
