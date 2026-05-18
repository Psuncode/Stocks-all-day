"use client";

import { useEffect, useRef, useCallback } from "react";
import clsx from "clsx";

import type { ReactNode } from "react";

const FOCUSABLE_SELECTORS =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Drawer({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const asideRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const priorFocusRef = useRef<Element | null>(null);

  // Escape-to-close
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Store prior focus, focus close button on open; restore on close
  useEffect(() => {
    if (open) {
      priorFocusRef.current = document.activeElement;
      requestAnimationFrame(() => {
        closeButtonRef.current?.focus();
      });
    } else {
      if (priorFocusRef.current instanceof HTMLElement) {
        priorFocusRef.current.focus();
      }
      priorFocusRef.current = null;
    }
  }, [open]);

  // Focus trap
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key !== "Tab" || !asideRef.current) return;

      const focusable = Array.from(
        asideRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS),
      ).filter((el) => !el.hasAttribute("disabled"));

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [],
  );

  return (
    <div
      className={clsx(
        "fixed inset-0 z-50",
        open ? "pointer-events-auto" : "pointer-events-none",
      )}
      aria-hidden={!open}
      tabIndex={open ? undefined : -1}
    >
      <div
        className={clsx(
          "absolute inset-0 bg-black/30 backdrop-blur-sm transition-all duration-300",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        onKeyDown={handleKeyDown}
        className={clsx(
          "absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl transition-transform",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center justify-between border-b bg-gradient-to-r from-zinc-50 to-white px-5 py-4">
          <div className="min-w-0">
            <div id="drawer-title" className="truncate text-sm font-semibold text-zinc-900">
              {title}
            </div>
            <div className="text-xs text-zinc-500">Why blocked? Gate-by-gate, no fluff.</div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
          >
            Close
          </button>
        </div>
        <div className="h-[calc(100%-57px)] overflow-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}
