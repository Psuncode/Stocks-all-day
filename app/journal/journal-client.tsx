"use client";

/**
 * /journal — client island.
 *
 * Owns:
 *   - the rendered trade list (so optimistic mutations update without an SSR
 *     round-trip)
 *   - the "Log new trade" expansion form
 *   - the row-click edit modal
 *
 * Server passes `initialTrades` once; subsequent state is local + POST/PUT.
 * On API failure we revert + show an inline error.
 */

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { Drawer } from "@/components/Drawer";
import type {
  TradeRecord,
  UpdateTradeInput,
} from "@/lib/journal/schema";

type SetupKey =
  | "PULLBACK"
  | "BASE_BREAKOUT"
  | "SQUEEZE"
  | "OVERSOLD_BOUNCE"
  | "NONE";

const SETUP_OPTIONS: ReadonlyArray<SetupKey> = [
  "PULLBACK",
  "BASE_BREAKOUT",
  "SQUEEZE",
  "OVERSOLD_BOUNCE",
  "NONE",
];

// Local form state — strings everywhere so empty inputs work. We coerce on submit.
type FormState = {
  ticker: string;
  side: "long" | "short";
  status: "open" | "closed";
  entry_date: string;
  entry_price: string;
  shares: string;
  setup_at_entry: "" | SetupKey;
  stop_price: string;
  watchlist_thesis_ticker: string;
  exit_date: string;
  exit_price: string;
  notes: string;
};

function freshForm(today: string): FormState {
  return {
    ticker: "",
    side: "long",
    status: "open",
    entry_date: today,
    entry_price: "",
    shares: "",
    setup_at_entry: "",
    stop_price: "",
    watchlist_thesis_ticker: "",
    exit_date: "",
    exit_price: "",
    notes: "",
  };
}

function tradeToForm(t: TradeRecord): FormState {
  return {
    ticker: t.ticker,
    side: t.side,
    status: t.status,
    entry_date: t.entry_date,
    entry_price: String(t.entry_price),
    shares: String(t.shares),
    setup_at_entry: (t.setup_at_entry ?? "") as "" | SetupKey,
    stop_price: t.stop_price != null ? String(t.stop_price) : "",
    watchlist_thesis_ticker: t.watchlist_thesis_ticker ?? "",
    exit_date: t.exit_date ?? "",
    exit_price: t.exit_price != null ? String(t.exit_price) : "",
    notes: t.notes ?? "",
  };
}

// Convert FormState to NewTradeInput / UpdateTradeInput payload.
// Returns either an object suitable for JSON.stringify or an error string.
function formToPayload(
  f: FormState,
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  const ticker = f.ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]+$/.test(ticker)) {
    return { ok: false, error: "Ticker must be A-Z, 0-9, ., -" };
  }
  const entry_price = Number(f.entry_price);
  const shares = Number(f.shares);
  if (!Number.isFinite(entry_price) || entry_price <= 0) {
    return { ok: false, error: "Entry price must be a positive number" };
  }
  if (!Number.isFinite(shares) || shares <= 0) {
    return { ok: false, error: "Shares must be a positive number" };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.entry_date)) {
    return { ok: false, error: "Entry date must be YYYY-MM-DD" };
  }

  const payload: Record<string, unknown> = {
    ticker,
    side: f.side,
    status: f.status,
    entry_date: f.entry_date,
    entry_price,
    shares,
  };

  if (f.setup_at_entry !== "") payload.setup_at_entry = f.setup_at_entry;
  if (f.stop_price.trim() !== "") {
    const sp = Number(f.stop_price);
    if (!Number.isFinite(sp) || sp <= 0) {
      return { ok: false, error: "Stop price must be a positive number" };
    }
    payload.stop_price = sp;
  }
  if (f.watchlist_thesis_ticker.trim() !== "") {
    payload.watchlist_thesis_ticker = f.watchlist_thesis_ticker.trim().toUpperCase();
  }
  if (f.notes.trim() !== "") payload.notes = f.notes.trim();

  if (f.status === "closed") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.exit_date)) {
      return { ok: false, error: "Closed trades require exit date" };
    }
    const ep = Number(f.exit_price);
    if (!Number.isFinite(ep) || ep <= 0) {
      return { ok: false, error: "Closed trades require a positive exit price" };
    }
    payload.exit_date = f.exit_date;
    payload.exit_price = ep;
  } else {
    // Open trades — strip any exit fields the user might've typed before flipping.
    if (f.exit_date) payload.exit_date = f.exit_date;
    if (f.exit_price.trim() !== "") {
      const ep = Number(f.exit_price);
      if (Number.isFinite(ep) && ep > 0) payload.exit_price = ep;
    }
  }

  return { ok: true, payload };
}

