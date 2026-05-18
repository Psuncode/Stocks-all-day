"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type PriceChartProps = {
  candles: { t: string; c: number }[];
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  variant?: "card" | "plain";
};

export function PriceChart({
  candles,
  entryPrice,
  stopPrice,
  targetPrice,
  variant = "card",
}: PriceChartProps) {
  if (candles.length === 0) return null;

  const first = candles[0]!.c;
  const last = candles[candles.length - 1]!.c;
  const positive = last >= first;

  const chart = (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={candles} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="t"
            tickFormatter={(v: string) => {
              const parts = v.split("-");
              return `${Number(parts[1])}/${Number(parts[2])}`;
            }}
            interval={Math.floor(candles.length / 6)}
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
            stroke="#94a3b8"
            tick={{ fontSize: 11 }}
            width={50}
          />
          <Tooltip
            formatter={(value: number | undefined) => [`$${(value ?? 0).toFixed(2)}`, "Close"]}
            labelFormatter={(label) => {
              const d = new Date(String(label) + "T00:00:00");
              return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            }}
            contentStyle={{
              backgroundColor: "white",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
              fontSize: "13px",
            }}
          />
          <Line
            type="monotone"
            dataKey="c"
            stroke={positive ? "#16a34a" : "#dc2626"}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          {entryPrice != null && (
            <ReferenceLine
              y={entryPrice}
              stroke="#2563eb"
              strokeDasharray="6 3"
              label={{ value: "Entry", position: "right", fontSize: 11, fill: "#2563eb" }}
            />
          )}
          {stopPrice != null && (
            <ReferenceLine
              y={stopPrice}
              stroke="#dc2626"
              strokeDasharray="6 3"
              label={{ value: "Stop", position: "right", fontSize: 11, fill: "#dc2626" }}
            />
          )}
          {targetPrice != null && (
            <ReferenceLine
              y={targetPrice}
              stroke="#16a34a"
              strokeDasharray="6 3"
              label={{ value: "Target", position: "right", fontSize: 11, fill: "#16a34a" }}
            />
          )}
      </LineChart>
    </ResponsiveContainer>
  );

  if (variant === "plain") return chart;

  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="mb-4">
        <div className="text-sm font-semibold text-zinc-900">Price history</div>
        <div className="mt-0.5 text-xs text-zinc-500">Daily close. Not a prediction.</div>
      </div>
      {chart}
    </div>
  );
}
