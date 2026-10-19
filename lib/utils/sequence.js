// Atomic, gap-tolerant counters for human-readable identifiers.
// Uses INSERT … ON CONFLICT so concurrent requests never receive the same number.
export async function nextSequence(db, key) {
  const rows = await db.$queryRaw`
    INSERT INTO "Sequence" ("key", "value") VALUES (${key}, 1)
    ON CONFLICT ("key") DO UPDATE SET "value" = "Sequence"."value" + 1
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
