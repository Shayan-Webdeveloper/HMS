"use client";
import { ResponsiveContainer, BarChart, LineChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { colorOf, makeFormatter, AXIS_TICK, GRID_STROKE, TOOLTIP_STYLE } from "./theme";

/**
 * Daily series chart (bar, stacked bar or line).
 * data: [{ label: "09 Oct", <seriesKey>: number }]; series: [{ key, label, color }].
 */
export function TimeSeriesChart({ data, series, kind = "bar", stacked = false, height = 240, yLabel, money = false, currency = "PKR", locale = "en-PK", ariaLabel }) {
  const fmt = makeFormatter({ money, currency, locale });
  const compact = makeFormatter({ money, currency, locale, compact: true });
  const total = data.reduce((s, d) => s + series.reduce((t, x) => t + (Number(d[x.key]) || 0), 0), 0);
  const Chart = kind === "line" ? LineChart : BarChart;
  return (
    <figure className="m-0" aria-label={ariaLabel}>
      <div style={{ width: "100%", height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height }}>
          <Chart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={GRID_STROKE} vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={money} width={money ? 64 : 40} tickFormatter={compact}
              label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", offset: 10, style: { ...AXIS_TICK, textAnchor: "middle" } } : undefined} />
            <Tooltip formatter={(v, name) => [fmt(v), name]} contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(148,163,184,0.12)" }} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />}
            {series.map((s, i) => (kind === "line"
              ? <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colorOf(s.color)} strokeWidth={2} dot={data.length <= 31 ? { r: 2.5 } : false} activeDot={{ r: 4 }} isAnimationActive={false} />
              : <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s.color)} stackId={stacked ? "a" : undefined} maxBarSize={36}
                radius={!stacked || i === series.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />))}
          </Chart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{ariaLabel}. Total across the period: {fmt(total)}.</figcaption>
    </figure>
  );
}
