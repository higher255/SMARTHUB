// Extracts every sql`...` template from the server modules and asks Postgres (PGlite) to PREPARE it against the
// real migrated schema. Catches wrong table/column names and untyped-parameter errors before they hit production.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { freshDb } from "./test-db.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pg = await freshDb();
const files = ["server.ts", "finance.ts", "hse.ts", "management.ts", "core.ts", "platform.ts", "daily.ts"].map((f) => path.join(root, "src/lib/ehs", f));
let total = 0, failed = 0, n = 0;
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const re = /\bsql(?:<[^`]*?>)?`/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex, text = "", params = 0;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "$" && src[i + 1] === "{") {
        let depth = 1, j = i + 2;
        while (j < src.length && depth) { if (src[j] === "{") depth++; else if (src[j] === "}") depth--; j++; }
        const expr = src.slice(i + 2, j - 1).trim();
        text += ["dateFilter","projectFilter"].includes(expr) ? "" : ["clause","projectClause"].includes(expr) ? "true" : `$${++params}`;
        i = j;
      } else text += src[i++];
    }
    total++;
    try {
      await pg.exec("deallocate all").catch(() => {});
      await pg.query(`prepare s${++n} as ${text}`);
    } catch (e) {
      failed++;
      const line = src.slice(0, m.index).split("\n").length;
      console.log(`FAIL ${path.basename(file)}:${line}  ${e.message}\n     ${text.replace(/\s+/g, " ").slice(0, 150)}`);
    }
  }
}
console.log(`${total - failed}/${total} statements valid`);
process.exit(failed ? 1 : 0);
