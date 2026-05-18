import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Sora } from "next/font/google";
import { NavLink } from "@/components/NavLink";
import { UserStatus } from "@/components/UserStatus";
import "./globals.css";

const sora = Sora({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Swing Decision Engine (Demo)",
  description: "Filter-first swing-trading decision engine demo (PASS/WATCH/TRADE).",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sora.variable} ${fraunces.variable} ${jetbrainsMono.variable} antialiased text-zinc-900`}>
        <div className="app-shell">
          <header className="sticky top-0 z-40 border-b border-white/60 bg-white/80 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="relative h-11 w-11 overflow-hidden rounded-2xl bg-emerald-950 shadow-md flex items-center justify-center">
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    {/* Baseline */}
                    <line x1="4" y1="22" x2="24" y2="22" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" />
                    {/* Three candles: short, tall, medium */}
                    <rect x="5" y="14" width="4" height="8" rx="1" fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
                    <rect x="12" y="6" width="4" height="16" rx="1" fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.95)" strokeWidth="1.5" />
                    <rect x="19" y="10" width="4" height="12" rx="1" fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
                    {/* Swing arc entry→target over middle candle */}
                    <path d="M7 12 Q14 4 21 8" stroke="rgba(255,255,255,0.95)" strokeWidth="1.75" strokeLinecap="round" fill="none" strokeDasharray="1.5 2.5" />
                  </svg>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-800">Swing Workspace</div>
                  <div className="font-[family:var(--font-display)] text-lg font-semibold text-zinc-900">
                    Decision Engine
                  </div>
                </div>
              </div>
              <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 md:flex">
                <NavLink href="/scanner">Scanner</NavLink>
                <NavLink href="/watchlist">Watchlist</NavLink>
                <NavLink href="/settings">Settings</NavLink>
                <NavLink href="/login">Login</NavLink>
              </nav>
              <UserStatus />
            </div>
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 border-t border-white/70 px-4 py-2 md:hidden">
              <nav className="flex flex-wrap gap-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
                <NavLink href="/scanner">Scanner</NavLink>
                <NavLink href="/watchlist">Watchlist</NavLink>
                <NavLink href="/settings">Settings</NavLink>
                <NavLink href="/login">Login</NavLink>
              </nav>
            </div>
          </header>
          <div className="mx-auto max-w-7xl px-4">
            <div className="mt-6 rounded-[32px] border border-white/80 bg-white/70 px-6 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.6)]">
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
                <div>
                  Multi-user demo · decision-first workflows · no predictions
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Markets synced 1 min ago
                </div>
              </div>
            </div>
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
