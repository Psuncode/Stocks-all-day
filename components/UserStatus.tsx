"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { DemoUser } from "@/lib/demo-auth";
import { clearDemoUser, getDemoUser } from "@/lib/demo-auth";

export function UserStatus() {
  const router = useRouter();
  const [user, setUser] = useState<DemoUser | null>(null);

  useEffect(() => {
    const sync = () => setUser(getDemoUser());
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800"
      >
        Sign In
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-full border border-white/70 bg-white/80 px-4 py-2 text-xs shadow-sm">
      <div>
        <div className="font-semibold text-zinc-900">{user.name}</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-emerald-800">
          {user.role} · {user.focus}
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          clearDemoUser();
          setUser(null);
          router.push("/login");
        }}
        className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600 hover:text-zinc-900"
      >
        Sign out
      </button>
    </div>
  );
}
