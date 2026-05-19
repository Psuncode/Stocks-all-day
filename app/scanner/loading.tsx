export default function ScannerLoading() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6">
      <div className="flex items-baseline justify-between gap-3">
        <div className="h-7 w-28 animate-pulse rounded bg-zinc-200/80" />
        <div className="h-4 w-48 animate-pulse rounded bg-zinc-200/60" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <div className="h-72 animate-pulse rounded-[28px] border border-white/70 bg-white/60" />
        <div className="h-[480px] animate-pulse rounded-[28px] border border-white/70 bg-white/60" />
      </div>
    </main>
  );
}
