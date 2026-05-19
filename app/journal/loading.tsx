/**
 * /journal — loading skeleton.
 * Matches the page layout: header, 4-up stats strip, history table (6 rows).
 */

export default function JournalLoading() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-3">
          <div className="h-3 w-32 animate-pulse rounded bg-zinc-200" />
          <div className="h-8 w-56 animate-pulse rounded bg-zinc-200" />
          <div className="h-4 w-80 animate-pulse rounded bg-zinc-100" />
        </div>
        <div className="h-10 w-32 animate-pulse rounded-2xl bg-zinc-100" />
      </div>

      {/* Stats strip skeleton */}
      <section className="mt-6 rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm">
        <div className="h-3 w-48 animate-pulse rounded bg-zinc-200" />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-zinc-200 bg-white/60 p-3"
            >
              <div className="h-3 w-16 animate-pulse rounded bg-zinc-200" />
              <div className="mt-2 h-6 w-20 animate-pulse rounded bg-zinc-200" />
              <div className="mt-1 h-3 w-12 animate-pulse rounded bg-zinc-100" />
            </div>
          ))}
        </div>
      </section>

      {/* Action bar */}
      <div className="mt-6 flex justify-end">
        <div className="h-9 w-36 animate-pulse rounded-2xl bg-zinc-100" />
      </div>

      {/* History table skeleton — 6 rows */}
      <section className="mt-4 rounded-[28px] border border-white/70 bg-white/80 p-5 shadow-sm">
        <div className="space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-3"
            >
              <div className="flex items-center gap-3">
                <div className="h-4 w-14 animate-pulse rounded bg-zinc-200" />
                <div className="h-5 w-20 animate-pulse rounded-full bg-zinc-100" />
              </div>
              <div className="hidden gap-6 sm:flex">
                <div className="h-4 w-24 animate-pulse rounded bg-zinc-100" />
                <div className="h-4 w-24 animate-pulse rounded bg-zinc-100" />
              </div>
              <div className="flex items-center gap-3">
                <div className="h-4 w-12 animate-pulse rounded bg-zinc-100" />
                <div className="h-4 w-12 animate-pulse rounded bg-zinc-100" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
