import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./test-db.mjs";
import { verifyPassword } from "better-auth/crypto";
import { bootstrapTenant } from "./bootstrap-lib.mjs";

test("bootstrap creates a tenant, chart of accounts and a login that verifies", async () => {
  const pg = await freshDb();
  const q = (t, p) => pg.query(t, p);
  const r = await bootstrapTenant(q, { company: "Kimua", slug: "kimua", email: "Amina@Kimua.co.tz", name: "Amina", password: "a-long-password-1", platformAdmin: true });
  const acc = (await q("select password from account where \"userId\" = $1", [r.userId])).rows[0];
  assert.ok(await verifyPassword({ hash: acc.password, password: "a-long-password-1" }));
  assert.ok(!(await verifyPassword({ hash: acc.password, password: "wrong-password-xx" })));
  const p = (await q("select role, is_platform_admin, organization_id from profiles where user_id = $1", [r.userId])).rows[0];
  assert.equal(p.role, "Admin");
  assert.equal(p.is_platform_admin, true);
  assert.equal((await q("select count(*)::int c from chart_of_accounts where organization_id = $1", [r.organizationId])).rows[0].c, 19);
  await assert.rejects(bootstrapTenant(q, { company: "X", slug: "kimua", email: "b@x.com", name: "B", password: "a-long-password-1" }), /already used/);
  await assert.rejects(bootstrapTenant(q, { company: "X", slug: "other", email: "amina@kimua.co.tz", name: "B", password: "a-long-password-1" }), /already exists/);
  await assert.rejects(bootstrapTenant(q, { company: "X", slug: "other", email: "c@x.com", name: "C", password: "short" }), /at least 10/);
});
