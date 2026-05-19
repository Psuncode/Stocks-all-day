export default function SymbolLoading() {
  return (
    <main
      className="mx-auto max-w-7xl px-4 pb-16 pt-8"
      aria-hidden="true"
    >
      {/* Hero header — ticker + name on the left, decision/reason/watch on the right */}
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex items-baseline gap-3">
            <div className="h-9 w-28 animate-pulse rounded bg-zinc-200/80 md:h-10" />
            <div className="h-4 w-48 animate-pulse rounded bg-zinc-200/60" />
          </div>
          <div className="h-3.5 w-64 animate-pulse rounded bg-zinc-200/50" />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="h-7 w-20 animate-pulse rounded-full bg-zinc-200/80" />
          <div className="h-4 w-56 animate-pulse rounded bg-zinc-200/60" />
          <div className="h-8 w-20 animate-pulse rounded-full bg-zinc-200/70" />
        </div>
      </div>

      {/* 4-up stat strip — Spread / ADV$ / ATR / 52W range */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[68px] animate-pulse rounded-2xl border border-white/70 bg-white/70"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>

      {/* Hero chart panel (PriceChart h-80) */}
      <div className="mt-6 h-[392px] animate-pulse rounded-[28px] border border-white/70 bg-white/70" />

      {/* Plan + Thesis row (1-col mobile, 2-col lg) */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="h-80 animate-pulse rounded-[28px] border border-white/70 bg-white/70" />
        <div
          className="h-80 animate-pulse rounded-[28px] border border-white/70 bg-white/70"
          style={{ animationDelay: "100ms" }}
        />
      </div>

      {/* Context strip */}
      <div className="mt-6 h-40 animate-pulse rounded-[28px] border border-white/70 bg-white/70" />

      {/* Gate breakdown (full-width) */}
      <div className="mt-6 h-64 animate-pulse rounded-[28px] border border-white/70 bg-white/70" />
    </main>
  );
}
