import clsx from "clsx";

import type { ReactNode } from "react";

type Tone = "neutral" | "ok" | "watch" | "block" | "trade" | "soft" | "info";

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "ok" || tone === "trade") {
    return (
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        className="mr-1 shrink-0"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 6.5L4.5 9L10 3.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (tone === "watch") {
    return (
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        className="mr-1 shrink-0"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M6 1L11 10H1L6 1Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6 5V7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="6" cy="8.5" r="0.6" fill="currentColor" />
      </svg>
    );
  }
  if (tone === "block") {
    return (
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        className="mr-1 shrink-0"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3 6H9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (tone === "info") {
    return (
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        className="mr-1 shrink-0"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M6 5.5V8.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="6" cy="3.5" r="0.6" fill="currentColor" />
      </svg>
    );
  }
  return null;
}

export function Badge({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset";
  const styles: Record<Tone, string> = {
    neutral: "bg-zinc-50 text-zinc-600 ring-zinc-200",
    soft: "bg-slate-50 text-slate-600 ring-slate-200",
    info: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    ok: "bg-emerald-50 text-emerald-700 ring-emerald-300",
    trade: "bg-emerald-800 text-white ring-emerald-500 shadow-sm shadow-emerald-200",
    watch: "bg-amber-50 text-amber-800 ring-amber-300",
    block: "bg-zinc-100 text-zinc-600 ring-zinc-300",
  };
  return (
    <span className={clsx(base, styles[tone])}>
      <ToneIcon tone={tone} />
      {children}
    </span>
  );
}
