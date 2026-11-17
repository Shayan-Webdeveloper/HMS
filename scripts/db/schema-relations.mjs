// Reads single-column relations straight from prisma/schema.prisma (Prisma 7's runtime DMMF no longer
// exposes foreign-key columns). Used by the tenant-security SQL generator and its consistency test.
import fs from "node:fs";
import path from "node:path";

export function parseRelations(schemaText) {
  const out = [];
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = modelRe.exec(schemaText))) {
    const [, model, body] = m;
    for (const line of body.split("\n")) {
      const rel = line.match(/^\s*(\w+)\s+(\w+)(\?|\[\])?\s+@relation\(([^)]*)\)/);
      if (!rel) continue;
      const fields = rel[4].match(/fields:\s*\[([^\]]*)\]/);
      if (!fields) continue;
      const cols = fields[1].split(",").map((s) => s.trim()).filter(Boolean);
      if (cols.length !== 1) continue;
      out.push({ model, field: rel[1], target: rel[2], column: cols[0] });
    }
  }
  return out;
}

export function readSchemaRelations(schemaPath = path.resolve("prisma/schema.prisma")) {
  return parseRelations(fs.readFileSync(schemaPath, "utf8"));
}
