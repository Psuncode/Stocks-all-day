import ScannerClient from "@/app/scanner/scanner-client";

export default function ScannerPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-[family:var(--font-display)] text-2xl text-zinc-900">
          Scanner
        </h1>
        <div className="text-xs text-zinc-500 tabular-nums">
          $5–$100 · ADV$ ≥ $10M · spread ≤ 0.25%
        </div>
      </div>
      <div className="mt-4">
        <ScannerClient />
      </div>
    </main>
  );
}
