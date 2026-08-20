import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateFinishedStock,
  allocationCreatesFinancialMovement,
  buildDeliveryPlan,
  isAllocationApprovalIdempotent,
  canRoleManageAllocation,
} from "./allocation-delivery.ts";

const base = (id: string, quantity: number, priority: "normal" | "high" | "urgent" = "normal") => ({
  sales_order_item_id: id,
  sales_order_id: `o-${id}`,
  order_number: `ORD-${id}`,
  product_id: "p",
  product_name: "Fries",
  unit: "packs",
  client_name: id,
  branch_name: "Main",
  priority,
  ordered_at: "2026-08-01",
  requested_delivery_date: "2026-08-20",
  remaining_quantity: quantity,
});

test("allocation never exceeds stock or remaining order quantity", () => {
  const r = allocateFinishedStock({
    available_quantity: 20,
    demands: [base("a", 30), base("b", 25)],
    today: "2026-08-20",
  });
  assert.ok(r.allocated_quantity <= 20);
  assert.ok(r.suggestions.every((x) => x.suggested_quantity <= x.remaining_quantity));
});
test("full stock fulfills all demand", () => {
  const r = allocateFinishedStock({
    available_quantity: 100,
    demands: [base("a", 30), base("b", 25)],
    today: "2026-08-20",
  });
  assert.equal(r.remaining_shortage, 0);
  assert.equal(r.customers_receiving_full, 2);
});
test("fair share distributes shortage across customers", () => {
  const r = allocateFinishedStock({
    available_quantity: 60,
    demands: [base("a", 30), base("b", 25), base("c", 40), base("d", 20)],
    today: "2026-08-20",
  });
  assert.equal(r.customers_receiving_something, 4);
  assert.equal(r.allocated_quantity, 60);
});
test("urgent late order receives greater weighting", () => {
  const urgent = { ...base("u", 30, "urgent"), requested_delivery_date: "2026-08-15" };
  const r = allocateFinishedStock({
    available_quantity: 20,
    demands: [urgent, base("n", 30)],
    today: "2026-08-20",
  });
  assert.ok(
    r.suggestions.find((x) => x.sales_order_item_id === "u")!.suggested_quantity >
      r.suggestions.find((x) => x.sales_order_item_id === "n")!.suggested_quantity,
  );
});
test("minimum viable quantities are not hidden", () => {
  const r = allocateFinishedStock({
    available_quantity: 5,
    demands: [
      { ...base("a", 10), minimum_viable_quantity: 4 },
      { ...base("b", 10), minimum_viable_quantity: 4 },
    ],
    today: "2026-08-20",
  });
  assert.equal(r.minimum_viable_warning, true);
});
test("partial prior fulfillment is considered and cancelled/completed orders are excluded", () => {
  const r = allocateFinishedStock({
    available_quantity: 10,
    demands: [
      { ...base("partial", 10), delivered_quantity: 2 },
      base("new", 10),
      { ...base("cancelled", 10), status: "cancelled" },
      { ...base("completed", 10), status: "completed" },
    ],
    today: "2026-08-20",
  });
  assert.equal(r.suggestions.length, 2);
  assert.ok(
    r.suggestions.find((row) => row.sales_order_item_id === "partial")!.suggested_quantity >
      r.suggestions.find((row) => row.sales_order_item_id === "new")!.suggested_quantity,
  );
});
test("approval is idempotent, allocation never creates financial movement, and roles stay protected", () => {
  assert.equal(isAllocationApprovalIdempotent("approved"), true);
  assert.equal(isAllocationApprovalIdempotent("draft"), false);
  assert.equal(allocationCreatesFinancialMovement(), false);
  assert.equal(canRoleManageAllocation("admin"), true);
  assert.equal(canRoleManageAllocation("investor"), false);
});
test("delivery plan respects allocated deadlines and groups compatible dates", () => {
  const r = allocateFinishedStock({
    available_quantity: 20,
    demands: [base("a", 10), base("b", 10)],
    today: "2026-08-20",
  });
  const p = buildDeliveryPlan(r.suggestions, "2026-08-20");
  assert.equal(p.today.length, 2);
  assert.equal(p.consolidation[0].deliveries, 2);
});
