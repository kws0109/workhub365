export function Placeholder({
  title,
  phase,
  description,
}: {
  title: string;
  phase: number;
  description: string;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center">
        <p className="text-sm font-medium text-zinc-600">
          Phase {phase}에서 구현 예정
        </p>
        <p className="mt-1 text-sm text-zinc-400">{description}</p>
      </div>
    </div>
  );
}
