"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
        <h1 className="font-semibold text-red-700">문제가 발생했습니다</h1>
        <p className="mt-2 text-sm text-red-600">
          {error.message || "알 수 없는 오류"}
        </p>
        <button
          onClick={reset}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}
