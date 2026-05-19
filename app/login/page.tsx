"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { DemoUser } from "@/lib/demo-auth";
import { setDemoUser } from "@/lib/demo-auth";

const roles: DemoUser["role"][] = ["Trader", "Analyst", "PM", "Admin"];
const focuses: DemoUser["focus"][] = ["Momentum", "Breakouts", "Mean Reversion"];

export default function LoginPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<DemoUser["role"]>("Trader");
  const [focus, setFocus] = useState<DemoUser["focus"]>("Momentum");

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12">
      <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[32px] border border-white/60 bg-white/80 p-8 shadow-[0_40px_100px_-70px_rgba(15,23,42,0.7)]">
          <div className="text-[11px] uppercase tracking-[0.3em] text-emerald-800">Welcome back</div>
          <h1 className="mt-3 font-[family:var(--font-display)] text-3xl text-zinc-900">
            Sign in to your swing desk
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Personal swing-trading workspace — sign in to label this session.
          </p>

          <form
            className="mt-8 space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              setDemoUser({
                name,
                email,
                role,
                focus,
                lastLogin: new Date().toISOString(),
              });
              router.push("/scanner");
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Full name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                />
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Work email
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Role
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as DemoUser["role"])}
                  className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                >
                  {roles.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                Strategy focus
                <select
                  value={focus}
                  onChange={(event) => setFocus(event.target.value as DemoUser["focus"])}
                  className="mt-2 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 shadow-sm focus:border-emerald-300 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                >
                  {focuses.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                className="rounded-full bg-emerald-900 px-6 py-3 text-xs font-semibold uppercase tracking-[0.28em] text-white shadow-lg shadow-emerald-200/60"
              >
                Enter workspace
              </button>
              <button
                type="button"
                onClick={() => {
                  setDemoUser({
                    name: "Guest",
                    email: "guest@demo.local",
                    role: "Analyst",
                    focus: "Mean Reversion",
                    lastLogin: new Date().toISOString(),
                  });
                  router.push("/scanner");
                }}
                className="rounded-full border border-zinc-200 bg-white px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-600"
              >
                Continue as guest
              </button>
            </div>
          </form>
        </section>

        <aside className="space-y-6">
          <div className="rounded-[28px] border border-white/70 bg-white/80 p-6 shadow-[0_30px_70px_-60px_rgba(15,23,42,0.6)]">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">What you get</div>
            <div className="mt-4 space-y-4 text-sm text-zinc-700">
              <div>
                <div className="font-semibold text-zinc-900">CapIQ-ready ticker workspaces</div>
                <div className="mt-1 text-xs text-zinc-500">
                  Every stock page is pre-structured for Capital IQ fundamentals, ownership, and estimates.
                </div>
              </div>
              <div>
                <div className="font-semibold text-zinc-900">Decision-first gates</div>
                <div className="mt-1 text-xs text-zinc-500">
                  Focus on passes and watches before digging into deeper research.
                </div>
              </div>
              <div>
                <div className="font-semibold text-zinc-900">Team-ready views</div>
                <div className="mt-1 text-xs text-zinc-500">
                  Keep a common visual language across trader, analyst, and PM personas.
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/70 bg-white/80 p-6">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Demo notes</div>
            <ul className="mt-3 space-y-3 text-xs text-zinc-600">
              <li>Credentials are stored locally in your browser for the UI preview only.</li>
              <li>No server-side auth, Supabase, or SSO is wired yet.</li>
              <li>You can customize team roles once the backend is connected.</li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
