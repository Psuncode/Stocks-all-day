export default function SymbolLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-10">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-3">
          <div className="h-3 w-32 animate-pulse rounded bg-zinc-200/80" />
          <div className="h-9 w-72 animate-pulse rounded bg-zinc-200" />
          <div className="h-4 w-40 animate-pulse rounded bg-zinc-200/60" />
        </div>
        <div className="h-24 w-48 animate-pulse rounded-[28px] border border-white/70 bg-white/70" />
      </div>
      <div className="mt-8 grid gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-white/70 bg-white/70"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="h-[360px] animate-pulse rounded-[28px] border border-white/70 bg-white/70" />
        <div className="space-y-6">
          <div className="h-48 animate-pulse rounded-[28px] border border-white/70 bg-white/70" />
          <div className="h-48 animate-pulse rounded-[28px] border border-white/70 bg-white/70" />
        </div>
      </div>
    </main>
  );
}
