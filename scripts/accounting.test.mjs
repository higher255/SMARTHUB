// Runs the real migrations on an in-memory Postgres (PGlite) and exercises the accounting engine.
import { test } from "node:test";
import assert from "node:assert/strict";

import { freshDb as baseDb, uid } from "./test-db.mjs";
const ORG = uid(1);
const ORG2 = uid(2);

async function freshDb() {
  const pg = await baseDb();
  await pg.query("insert into organizations (id, name, slug) values ($1,'Kimua','kimua'), ($2,'Other','other')", [ORG, ORG2]);
  await pg.query("insert into projects (user_id, name, budget, organization_id) values ('u1','Fibre Dar', 5000000, $1)", [ORG]);
  return pg;
}
const q = async (pg, text, params = []) => (await pg.query(text, params)).rows;
const post = (pg, lines, org = ORG, date = "2026-09-01") =>
  q(pg, "select acct_post($1,$2::date,'test','manual',null,'u1',$3::jsonb) as id", [org, date, JSON.stringify(lines)]);

test("migrations apply cleanly and twice", async () => {
  const pg = await freshDb();
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql") && f >= "0007").sort()) await pg.exec(fs.readFileSync(path.join(dir, f), "utf8"));
});

test("unbalanced and one-sided entries are rejected", async () => {
  const pg = await freshDb();
  await assert.rejects(post(pg, [{ account: "1000", debit: 100, credit: 0 }, { account: "4000", debit: 0, credit: 90 }]), /does not balance/);
  await assert.rejects(post(pg, [{ account: "1000", debit: 100, credit: 0 }]), /at least two/);
  await assert.rejects(post(pg, [{ account: "1000", debit: 100, credit: 0 }, { account: "9999", debit: 0, credit: 100 }]), /Unknown or inactive account/);
  const [{ n }] = await q(pg, "select count(*)::int n from journal_entries");
  assert.equal(n, 0, "failed postings must leave nothing behind");
});

test("the database itself refuses unbalanced lines written directly", async () => {
  const pg = await freshDb();
  await q(pg, "select acct_seed_chart($1)", [ORG]);
  const [{ id: entry }] = await q(pg, "insert into journal_entries (organization_id, entry_no, memo, created_by) values ($1,'X-1','x','u') returning id", [ORG]);
  const [{ id: acc }] = await q(pg, "select id from chart_of_accounts where organization_id=$1 and code='1000'", [ORG]);
  await assert.rejects(q(pg, "insert into journal_lines (entry_id, account_id, debit, credit) values ($1,$2,50,0)", [entry, acc]), /Unbalanced/);
});

test("invoice lifecycle: issue, part-pay, pay, void rules; trial balance stays balanced", async () => {
  const pg = await freshDb();
  const [{ id }] = await q(pg, `insert into finance_invoices (organization_id, invoice_number, customer_name, description, vat_rate, created_by)
     values ($1, acct_next_no($1,'INV','INV'), 'Vodacom', 'Fibre survey', 18, 'u1') returning id`, [ORG]);
  await q(pg, "insert into invoice_lines (invoice_id, description, quantity, unit_price) values ($1,'Survey',2,500000), ($1,'Report',1,250000)", [id]);
  await q(pg, "select fin_invoice_issue($1,$2,'u1')", [id, ORG]);
  let [inv] = await q(pg, "select * from finance_invoices where id=$1", [id]);
  assert.equal(inv.status, "Issued");
  assert.equal(Number(inv.subtotal), 1250000);
  assert.equal(Number(inv.vat_amount), 225000);
  assert.equal(Number(inv.total), 1475000);
  await assert.rejects(q(pg, "select fin_invoice_issue($1,$2,'u1')", [id, ORG]), /Only draft/);

  await q(pg, "select fin_invoice_receive($1,$2,'u1',500000,'2026-09-05'::date,'Bank','TX1')", [id, ORG]);
  [inv] = await q(pg, "select * from finance_invoices where id=$1", [id]);
  assert.equal(inv.status, "Partially Paid");
  await assert.rejects(q(pg, "select fin_invoice_receive($1,$2,'u1',99999999,null,'Cash',null)", [id, ORG]), /exceeds the outstanding/);
  await assert.rejects(q(pg, "select fin_invoice_void($1,$2,'u1','x')", [id, ORG]), /has payments/);
  await q(pg, "select fin_invoice_receive($1,$2,'u1',975000,'2026-09-06'::date,'Cash',null)", [id, ORG]);
  [inv] = await q(pg, "select * from finance_invoices where id=$1", [id]);
  assert.equal(inv.status, "Paid");

  const tb = await q(pg, "select * from acct_trial_balance($1,'2026-12-31')", [ORG]);
  const dr = tb.reduce((s, r) => s + Number(r.balance_dr), 0);
  const cr = tb.reduce((s, r) => s + Number(r.balance_cr), 0);
  assert.equal(dr, cr, "trial balance must balance");
  assert.ok(dr > 0);
  const ar = tb.find((r) => r.code === "1100");
  assert.equal(Number(ar?.balance_dr ?? 0) - Number(ar?.balance_cr ?? 0), 0, "receivable cleared after full payment");
  const vat = tb.find((r) => r.code === "2100");
  assert.equal(Number(vat.balance_cr), 225000);
});

