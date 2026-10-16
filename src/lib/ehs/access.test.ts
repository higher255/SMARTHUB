import { test } from "node:test";
import assert from "node:assert/strict";
import { can, canAccessPath, workspacesFor, permissionsOf, homePath, canUseOwnerGoogleAuth } from "./access.ts";

test("Google auth is reserved for the platform owner and first installation account", () => {
  assert.ok(canUseOwnerGoogleAuth(true, false));
  assert.ok(canUseOwnerGoogleAuth(false, true));
  assert.ok(!canUseOwnerGoogleAuth(false, false), "company Admin is not the platform owner");
});

test("site staff can request money but cannot approve or see the books", () => {
  for (const role of ["Team_Member", "Team_Leader", "Employee", "Driver"]) {
    assert.ok(can({ role }, "finance.request"), role);
    assert.ok(!can({ role }, "finance.approve"), role);
    assert.ok(!can({ role }, "accounts.view"), role);
    assert.ok(!canAccessPath({ role }, "/finance"), role);
  }
});

test("team leaders land in their site workspace and only receive team operations permissions", () => {
  const leader = { role: "Team_Leader" };
  assert.equal(homePath(leader), "/teamleader");
  assert.ok(canAccessPath(leader, "/teamleader"));
  assert.ok(can(leader, "attendance.view"));
  assert.ok(can(leader, "teamleader.dashboard"));
  assert.ok(can(leader, "hours.record"));
  assert.ok(can(leader, "ehs.report"));
  assert.ok(!can(leader, "ehs.manage"));
  assert.ok(!can(leader, "wellbeing.manage"));
  const dualRoleDriver = { role: "Driver", permissions: ["teamleader.dashboard", "attendance.view"] };
  assert.ok(canAccessPath(dualRoleDriver, "/teamleader"));
  assert.ok(canAccessPath(dualRoleDriver, "/driver"));
});

test("a Project Manager granted finance.approve gets the Finance workspace without a second role", () => {
  const pm = { role: "Project_Manager" };
  assert.ok(!canAccessPath(pm, "/finance"));
  const granted = { role: "Project_Manager", permissions: ["finance.view", "finance.approve"] };
  assert.ok(canAccessPath(granted, "/finance"));
  assert.ok(can(granted, "finance.approve"));
  assert.ok(canAccessPath(granted, "/projectmanager"), "keeps original workspace");
});

test("finance officer cannot endorse (manager-only step) unless granted", () => {
  assert.ok(!can({ role: "Finance" }, "finance.endorse"));
  assert.ok(can({ role: "Manager" }, "finance.endorse"));
  assert.ok(!can({ role: "Manager" }, "finance.approve"));
});

test("suspended users have no permissions and no workspaces", () => {
  const s = { role: "Admin", status: "suspended" };
  assert.equal(permissionsOf(s).size, 0);
  assert.deepEqual(workspacesFor(s), []);
});

test("the landlord sees only the platform console and none of a tenant's data", () => {
  assert.ok(!canAccessPath({ role: "Admin" }, "/platform"));
  const owner = { role: "Admin", isPlatformAdmin: true };
  assert.ok(canAccessPath(owner, "/platform"));
  assert.ok(!canAccessPath(owner, "/finance"));
  assert.ok(!can(owner, "finance.view"));
  assert.equal(homePath(owner), "/platform");
  assert.equal(homePath({ role: "Manager" }), "/management");
});

test("clients are confined to the client view", () => {
  const c = { role: "Client" };
  assert.deepEqual(workspacesFor(c).map((w) => w.path), ["/client"]);
});

test("unknown roles get nothing", () => {
  assert.equal(permissionsOf({ role: "Hacker" }).size, 0);
});
