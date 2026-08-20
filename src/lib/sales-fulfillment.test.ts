import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCanPlanQuantity,
  canRoleManageFulfillment,
  canRoleViewFulfillment,
  canTransitionFulfillment,
  commercialRemainingToReceive,
  customerOutstandingAfterReceiving,
  customerOutstandingBeforeReceiving,
  deliveryReceivingCreatesCashMovement,
  demandAfterFulfillment,
  deriveOrderStatusFromFulfillment,
  isAwaitingReceivingReminderEligible,
  isMissingReceiving3Days,
  missingReceivingDedupeKey,
  payableAmountFromReceiving,
  recipientsForMissingReceiving,
  remainingToDeliver,
  remainingToPlan,
  selectMissingReceivingIncidents,
  validateReceivingLine,
} from "./sales-fulfillment.ts";

test("partial fulfillment cannot exceed ordered quantity", () => {
  assert.doesNotThrow(() => assertCanPlanQuantity(100, 40, 30));
  assert.throws(() => assertCanPlanQuantity(100, 90, 20), /exceeds remaining/);
  assert.equal(remainingToPlan({ orderedQuantity: 100, plannedQuantity: 40 }), 60);
});

test("dispatch/delivery lifecycle allows only valid transitions", () => {
  assert.equal(canTransitionFulfillment("planned", "dispatched"), true);
  assert.equal(canTransitionFulfillment("dispatched", "receiving_pending"), true);
  assert.equal(canTransitionFulfillment("planned", "receiving_confirmed"), false);
  assert.equal(canTransitionFulfillment("receiving_confirmed", "dispatched"), false);
});

test("delivered fulfillment becomes receiving pending", () => {
  assert.equal(
    deriveOrderStatusFromFulfillment({
      currentStatus: "planning",
      orderedQuantity: 50,
      plannedQuantity: 50,
      dispatchedQuantity: 50,
      deliveredQuantity: 50,
      acceptedQuantity: 0,
    }),
    "receiving_pending",
  );
});

test("receiving confirmation records accepted value only", () => {
  const payable = payableAmountFromReceiving([
    {
      fulfillment_item_id: "line-1",
      delivered_quantity: 50,
      accepted_quantity: 45,
      rejected_quantity: 5,
      unit_price_snapshot: 100,
    },
  ]);
  assert.equal(payable, 4500);
});

test("before receiving there is no AR/customer outstanding", () => {
  assert.equal(customerOutstandingBeforeReceiving(), 0);
});

test("after receiving payable accepted amount appears", () => {
  assert.equal(
    customerOutstandingAfterReceiving([
      {
        fulfillment_item_id: "line-1",
        delivered_quantity: 10,
        accepted_quantity: 8,
        rejected_quantity: 2,
        unit_price_snapshot: 250,
      },
    ]),
    2000,
  );
});

test("partial receiving invoices only accepted quantity", () => {
  assert.equal(
    payableAmountFromReceiving([
      {
        fulfillment_item_id: "line-1",
        delivered_quantity: 50,
        accepted_quantity: 45,
        rejected_quantity: 5,
        unit_price_snapshot: 120,
      },
    ]),
    5400,
  );
  assert.throws(
    () =>
      validateReceivingLine({
        fulfillment_item_id: "line-1",
        delivered_quantity: 50,
        accepted_quantity: 51,
        rejected_quantity: 0,
        unit_price_snapshot: 120,
      }),
    /cannot exceed delivered/,
  );
});

test("cash/bank remain unchanged by delivery and receiving", () => {
  assert.equal(deliveryReceivingCreatesCashMovement(), false);
});

test("three day missing receiving creates one incident candidate", () => {
  const candidates = selectMissingReceivingIncidents(
    [
      {
        fulfillmentId: "ful-1",
        responsibleUser: "mod-1",
        deliveredAt: "2026-08-10",
        status: "receiving_pending",
      },
    ],
    new Set(),
    "2026-08-13",
  );
  assert.equal(candidates.length, 1);
});

test("repeated scan does not duplicate incident or notification", () => {
  const key = missingReceivingDedupeKey("ful-1");
  const candidates = selectMissingReceivingIncidents(
    [
      {
        fulfillmentId: "ful-1",
        responsibleUser: "mod-1",
        deliveredAt: "2026-08-10",
        status: "receiving_pending",
      },
    ],
    new Set([key]),
    "2026-08-14",
  );
  assert.equal(candidates.length, 0);
});

test("responsible moderator plus admin are targeted", () => {
  assert.deepEqual(
    recipientsForMissingReceiving({ responsibleUser: "mod-1", adminUserIds: ["admin-1"] }),
    ["admin-1", "mod-1"],
  );
  assert.deepEqual(
    recipientsForMissingReceiving({ responsibleUser: "admin-1", adminUserIds: ["admin-1"] }),
    ["admin-1"],
  );
});

test("awaiting receiving invoices are excluded from payment reminders", () => {
  assert.equal(
    isAwaitingReceivingReminderEligible({ receiving_status: "awaiting_receiving" }),
    false,
  );
  assert.equal(isAwaitingReceivingReminderEligible({ receiving_status: "payable" }), true);
  assert.equal(isAwaitingReceivingReminderEligible({ receiving_status: null }), true);
});

test("partial fulfillment does not complete the whole order", () => {
  assert.equal(
    deriveOrderStatusFromFulfillment({
      currentStatus: "planning",
      orderedQuantity: 100,
      plannedQuantity: 40,
      dispatchedQuantity: 40,
      deliveredQuantity: 40,
      acceptedQuantity: 40,
    }),
    "dispatched",
  );
});

test("demand subtracts fulfillment with explicit operational/commercial policies", () => {
  assert.deepEqual(
    demandAfterFulfillment({ orderedQuantity: 100, deliveredQuantity: 40, acceptedQuantity: 35 }),
    {
      operationalProductionDemand: 60,
      commercialOutstandingFulfillment: 65,
    },
  );
  assert.equal(remainingToDeliver({ orderedQuantity: 100, deliveredQuantity: 40 }), 60);
  assert.equal(commercialRemainingToReceive({ orderedQuantity: 100, acceptedQuantity: 35 }), 65);
});

test("role protections allow ops users to view but not investor access", () => {
  assert.equal(canRoleManageFulfillment("admin"), true);
  assert.equal(canRoleManageFulfillment("moderator"), true);
  assert.equal(canRoleManageFulfillment("staff"), false);
  assert.equal(canRoleViewFulfillment("staff"), true);
  assert.equal(canRoleViewFulfillment("investor"), false);
});

test("missing receiving waits for three calendar days", () => {
  assert.equal(
    isMissingReceiving3Days(
      { deliveredAt: "2026-08-10", status: "receiving_pending" },
      "2026-08-12",
    ),
    false,
  );
  assert.equal(
    isMissingReceiving3Days(
      { deliveredAt: "2026-08-10", status: "receiving_pending" },
      "2026-08-13",
    ),
    true,
  );
});