test("void reverses the ledger and cannot be repeated", async () => {
  const pg = await freshDb();
  const [{ id }] = await q(pg, `insert into finance_invoices (organization_id, invoice_number, customer_name, description, vat_rate, created_by)
     values ($1,'INV-1','Airtel','x',18,'u1') returning id`, [ORG]);
  await q(pg, "insert into invoice_lines (invoice_id, description, quantity, unit_price) values ($1,'Job',1,100)", [id]);
  await q(pg, "select fin_invoice_issue($1,$2,'u1')", [id, ORG]);
  await q(pg, "select fin_invoice_void($1,$2,'u1','wrong customer')", [id, ORG]);
  const tb = await q(pg, "select * from acct_trial_balance($1,'2099-01-01')", [ORG]);
  assert.equal(tb.reduce((s, r) => s + Number(r.balance_dr) - Number(r.balance_cr), 0), 0);
  assert.equal(tb.filter((r) => Number(r.balance_dr) !== 0 || Number(r.balance_cr) !== 0).length, 0, "everything nets to zero after void");
  await assert.rejects(q(pg, "select fin_invoice_void($1,$2,'u1','again')", [id, ORG]), /already void/);
});

test("paying a finance request posts expense vs cash once, only from Approved", async () => {
  const pg = await freshDb();
  const [{ id }] = await q(pg, `insert into finance_requests (project_id, user_id, organization_id, request_number, title, category, amount, status, requested_by)
     values (1,'u2',$1,'FR-1','Cable drums','Material',750000,'Submitted','Asha') returning id`, [ORG]);
  await assert.rejects(q(pg, "select fin_request_pay($1,$2,'u9','Fin','R1','Cash',null)", [id, ORG]), /Only approved/);
  await q(pg, "update finance_requests set status='Approved' where id=$1", [id]);
  await q(pg, "select fin_request_pay($1,$2,'u9','Fin','R1','M-Pesa',null)", [id, ORG]);
  const [r] = await q(pg, "select status, journal_entry_id from finance_requests where id=$1", [id]);
  assert.equal(r.status, "Paid");
  assert.ok(r.journal_entry_id);
  await assert.rejects(q(pg, "select fin_request_pay($1,$2,'u9','Fin','R1','Cash',null)", [id, ORG]), /Only approved/);
  const tb = await q(pg, "select * from acct_trial_balance($1,'2099-01-01')", [ORG]);
  assert.equal(Number(tb.find((x) => x.code === "5000").balance_dr), 750000);
  assert.equal(Number(tb.find((x) => x.code === "1010").balance_cr), 750000, "non-cash method credits Bank");
  // another organisation can never pay it
  await assert.rejects(q(pg, "select fin_request_pay($1,$2,'u9','Fin','R1','Cash',null)", [id, ORG2]), /not found/);
});

test("tenants are isolated: same account codes, separate books and numbering", async () => {
  const pg = await freshDb();
  await post(pg, [{ account: "1000", debit: 100, credit: 0 }, { account: "3000", debit: 0, credit: 100 }], ORG);
  await post(pg, [{ account: "1000", debit: 999, credit: 0 }, { account: "3000", debit: 0, credit: 999 }], ORG2);
  const a = await q(pg, "select * from acct_trial_balance($1,'2099-01-01')", [ORG]);
  assert.equal(Number(a.find((r) => r.code === "1000").balance_dr), 100);
  const nos = await q(pg, "select organization_id, entry_no from journal_entries order by id");
  assert.equal(nos[0].entry_no, nos[1].entry_no, "each tenant numbers from 0001");
});

test("locked books refuse postings; reports compute income statement and balance sheet", async () => {
  const pg = await freshDb();
  await post(pg, [{ account: "1010", debit: 1000, credit: 0 }, { account: "3000", debit: 0, credit: 1000 }], ORG, "2026-01-05");
  await post(pg, [{ account: "1000", debit: 300, credit: 0 }, { account: "4000", debit: 0, credit: 300 }], ORG, "2026-02-01");
  await post(pg, [{ account: "5900", debit: 80, credit: 0 }, { account: "1000", debit: 0, credit: 80 }], ORG, "2026-02-02");
  const is = await q(pg, "select * from acct_income_statement($1,'2026-01-01','2026-12-31')", [ORG]);
  assert.equal(Number(is.find((r) => r.code === "4000").amount), 300);
  assert.equal(Number(is.find((r) => r.code === "5900").amount), 80);
  const bs = await q(pg, "select * from acct_balance_sheet($1,'2026-12-31')", [ORG]);
  const sum = (s) => bs.filter((r) => r.section === s).reduce((t, r) => t + Number(r.amount), 0);
  assert.equal(sum("Assets"), sum("Liabilities") + sum("Equity"), "A = L + E");
  await q(pg, "update organizations set books_locked_until='2026-01-31' where id=$1", [ORG]);
  await assert.rejects(post(pg, [{ account: "1000", debit: 1, credit: 0 }, { account: "4000", debit: 0, credit: 1 }], ORG, "2026-01-10"), /locked/);
  const gl = await q(pg, "select * from acct_general_ledger($1,'1000','2026-01-01','2026-12-31')", [ORG]);
  assert.equal(Number(gl[gl.length - 1].running), 220);
});

test("invoice numbers never collide under repeated allocation", async () => {
  const pg = await freshDb();
  const nos = new Set();
  for (let i = 0; i < 25; i++) nos.add((await q(pg, "select acct_next_no($1,'INV','INV') n", [ORG]))[0].n);
  assert.equal(nos.size, 25);
});
