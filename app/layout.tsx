import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono, Sora } from "next/font/google";
import { NavLink } from "@/components/NavLink";
import { BottomNav } from "@/components/BottomNav";
import { MacroStrip } from "@/components/MacroStrip";
import { getMacroSnapshot } from "@/lib/data/fred";
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
  title: "Swing Workspace",
  description: "Personal swing-trading decision engine.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Swing",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e6f5c",
  viewportFit: "cover",
};

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-emerald-950 shadow-md md:h-11 md:w-11">
        <svg
          width="26"
          height="26"
          viewBox="0 0 28 28"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <line x1="4" y1="22" x2="24" y2="22" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" strokeLinecap="round" />
          <rect x="5" y="14" width="4" height="8" rx="1" fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
          <rect x="12" y="6" width="4" height="16" rx="1" fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.95)" strokeWidth="1.5" />
          <rect x="19" y="10" width="4" height="12" rx="1" fill="rgba(255,255,255,0.25)" stroke="rgba(255,255,255,0.85)" strokeWidth="1.5" />
          <path d="M7 12 Q14 4 21 8" stroke="rgba(255,255,255,0.95)" strokeWidth="1.75" strokeLinecap="round" fill="none" strokeDasharray="1.5 2.5" />
        </svg>
      </div>
      <div className="hidden md:block">
        <div className="text-[11px] uppercase tracking-[0.24em] text-emerald-800">
          Swing Workspace
        </div>
        <div className="font-[family:var(--font-display)] text-lg font-semibold text-zinc-900">
          Decision Engine
        </div>
      </div>
      <div className="font-[family:var(--font-display)] text-lg font-semibold text-zinc-900 md:hidden">
        Swing
      </div>
    </div>
  );
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const macroSnapshot = await getMacroSnapshot();
  return (
    <html lang="en">
      <body
        className={`${sora.variable} ${fraunces.variable} ${jetbrainsMono.variable} antialiased text-zinc-900`}
      >
        <div className="app-shell">
          <header className="sticky top-0 z-40 border-b border-white/60 bg-white/85 backdrop-blur">
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 md:py-4">
              <Wordmark />
              <nav className="hidden items-center gap-6 text-sm font-medium text-zinc-600 md:flex">
                <NavLink href="/scanner">Scanner</NavLink>
                <NavLink href="/watchlist">Watchlist</NavLink>
                <NavLink href="/digest">Digest</NavLink>
                <NavLink href="/settings">Settings</NavLink>
              </nav>
            </div>
          </header>

          {/* Desktop-only status strip. Hidden on phones to reclaim space. */}
          <div className="hidden md:block">
            <div className="mx-auto max-w-7xl px-4">
              <div className="mt-6 rounded-[32px] border border-white/80 bg-white/70 px-6 py-4 shadow-[0_30px_80px_-60px_rgba(15,23,42,0.6)]">
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
                  <div>Personal swing-trading tool · daily Slack digest · not investment advice</div>
                  <div className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Live data
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Macro regime context (desktop only, hidden when FRED_API_KEY is unset). */}
          <MacroStrip snapshot={macroSnapshot} />

          {/* Bottom padding on mobile so the fixed BottomNav doesn't cover page content. */}
          <div className="pb-20 md:pb-0">{children}</div>
        </div>
        <BottomNav />
      </body>
    </html>
  );
}
