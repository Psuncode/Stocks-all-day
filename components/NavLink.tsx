"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = path.startsWith(href);
  return (
    <Link
      href={href}
      className={clsx(
        "text-sm transition-colors",
        active
          ? "text-emerald-900 font-semibold"
          : "text-zinc-500 hover:text-emerald-900"
      )}
    >
      {children}
    </Link>
  );
}
