// Shared test database. PROD_SHAPE=1 reproduces the mixed uuid/text column types of the live Supabase database
// (organizations.id and organization_id on profiles/projects/incidents/finance_requests are uuid there).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
export const prodShape = process.env.PROD_SHAPE === "1";
export const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function freshDb() {
  const pg = new PGlite();
  await pg.waitReady;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (prodShape && f.startsWith("0007")) await toProdShape(pg);
    await pg.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  }
  return pg;
}

async function toProdShape(pg) {
  await pg.exec(`
    alter table organizations alter column id drop default;
    alter table organizations alter column id type uuid using id::uuid;
    alter table organizations alter column id set default gen_random_uuid();
    alter table profiles alter column organization_id type uuid using organization_id::uuid;
    alter table projects alter column organization_id type uuid using organization_id::uuid;
    alter table incidents alter column organization_id type uuid using organization_id::uuid;
    alter table finance_requests alter column organization_id type uuid using organization_id::uuid;
  `);
}
