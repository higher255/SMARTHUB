#!/usr/bin/env node
/**
 * Create a company and its administrator on a live database.
 *
 *   DATABASE_URL=... node scripts/bootstrap.mjs \
 *     --company "Kimua" --slug kimua --name "Amina Juma" --email amina@kimua.co.tz \
 *     --password 'a-long-temporary-password' [--platform-admin] [--currency TZS]
 *
 * --platform-admin marks the account as the Smart Hub owner (may create and suspend companies at /platform).
 */
import "dotenv/config";
import pg from "pg";
import { bootstrapTenant } from "./bootstrap-lib.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false } });
await client.connect();
try {
  const r = await bootstrapTenant((t, p) => client.query(t, p), {
    company: args.company, slug: args.slug, email: args.email, name: args.name, password: args.password,
    platformAdmin: Boolean(args["platform-admin"]), currency: args.currency || "TZS",
  });
  console.log("Created company", r.organizationId, "and administrator", r.userId);
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
