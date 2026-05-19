import Link from "next/link";
import clsx from "clsx";

export default function SettingsPage() {
  const enabled = Boolean(process.env.GEMINI_API_KEY);
  const model = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-10">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-emerald-800">Workspace</div>
          <h1 className="mt-2 font-[family:var(--font-display)] text-3xl text-zinc-900">Settings</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Personal swing-trading workspace. Optionally uses Gemini for plain-English explanations.
          </p>
        </div>
        <Link
          href="/scanner"
          className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800"
        >
          Back to scanner
        </Link>
      </div>

      <div className="mt-8 space-y-5">
        <section className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Gemini</div>
              <div className="mt-2 flex items-center gap-2 text-sm text-zinc-700">
                <span
                  className={clsx(
                    "inline-block h-2 w-2 rounded-full",
                    enabled ? "bg-emerald-500" : "bg-zinc-300"
                  )}
                />
                {enabled ? "ENABLED" : "DISABLED"}
              </div>
              <div className="mt-1 text-xs text-zinc-500">Model: {model}</div>
            </div>
          </div>

          {!enabled && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="text-xs font-semibold uppercase tracking-[0.2em]">How to connect Gemini</div>
              <ol className="mt-3 list-decimal space-y-1 pl-5">
                <li>Create an API key in Google AI Studio (Gemini API).</li>
                <li>
                  Add it as an env var named <span className="font-mono">GEMINI_API_KEY</span>.
                </li>
                <li>Restart the server.</li>
              </ol>
              <div className="mt-3 text-xs text-amber-900/80">
                For deployments (Vercel/Render/etc) you set env vars in the platform UI. The key never
                goes to the browser.
              </div>
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Deploy</div>
          <div className="mt-3 text-sm text-zinc-700">
            This is a standard Next.js app. To go live, deploy to Vercel and set
            <span className="font-mono"> GEMINI_API_KEY</span> (optional).
          </div>
          <div className="mt-3 text-xs text-zinc-500">
            Uses live Yahoo Finance data via yahoo-finance2 (no key required).
          </div>
        </section>

        <section className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-sm">
          <div className="text-xs uppercase tracking-[0.24em] text-zinc-500">Local run</div>
          <div className="mt-3 text-sm text-zinc-700">
            Run locally from the <span className="font-mono">swing-trader-demo</span> folder:
          </div>
          <pre className="mt-4 overflow-auto rounded-2xl bg-white/80 p-4 text-xs text-zinc-800">
            {`npm install\nnpm run dev`}
          </pre>
          <div className="mt-3 text-xs text-zinc-500">
            If you see a lock error, make sure only one <span className="font-mono">next dev</span>
            instance is running for this folder.
          </div>
        </section>
      </div>
    </main>
  );
}
