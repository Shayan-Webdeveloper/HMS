// Chart palette — taken from the design tokens in styles/globals.css. Keep charts to these few colours.
export const CHART_COLORS = {
  primary: "#1e4fd8",
  teal: "#0d9488",
  amber: "#b45309",
  red: "#c81e1e",
  slate: "#94a3b8",
};

export const colorOf = (name) => CHART_COLORS[name] || name || CHART_COLORS.primary;

export const AXIS_TICK = { fontSize: 11, fill: "#556274" };
export const GRID_STROKE = "#e3e8ef";
export const TOOLTIP_STYLE = { borderRadius: 8, border: "1px solid #e3e8ef", fontSize: 12, boxShadow: "0 4px 12px rgba(15,23,42,0.07)" };

export function makeFormatter({ money, currency, locale, compact }) {
  if (money) {
    let f;
    try {
      f = new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: compact ? 0 : 2, notation: compact ? "compact" : "standard" });
    } catch {
      f = new Intl.NumberFormat("en", { maximumFractionDigits: 2, notation: compact ? "compact" : "standard" });
    }
    return (v) => f.format(Number(v) || 0);
  }
  const f = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: compact ? "compact" : "standard" });
  return (v) => f.format(Number(v) || 0);
}
