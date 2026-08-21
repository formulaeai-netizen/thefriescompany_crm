import assert from "node:assert/strict";
import test from "node:test";
import { validateCustomerPortalOrderDraft } from "./customer-portal.functions";

test("portal order validation requires a mapped branch, future date, and positive quantity", () => {
  const errors = validateCustomerPortalOrderDraft({
    branch_id: "",
    requested_delivery_date: "",
    items: [],
  });

  assert.equal(errors.branch_id, "Choose a branch.");
  assert.equal(errors.requested_delivery_date, "Choose a requested delivery date.");
  assert.equal(errors.items, "Enter a quantity greater than zero for at least one product.");
});

test("valid portal order draft passes client-side validation", () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  assert.deepEqual(
    validateCustomerPortalOrderDraft({
      branch_id: "00000000-0000-4000-8000-000000000001",
      requested_delivery_date: tomorrow,
      items: [
        {
          product_id: "00000000-0000-4000-8000-000000000002",
          quantity: 2,
          unit: "packs",
        },
      ],
    }),
    {},
  );
});