// Compute display fields. Pure — derives R only when stop_price is present.
// (Thesis-driven R lives on the server in DerivedStats; the row shows "—" if
// the trade has no explicit stop and we can't compute client-side. Server
// stats reflect the true number including thesis-resolved R.)
function rowFields(t: TradeRecord) {
  const direction = t.side === "short" ? -1 : 1;
  let pnl: number | null = null;
  let rMult: number | null = null;
  if (t.status === "closed" && t.exit_price != null) {
    pnl = (t.exit_price - t.entry_price) * direction * t.shares;
    if (t.stop_price != null) {
      const risk = (t.entry_price - t.stop_price) * direction;
      if (risk > 0) {
        rMult = ((t.exit_price - t.entry_price) * direction) / risk;
      }
    }
  }
  return { pnl, rMult };
}

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(0)}`;
}
function fmtR(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}
function moneyTone(n: number | null): string {
  if (n == null) return "text-zinc-500";
  if (n > 0) return "text-emerald-700";
  if (n < 0) return "text-red-700";
  return "text-zinc-700";
}

// ---------------------------------------------------------------------------

type Props = {
  initialTrades: TradeRecord[];
  today: string;
  activeTickers: string[];
  deleteEnabled: boolean;
};

export default function JournalClient({
  initialTrades,
  today,
  activeTickers,
  deleteEnabled,
}: Props) {
  const [trades, setTrades] = useState<TradeRecord[]>(initialTrades);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(() => freshForm(today));
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const sorted = useMemo(
    () => [...trades].sort((a, b) => (a.id < b.id ? 1 : -1)),
    [trades],
  );

  // ----- Add a trade -----
  const handleAdd = useCallback(async () => {
    setAddError(null);
    const built = formToPayload(addForm);
    if (!built.ok) {
      setAddError(built.error);
      return;
    }
    setAddBusy(true);
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(built.payload),
      });
      const body = (await res.json()) as
        | { ok: true; trade: TradeRecord }
        | { ok: false; reason: string };
      if (!res.ok || !body.ok) {
        setAddError(
          ("reason" in body && body.reason) || `HTTP ${res.status}`,
        );
        setAddBusy(false);
        return;
      }
      // Optimistic + authoritative: server returns the real record.
      setTrades((prev) => [body.trade, ...prev]);
      setAddForm(freshForm(today));
      setAddOpen(false);
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  }, [addForm, today]);

  // ----- Edit a trade -----
  const openEdit = useCallback((t: TradeRecord) => {
    setEditingId(t.id);
    setEditForm(tradeToForm(t));
    setEditError(null);
    setDeleteConfirm(false);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editingId || !editForm) return;
    setEditError(null);
    const built = formToPayload(editForm);
    if (!built.ok) {
      setEditError(built.error);
      return;
    }
    setEditBusy(true);

    // Optimistic: build a partial patch (only fields we sent) and merge locally.
    const before = trades.find((t) => t.id === editingId);
    const optimistic: TradeRecord | null = before
      ? ({
          ...before,
          ...(built.payload as Partial<TradeRecord>),
          // exit fields can move to null when user switches back to open
          exit_date:
            editForm.status === "open"
              ? before.exit_date
              : (built.payload.exit_date as string | undefined),
          exit_price:
            editForm.status === "open"
              ? before.exit_price
              : (built.payload.exit_price as number | undefined),
          updated_at: new Date().toISOString(),
        } as TradeRecord)
      : null;
    if (optimistic) {
      setTrades((prev) =>
        prev.map((t) => (t.id === editingId ? optimistic : t)),
      );
    }

    try {
      const res = await fetch(
        `/api/journal?id=${encodeURIComponent(editingId)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(built.payload as UpdateTradeInput),
        },
      );
      const body = (await res.json()) as
        | { ok: true; trade: TradeRecord }
        | { ok: false; reason: string };
      if (!res.ok || !body.ok) {
        // Revert optimistic merge
        if (before) {
          setTrades((prev) =>
            prev.map((t) => (t.id === editingId ? before : t)),
          );
        }
        setEditError(
          ("reason" in body && body.reason) || `HTTP ${res.status}`,
        );
        setEditBusy(false);
        return;
      }
      setTrades((prev) =>
        prev.map((t) => (t.id === editingId ? body.trade : t)),
      );
      setEditingId(null);
      setEditForm(null);
    } catch (e) {
      // Revert
      if (before) {
        setTrades((prev) =>
          prev.map((t) => (t.id === editingId ? before : t)),
        );
      }
      setEditError((e as Error).message);
    } finally {
      setEditBusy(false);
    }
  }, [editForm, editingId, trades]);

  const handleEditDelete = useCallback(async () => {
    if (!editingId) return;
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setEditBusy(true);
    const before = trades.find((t) => t.id === editingId);
    setTrades((prev) => prev.filter((t) => t.id !== editingId));
    try {
      const res = await fetch(
        `/api/journal?id=${encodeURIComponent(editingId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        // revert
        if (before) setTrades((prev) => [before, ...prev]);
        const body = (await res.json().catch(() => ({}))) as {
          reason?: string;
        };
        setEditError(body.reason ?? `HTTP ${res.status}`);
        setEditBusy(false);
        return;
      }
      setEditingId(null);
      setEditForm(null);
    } catch (e) {
      if (before) setTrades((prev) => [before, ...prev]);
      setEditError((e as Error).message);
    } finally {
      setEditBusy(false);
      setDeleteConfirm(false);
    }
  }, [deleteConfirm, editingId, trades]);

  // ----- Render -----
  return (
    <>
      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-zinc-500">
          {trades.length === 0
            ? "No trades yet."
            : `Showing ${trades.length} trade${trades.length === 1 ? "" : "s"} · newest first`}
        </div>
        <button
          type="button"
          onClick={() => setAddOpen((v) => !v)}
          className="rounded-2xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-900"
        >
          {addOpen ? "Close" : "Log new trade"}
        </button>
      </div>

      {/* Add form (collapsed by default) */}
      {addOpen ? (
        <section className="mt-4 rounded-[28px] border border-emerald-200 bg-white p-5 shadow-sm">
          <div className="text-xs uppercase tracking-[0.24em] text-emerald-800">
            New trade
          </div>
          <TradeForm
            form={addForm}
            setForm={setAddForm}
            activeTickers={activeTickers}
            today={today}
          />
          {addError ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {addError}
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAddForm(freshForm(today));
                setAddError(null);
              }}
              className="rounded-2xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              disabled={addBusy}
            >
              Reset
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={addBusy}
              className="rounded-2xl bg-emerald-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60"
            >
              {addBusy ? "Saving…" : "Save trade"}
            </button>
          </div>
        </section>
      ) : null}

      {/* History */}
      {sorted.length === 0 ? (
        <section className="mt-4 rounded-[28px] border border-dashed border-zinc-200 bg-white/40 p-8 text-center">
          <p className="text-sm text-zinc-600">
            Log your first trade to start tracking.
          </p>
          {!addOpen ? (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mt-3 inline-flex rounded-2xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
            >
              Log new trade
            </button>
          ) : null}
        </section>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="mt-4 grid gap-3 lg:hidden">
            {sorted.map((t) => (
              <TradeCardMobile key={t.id} t={t} onClick={() => openEdit(t)} />
            ))}
          </div>

          {/* Desktop table */}
          <section className="mt-4 hidden overflow-auto rounded-[28px] border border-white/70 bg-white/80 shadow-sm lg:block">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead className="bg-zinc-50/60 text-left text-xs text-zinc-500">
                <tr>
                  <th className="border-b px-4 py-2">Ticker</th>
                  <th className="border-b px-4 py-2">Setup</th>
                  <th className="border-b px-4 py-2">Status</th>
                  <th className="border-b px-4 py-2">Entry</th>
                  <th className="border-b px-4 py-2">Exit</th>
                  <th className="border-b px-4 py-2 text-right tabular-nums">
                    R-multiple
                  </th>
                  <th className="border-b px-4 py-2 text-right tabular-nums">
                    $ P&amp;L
                  </th>
                  <th className="border-b px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <TradeRow key={t.id} t={t} onEdit={() => openEdit(t)} />
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {/* Edit drawer */}
      <EditDrawer
        form={editForm}
        setForm={(next) =>
          setEditForm((prev) =>
            typeof next === "function"
              ? prev
                ? next(prev)
                : prev
              : next,
          )
        }
        today={today}
        activeTickers={activeTickers}
        busy={editBusy}
        error={editError}
        deleteEnabled={deleteEnabled}
        deleteConfirm={deleteConfirm}
        onCancel={() => {
          setEditingId(null);
          setEditForm(null);
          setEditError(null);
          setDeleteConfirm(false);
        }}
        onSave={handleEditSave}
        onDelete={handleEditDelete}
        onMarkClosed={() => {
          setEditForm((prev) =>
            prev
              ? {
                  ...prev,
                  status: "closed",
                  exit_date: prev.exit_date || today,
                }
              : prev,
          );
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared form
// ---------------------------------------------------------------------------

function TradeForm({
  form,
  setForm,
  activeTickers,
  today,
}: {
  form: FormState;
  setForm: (next: FormState | ((prev: FormState) => FormState)) => void;
  activeTickers: string[];
  today: string;
}) {
  // Use functional setForm so callers can pass either an updater or a value.
  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const [showOptional, setShowOptional] = useState(
    () =>
      form.setup_at_entry !== "" ||
      form.stop_price !== "" ||
      form.watchlist_thesis_ticker !== "" ||
      form.notes !== "",
  );

  return (
    <div className="mt-3 space-y-4">
      {/* Required row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Field label="Ticker" className="sm:col-span-1">
          <input
            type="text"
            value={form.ticker}
            onChange={(e) => set("ticker", e.target.value.toUpperCase())}
            placeholder="APLS"
            className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm uppercase focus:border-emerald-600 focus:outline-none"
            maxLength={10}
          />
        </Field>
        <Field label="Entry date" className="sm:col-span-2">
          <input
            type="date"
            value={form.entry_date || today}
            onChange={(e) => set("entry_date", e.target.value)}
            className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
          />
        </Field>
        <Field label="Entry $" className="sm:col-span-1">
          <input
            type="number"
            step="0.01"
            min="0"
            value={form.entry_price}
            onChange={(e) => set("entry_price", e.target.value)}
            placeholder="41.00"
            className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm tabular-nums focus:border-emerald-600 focus:outline-none"
          />
        </Field>
        <Field label="Shares" className="sm:col-span-1">
          <input
            type="number"
            step="1"
            min="0"
            value={form.shares}
            onChange={(e) => set("shares", e.target.value)}
            placeholder="100"
            className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm tabular-nums focus:border-emerald-600 focus:outline-none"
          />
        </Field>
        <Field label="Status" className="sm:col-span-1">
          <select
            value={form.status}
            onChange={(e) =>
              set("status", e.target.value as FormState["status"])
            }
            className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
      </div>

      {/* Closed-trade exit fields (auto-shown when status=closed) */}
      {form.status === "closed" ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Field label="Exit date" className="sm:col-span-2">
            <input
              type="date"
              value={form.exit_date || today}
              onChange={(e) => set("exit_date", e.target.value)}
              className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
            />
          </Field>
          <Field label="Exit $" className="sm:col-span-1">
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.exit_price}
              onChange={(e) => set("exit_price", e.target.value)}
              placeholder="43.00"
              className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm tabular-nums focus:border-emerald-600 focus:outline-none"
            />
          </Field>
        </div>
      ) : null}

      {/* Optional / collapsed fields */}
      <div>
        <button
          type="button"
          onClick={() => setShowOptional((v) => !v)}
          className="text-xs font-semibold text-emerald-800 hover:underline"
        >
          {showOptional ? "Hide details" : "Add details (setup, stop, notes)"}
        </button>
      </div>

      {showOptional ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <Field label="Setup" className="sm:col-span-2">
            <select
              value={form.setup_at_entry}
              onChange={(e) =>
                set("setup_at_entry", e.target.value as "" | SetupKey)
              }
              className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
            >
              <option value="">— none —</option>
              {SETUP_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase().replace("_", " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stop $" className="sm:col-span-1">
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.stop_price}
              onChange={(e) => set("stop_price", e.target.value)}
              placeholder="39.80"
              className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm tabular-nums focus:border-emerald-600 focus:outline-none"
            />
          </Field>
          <Field label="Linked thesis" className="sm:col-span-3">
            <select
              value={form.watchlist_thesis_ticker}
              onChange={(e) => set("watchlist_thesis_ticker", e.target.value)}
              className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
            >
              <option value="">— none —</option>
              {activeTickers.map((tk) => (
                <option key={tk} value={tk}>
                  {tk}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes" className="col-span-2 sm:col-span-6">
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              placeholder="Why this trade, how it played out…"
              className="block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="block text-[10px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: "open" | "closed" }) {
  if (status === "open") return <Badge tone="info">OPEN</Badge>;
  return <Badge tone="neutral">CLOSED</Badge>;
}

function SetupBadge({ setup }: { setup?: string }) {
  if (!setup || setup === "NONE") return <span className="text-zinc-400">—</span>;
  return <Badge tone="soft">{setup.toLowerCase().replace("_", " ")}</Badge>;
}

function TradeRow({ t, onEdit }: { t: TradeRecord; onEdit: () => void }) {
  const { pnl, rMult } = rowFields(t);
  const hasR = rMult != null;
  return (
    <tr
      className="text-sm transition-colors hover:bg-zinc-50/40"
      onClick={onEdit}
      style={{ cursor: "pointer" }}
    >
      <td className="border-b px-4 py-2">
        <Link
          href={`/symbol/${encodeURIComponent(t.ticker)}`}
          className="font-semibold text-zinc-900 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {t.ticker}
        </Link>
      </td>
      <td className="border-b px-4 py-2 text-xs text-zinc-600">
        <SetupBadge setup={t.setup_at_entry} />
      </td>
      <td className="border-b px-4 py-2">
        <StatusBadge status={t.status} />
      </td>
      <td className="border-b px-4 py-2 text-xs text-zinc-700 tabular-nums">
        ${t.entry_price.toFixed(2)} · {t.entry_date}
      </td>
      <td className="border-b px-4 py-2 text-xs text-zinc-700 tabular-nums">
        {t.exit_price != null && t.exit_date
          ? `$${t.exit_price.toFixed(2)} · ${t.exit_date}`
          : "—"}
      </td>
      <td
        className={`border-b px-4 py-2 text-right font-semibold tabular-nums ${
          hasR ? moneyTone(rMult) : "text-zinc-400"
        }`}
      >
        {fmtR(rMult)}
      </td>
      <td
        className={`border-b px-4 py-2 text-right font-semibold tabular-nums ${moneyTone(pnl)}`}
      >
        {fmtMoney(pnl)}
      </td>
      <td className="border-b px-4 py-2 text-right">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          Edit
        </button>
      </td>
    </tr>
  );
}

function TradeCardMobile({
  t,
  onClick,
}: {
  t: TradeRecord;
  onClick: () => void;
}) {
  const { pnl, rMult } = rowFields(t);
  const hasR = rMult != null;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="block w-full cursor-pointer rounded-2xl border border-white/70 bg-white/80 p-4 text-left shadow-sm transition-colors hover:bg-white"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-zinc-900">{t.ticker}</span>
            <SetupBadge setup={t.setup_at_entry} />
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 tabular-nums">
            entry ${t.entry_price.toFixed(2)} · {t.entry_date}
          </div>
          {t.exit_price != null && t.exit_date ? (
            <div className="text-[11px] text-zinc-500 tabular-nums">
              exit ${t.exit_price.toFixed(2)} · {t.exit_date}
            </div>
          ) : null}
        </div>
        <StatusBadge status={t.status} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-sm tabular-nums">
        <span className={`font-semibold ${hasR ? moneyTone(rMult) : "text-zinc-400"}`}>
          {fmtR(rMult)}
        </span>
        <span className={`font-semibold ${moneyTone(pnl)}`}>{fmtMoney(pnl)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit drawer — wraps the edit form in the accessible <Drawer> component
// (focus trap, Escape close, aria-modal, prior-focus restore handled there).
// ---------------------------------------------------------------------------

function EditDrawer({
  form,
  setForm,
  today,
  activeTickers,
  busy,
  error,
  deleteEnabled,
  deleteConfirm,
  onCancel,
  onSave,
  onDelete,
  onMarkClosed,
}: {
  form: FormState | null;
  setForm: (next: FormState | ((prev: FormState) => FormState)) => void;
  today: string;
  activeTickers: string[];
  busy: boolean;
  error: string | null;
  deleteEnabled: boolean;
  deleteConfirm: boolean;
  onCancel: () => void;
  onSave: () => void;
  onDelete: () => void;
  onMarkClosed: () => void;
}) {
  const open = form !== null;
  // Title is used by Drawer for aria-labelledby. Keep stable when closing
  // so the closing animation still has a label.
  const title = form ? `Edit trade · ${form.ticker || "—"}` : "Edit trade";

  return (
    <Drawer open={open} title={title} onClose={onCancel}>
      {form ? (
        <div>
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-xs uppercase tracking-[0.24em] text-emerald-800">
              Edit trade
            </div>
            {form.status === "open" ? (
              <button
                type="button"
                onClick={onMarkClosed}
                className="rounded-2xl border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                disabled={busy}
              >
                Mark closed
              </button>
            ) : null}
          </div>

          <TradeForm
            form={form}
            setForm={setForm}
            activeTickers={activeTickers}
            today={today}
          />

          {error ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            <div>
              {deleteEnabled ? (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busy}
                  className={`rounded-2xl border px-3 py-1.5 text-xs font-semibold ${
                    deleteConfirm
                      ? "border-red-400 bg-red-100 text-red-800 hover:bg-red-200"
                      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {deleteConfirm ? "Tap again to confirm delete" : "Delete"}
                </button>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-2xl border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={busy}
                className="rounded-2xl bg-emerald-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}
