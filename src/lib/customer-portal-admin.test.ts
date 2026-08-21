import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { homeForRoles } from "./roles";
import {
  assertBranchesBelongToClient,
  normalizeBranchIds,
  validatePortalAssignment,
} from "./customer-portal-admin";

test("customer onboarding requires one client and at least one branch", () => {
  assert.throws(
    () => validatePortalAssignment({ role: "customer", clientId: null, branchIds: [] }),
    /Select a customer/,
  );
  assert.throws(
    () => validatePortalAssignment({ role: "customer", clientId: "client-1", branchIds: [] }),
    /at least one allowed branch/,
  );
});

test("customer branch selections are normalized and internal roles remain unchanged", () => {
  assert.deepEqual(
    validatePortalAssignment({
      role: "customer",
      clientId: "client-1",
      branchIds: ["branch-1", "branch-1", "branch-2"],
    }),
    { clientId: "client-1", branchIds: ["branch-1", "branch-2"] },
  );
  assert.deepEqual(validatePortalAssignment({ role: "staff", clientId: null, branchIds: [] }), {
    clientId: null,
    branchIds: [],
  });
  assert.deepEqual(normalizeBranchIds([" branch-1 ", "branch-1", ""]), ["branch-1"]);
});

test("allowed branches must belong to the selected client", () => {
  const branches = [
    { id: "branch-1", client_id: "client-1" },
    { id: "branch-2", client_id: "client-2" },
  ];
  assert.equal(assertBranchesBelongToClient("client-1", ["branch-1"], branches), true);
  assert.throws(
    () => assertBranchesBelongToClient("client-1", ["branch-2"], branches),
    /must belong to the selected customer/,
  );
});

test("a customer-only login resolves to the portal", () => {
  assert.equal(homeForRoles(["customer"]), "/portal");
});

test("database contract keeps portal access Admin-only and disables without deleting identity", () => {
  const sql = readFileSync(
    new URL(
      "../../supabase/migrations/20260821170000_customer_portal_admin_onboarding.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /has_role\(auth\.uid\(\), 'admin'/);
  assert.match(sql, /Every allowed branch must belong to the selected customer/);
  assert.match(sql, /UPDATE SET is_active = EXCLUDED\.is_active/);
  assert.doesNotMatch(sql, /DELETE FROM public\.customer_portal_identities/);
});

test("Admin user creation and management UI wire the customer portal assignment", () => {
  const server = readFileSync(new URL("./user-admin.functions.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../components/users-management.tsx", import.meta.url), "utf8");

  assert.match(server, /set_customer_portal_access/);
  assert.match(server, /auth\.admin\.deleteUser\(userId\)/);
  assert.match(ui, /Customer \/ Client/);
  assert.match(ui, /Allowed Branches/);
  assert.match(ui, /Edit Portal Access/);
});
