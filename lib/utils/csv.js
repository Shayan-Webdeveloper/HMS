// CSV generation with spreadsheet formula-injection protection (OWASP guidance):
// any cell starting with = + - @ TAB or CR is prefixed with a single quote.
const DANGEROUS = /^[=+\-@\t\r]/;

export function csvCell(value) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (DANGEROUS.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(columns, rows) {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => csvCell(typeof c.value === "function" ? c.value(r) : r[c.key])).join(","));
  return [header, ...body].join("\r\n") + "\r\n";
}

export const MAX_EXPORT_ROWS = 5000;
