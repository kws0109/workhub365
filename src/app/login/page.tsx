import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";

export const metadata = { title: "로그인" };

// Auth.js는 로그인 실패 시 /login?error=... 로 리다이렉트한다
const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied:
    "이 계정으로는 로그인할 수 없습니다. 조직 테넌트 소속 계정인지 확인하세요.",
  Configuration:
    "서버 인증 설정 오류입니다. 관리자에게 문의하세요 (환경변수 확인).",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.id) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-bold tracking-tight">WorkHub365</h1>
        <p className="mt-2 text-sm text-zinc-500">
          M365 위에 얹히는 경량 그룹웨어. 조직의 Microsoft 365 계정으로
          로그인하세요.
        </p>
        {error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {ERROR_MESSAGES[error] ??
              "로그인에 실패했습니다. 잠시 후 다시 시도해주세요."}
          </p>
        )}
        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: "/" });
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-3 rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-zinc-700"
          >
            <MicrosoftLogo />
            Microsoft 계정으로 로그인
          </button>
        </form>
      </div>
    </main>
  );
}

function MicrosoftLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <rect x="0" y="0" width="7.4" height="7.4" fill="#f25022" />
      <rect x="8.6" y="0" width="7.4" height="7.4" fill="#7fba00" />
      <rect x="0" y="8.6" width="7.4" height="7.4" fill="#00a4ef" />
      <rect x="8.6" y="8.6" width="7.4" height="7.4" fill="#ffb900" />
    </svg>
  );
}
