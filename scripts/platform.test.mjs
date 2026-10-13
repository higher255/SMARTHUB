import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb, uid } from "./test-db.mjs";

const A = uid(11), B = uid(12);
async function db() {
  const pg = await freshDb();
  await pg.query("insert into organizations (id, name, slug, monthly_fee) values ($1,'Kimua','kimua',500000), ($2,'Other','other',300000)", [A, B]);
  return pg;
}
const q = async (pg, t, p = []) => (await pg.query(t, p)).rows;

test("rent payments extend paid_until; a lapsed tenant is counted from the payment date", async () => {
  const pg = await db();
  const [{ d }] = await q(pg, "select platform_record_payment($1, 500000, 'TZS', '2026-09-01'::date, 1, 'Bank', 'R1', 'owner')::text as d", [A]);
  assert.equal(d, "2026-10-01");
  const [{ d: d2 }] = await q(pg, "select platform_record_payment($1, 1500000, 'TZS', '2026-09-20'::date, 3, 'Bank', 'R2', 'owner')::text as d", [A]);
  assert.equal(d2, "2027-01-01", "paying early stacks onto the existing paid-until date");
  await q(pg, "update organizations set paid_until = '2026-01-15' where id = $1", [B]);
  const [{ d: d3 }] = await q(pg, "select platform_record_payment($1, 300000, 'TZS', '2026-09-20'::date, 1, 'M-Pesa', null, 'owner')::text as d", [B]);
  assert.equal(d3, "2026-10-20", "a lapsed tenant starts again from the payment date");
  await assert.rejects(q(pg, "select platform_record_payment($1, 1, 'TZS', current_date, 1, null, null, 'o')", [uid(99)]), /Company not found/);
  const rows = await q(pg, "select count(*)::int c from platform_payments where organization_id = $1", [A]);
  assert.equal(rows[0].c, 2);
});

test("category budgets, attendance, leave and site reports enforce their rules", async () => {
  const pg = await db();
  await q(pg, "insert into projects (user_id, name, budget, organization_id) values ('u1','Tower',1000000,$1)", [A]);
  await q(pg, "insert into project_budgets (project_id, organization_id, category, amount) values (1,$1,'Material',400000)", [A]);
  await assert.rejects(q(pg, "insert into project_budgets (project_id, organization_id, category, amount) values (1,$1,'Snacks',1)", [A]), /check/);
  await q(pg, "insert into attendance (organization_id, user_id) values ($1,'u1')", [A]);
  await assert.rejects(q(pg, "insert into attendance (organization_id, user_id) values ($1,'u1')", [A]), /unique|duplicate/);
  await q(pg, "insert into leave_requests (organization_id, user_id, leave_type, start_date, end_date) values ($1,'u1','Annual','2026-10-01','2026-10-05')", [A]);
  const [l] = await q(pg, "select days from leave_requests");
  assert.equal(l.days, 5);
  await assert.rejects(q(pg, "insert into leave_requests (organization_id, user_id, leave_type, start_date, end_date) values ($1,'u1','Annual','2026-10-05','2026-10-01')", [A]), /check/);
  await q(pg, "insert into site_reports (organization_id, project_id, summary, workers, hours_per_worker, created_by) values ($1,1,'Trenching done',8,9,'u1')", [A]);
});
