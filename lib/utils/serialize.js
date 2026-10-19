// Convert Prisma results (Decimal, Date, BigInt) to plain JSON-safe values for
// Response.json and for passing props to client components.
export function serialize(value) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(serialize);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object") {
    if (typeof value.toFixed === "function" && typeof value.isNegative === "function") return value.toString();
    if (value.constructor && value.constructor.name === "Decimal") return value.toString();
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
    return out;
  }
  return value;
}
