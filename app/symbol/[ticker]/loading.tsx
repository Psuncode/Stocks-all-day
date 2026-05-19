export default function SymbolLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8">
      {/* Hero header skeleton — matches the single-column v1.3.2 layout. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-10 w-40 animate-pulse rounded bg-zinc-200" />
          <div className="h-4 w-56 animate-pulse rounded bg-zinc-200/70" />
        </div>
        <div className="h-7 w-44 animate-pulse rounded-full bg-zinc-200/80" />
      </div>

      {/* Compact 4-up stat strip */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-2xl border border-white/70 bg-white/70"
            style={{ animationDelay: `${i * 60}ms` }}
          />
        ))}
      </div>

      {/* Hero chart panel */}
      <div className="mt-6 h-[320px] animate-pulse rounded-[28px] border border-white/70 bg-white/70" />

      {/* Plan + Thesis row */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded-[28px] border border-white/70 bg-white/70" />
        <div
          className="h-72 animate-pulse rounded-[28px] border border-white/70 bg-white/70"
          style={{ animationDelay: "100ms" }}
        />
      </div>

      {/* Context strip */}
      <div className="mt-6 h-32 animate-pulse rounded-[28px] border border-white/70 bg-white/70" />

      {/* Gate breakdown */}
      <div className="mt-6 h-64 animate-pulse rounded-[28px] border border-white/70 bg-white/70" />
    </main>
  );
}
