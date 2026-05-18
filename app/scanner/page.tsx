import ScannerClient from "@/app/scanner/scanner-client";

export default function ScannerPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-emerald-800">Decision flow</div>
          <h1 className="mt-2 font-[family:var(--font-display)] text-3xl text-zinc-900">Swing Scanner</h1>
          <p className="mt-2 max-w-2xl text-sm text-zinc-600">
            Filter-first decision engine. The goal is to help you <span className="font-medium">PASS instantly</span>,
            not to predict.
          </p>
        </div>
        <div className="rounded-2xl border border-white/70 bg-white/80 px-5 py-3 text-xs text-zinc-500">
          Universe: $5–$100, ADV$ ≥ $5M. Engine gates: $10–$50, spread ≤ 0.25%.
        </div>
      </div>

      <div className="mt-8">
        <ScannerClient />
      </div>
    </main>
  );
}
