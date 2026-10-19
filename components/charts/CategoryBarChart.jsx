"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { colorOf, makeFormatter, AXIS_TICK, GRID_STROKE, TOOLTIP_STYLE } from "./theme";

/**
 * Horizontal bar chart for categories (departments, doctors, tests…).
 * data: [{ label, <seriesKey>: number }]; series: [{ key, label, color }].
 */
export function CategoryBarChart({ data, series, stacked = false, yLabel, money = false, currency = "PKR", locale = "en-PK", ariaLabel, rowHeight = 30, labelWidth = 150 }) {
  const fmt = makeFormatter({ money, currency, locale });
  const compact = makeFormatter({ money, currency, locale, compact: true });
  const height = Math.max(140, data.length * rowHeight * (stacked ? 1 : Math.max(1, series.length * 0.7)) + 56);
  return (
    <figure className="m-0" aria-label={ariaLabel}>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 16 }}>
            <CartesianGrid stroke={GRID_STROKE} horizontal={false} />
            <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} allowDecimals={money} tickFormatter={compact}
              label={yLabel ? { value: yLabel, position: "insideBottom", offset: -10, style: AXIS_TICK } : undefined} />
            <YAxis type="category" dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} width={labelWidth} interval={0}
              tickFormatter={(v) => (String(v).length > 24 ? `${String(v).slice(0, 23)}…` : v)} />
            <Tooltip formatter={(v, name) => [fmt(v), name]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(148,163,184,0.12)" }} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" iconSize={8} verticalAlign="top" />}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s.color)} stackId={stacked ? "a" : undefined} maxBarSize={18}
                radius={!stacked || i === series.length - 1 ? [0, 3, 3, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{ariaLabel}: {data.map((d) => `${d.label} ${series.map((s) => `${s.label} ${fmt(d[s.key])}`).join(", ")}`).join("; ")}</figcaption>
    </figure>
  );
}
