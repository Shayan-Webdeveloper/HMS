// Atomic, gap-tolerant counters for human-readable identifiers, PER HOSPITAL.
// Uses INSERT … ON CONFLICT so concurrent requests never receive the same number. "hospitalId" is
// filled by its column default from the transaction's hospital context (db must be the hospital-scoped
// client or a transaction of it), so two hospitals each get their own MRN-000001, INV-2026-000001, ….
export async function nextSequence(db, key) {
  const rows = await db.$queryRaw`
    INSERT INTO "Sequence" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("hospitalId", "key") DO UPDATE SET "value" = "Sequence"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}

export async function nextIdentifier(db, key, prefix, width = 6, { yearly = false } = {}) {
  const year = new Date().getUTCFullYear();
  const seqKey = yearly ? `${key}:${year}` : key;
  const n = await nextSequence(db, seqKey);
  const num = String(n).padStart(width, "0");
  return yearly ? `${prefix}-${year}-${num}` : `${prefix}-${num}`;
}
