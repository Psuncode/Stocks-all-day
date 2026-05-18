import WatchlistClient from "@/app/watchlist/watchlist-client";

export default function WatchlistPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-emerald-800">Personal list</div>
          <h1 className="mt-2 font-[family:var(--font-display)] text-3xl text-zinc-900">Watchlist</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Keep a short list of tickers and refresh decisions on-demand.
          </p>
        </div>
        <div className="rounded-2xl border border-white/70 bg-white/80 px-5 py-3 text-xs text-zinc-500">
          Stored locally in your browser (localStorage).
        </div>
      </div>

      <div className="mt-8">
        <WatchlistClient />
      </div>
    </main>
  );
}
