export default function DigestLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <div className="space-y-2">
        <div className="h-7 w-44 animate-pulse rounded bg-zinc-200/80" />
        <div className="h-4 w-64 animate-pulse rounded bg-zinc-200/60" />
      </div>
      <div className="mt-6 h-32 animate-pulse rounded-[28px] border border-white/70 bg-white/60" />
      <div className="mt-6 space-y-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-[28px] border border-white/70 bg-white/60"
            style={{ animationDelay: `${i * 80}ms` }}
          />
        ))}
      </div>
    </main>
  );
}
