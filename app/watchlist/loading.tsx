export default function WatchlistLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6">
      <div className="flex items-baseline justify-between gap-3">
        <div className="h-7 w-32 animate-pulse rounded bg-zinc-200/80" />
        <div className="h-4 w-40 animate-pulse rounded bg-zinc-200/60" />
      </div>
      <div className="mt-6 grid gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-40 animate-pulse rounded-[28px] border border-white/70 bg-white/60"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>
    </main>
  );
}
