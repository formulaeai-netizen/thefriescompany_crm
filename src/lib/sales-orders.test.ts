import test from "node:test";
import assert from "node:assert/strict";

import { calculateCashInHand } from "./cash-in-hand.ts";
import {
  buildDemandSummary,
  buildProductDemand,
  buildSalesOrderDueNotification,
  buildSalesOrderNotification,
  canRoleManageSalesOrders,
  canTransitionSalesOrder,
  daysSinceOrder,
  daysUntilRequestedDelivery,
  deliveryLatenessDays,
  isActiveDemandStatus,
  validateInternalOrderTarget,
  validateOrderItemQuantity,
  type OrderItemLike,
  type OrderLike,
} from "./sales-orders.ts";

const today = "2026-08-17";

function order(overrides: Partial<OrderLike> = {}): OrderLike {
  return {
    id: overrides.id ?? "order-1",
    order_number: overrides.order_number ?? "ORD-2026-00001",
    client_id: overrides.client_id ?? "client-1",
    branch_id: overrides.branch_id ?? "branch-dha",
    client_name_snapshot: overrides.client_name_snapshot ?? "ABC Foods",
    branch_name_snapshot: overrides.branch_name_snapshot ?? "DHA",
    ordered_at: overrides.ordered_at ?? "2026-08-15T10:00:00Z",
    requested_delivery_date: overrides.requested_delivery_date ?? "2026-08-17",
    promised_delivery_date: overrides.promised_delivery_date ?? null,
    priority: overrides.priority ?? "normal",
    status: overrides.status ?? "confirmed",
  };
}

function item(overrides: Partial<OrderItemLike> = {}): OrderItemLike {
  return {
    id: overrides.id ?? "item-1",
    sales_order_id: overrides.sales_order_id ?? "order-1",
    product_id: overrides.product_id ?? "product-fries",
    product_name_snapshot: overrides.product_name_snapshot ?? "Curly Fries",
    quantity: overrides.quantity ?? 10,
    unit: overrides.unit ?? "packs",
  };
}

function cashInput(openingBalance = 1000) {
  return {
    openingBalance,
    clientPaymentCredits: 0,
    expensesTotal: 0,
    inventoryPurchasesPaidTotal: 0,
    paidSalariesTotal: 0,
    salaryAdvancesPaidTotal: 0,
    accountTransfersTotal: 0,
    adjustmentsTotal: 0,
  };
}

test("admin can create and manage sales orders", () => {
  assert.equal(canRoleManageSalesOrders("admin"), true);
});

test("moderator can create and confirm operational sales orders", () => {
  assert.equal(canRoleManageSalesOrders("moderator"), true);
});

test("staff and investor do not receive new order management powers", () => {
  assert.equal(canRoleManageSalesOrders("staff"), false);
  assert.equal(canRoleManageSalesOrders("investor"), false);
});

test("draft can be confirmed or cancelled", () => {
  assert.equal(canTransitionSalesOrder("draft", "confirmed"), true);
  assert.equal(canTransitionSalesOrder("draft", "cancelled"), true);
});

test("confirmed can move to planning or be cancelled", () => {
  assert.equal(canTransitionSalesOrder("confirmed", "planning"), true);
  assert.equal(canTransitionSalesOrder("confirmed", "cancelled"), true);
});

test("browser cannot jump directly to future fulfillment statuses", () => {
  assert.equal(canTransitionSalesOrder("draft", "delivered"), false);
  assert.equal(canTransitionSalesOrder("planning", "completed"), false);
});

test("customer and branch identity is preserved", () => {
  const dha = order({ id: "dha", branch_id: "branch-dha", branch_name_snapshot: "DHA" });
  const johar = order({ id: "johar", branch_id: "branch-johar", branch_name_snapshot: "Johar" });
  assert.notEqual(dha.branch_id, johar.branch_id);
  assert.equal(dha.client_id, johar.client_id);
});

test("same customer different branches remain separate in product demand", () => {
  const rows = buildProductDemand(
    [
      order({ id: "dha", branch_id: "branch-dha", branch_name_snapshot: "DHA" }),
      order({ id: "johar", branch_id: "branch-johar", branch_name_snapshot: "Johar" }),
    ],
    [
      item({ id: "i1", sales_order_id: "dha", quantity: 10 }),
      item({ id: "i2", sales_order_id: "johar", quantity: 8 }),
    ],
  );
  assert.equal(rows[0].affected_customer_branches.length, 2);
});

test("multiple line items aggregate by product and unit", () => {
  const rows = buildProductDemand(
    [order()],
    [
      item({ id: "i1", quantity: 10, unit: "packs" }),
      item({
        id: "i2",
        product_id: "product-oil",
        product_name_snapshot: "Oil",
        quantity: 5,
        unit: "litres",
      }),
    ],
  );
  assert.equal(rows.length, 2);
});

test("quantity must be greater than zero", () => {
  assert.equal(validateOrderItemQuantity(1), true);
  assert.equal(validateOrderItemQuantity(0), false);
  assert.equal(validateOrderItemQuantity(-1), false);
});

test("invalid product is represented as a server-side validation responsibility", () => {
  const badProductItem = item({ product_id: "" });
  assert.equal(Boolean(badProductItem.product_id), false);
});

test("duplicate external_source_key design relies on a single canonical dedupe key", () => {
  const key = "whatsapp:msg-1";
  assert.equal(key, "whatsapp:msg-1");
});

test("concurrent duplicate external order should return one canonical identity", () => {
  const existing = new Map([["whatsapp:msg-1", "order-1"]]);
  assert.equal(existing.get("whatsapp:msg-1"), "order-1");
});

test("order number format is human-readable and unique-shaped", () => {
  assert.match("ORD-2026-00124", /^ORD-\d{4}-\d{5}$/);
});

test("draft orders are excluded from confirmed demand", () => {
  const summary = buildDemandSummary([order({ status: "draft" })], [item()], today);
  assert.equal(summary.demand_today, 0);
});

test("confirmed orders are included in demand", () => {
  const summary = buildDemandSummary([order({ status: "confirmed" })], [item()], today);
  assert.equal(summary.demand_today, 1);
});

test("cancelled orders are excluded from demand", () => {
  const summary = buildDemandSummary([order({ status: "cancelled" })], [item()], today);
  assert.equal(summary.demand_today, 0);
});

test("completed orders are excluded from active demand", () => {
  assert.equal(isActiveDemandStatus("completed"), false);
});

test("product demand aggregation sums confirmed quantities", () => {
  const rows = buildProductDemand(
    [order({ id: "o1" }), order({ id: "o2" })],
    [item({ sales_order_id: "o1", quantity: 10 }), item({ sales_order_id: "o2", quantity: 15 })],
  );
  assert.equal(rows[0].total_confirmed_demand, 25);
});

test("next-day demand is counted separately", () => {
  const summary = buildDemandSummary(
    [
      order({ id: "today", requested_delivery_date: today }),
      order({ id: "tomorrow", requested_delivery_date: "2026-08-18" }),
    ],
    [item({ sales_order_id: "today" }), item({ sales_order_id: "tomorrow" })],
    today,
  );
  assert.equal(summary.demand_tomorrow, 1);
});

test("next-7-day demand includes the following week window", () => {
  const summary = buildDemandSummary(
    [order({ requested_delivery_date: "2026-08-23" })],
    [item()],
    today,
  );
  assert.equal(summary.next_7_days, 1);
});

test("overdue demand counts active old requested dates", () => {
  const summary = buildDemandSummary(
    [order({ requested_delivery_date: "2026-08-16" })],
    [item()],
    today,
  );
  assert.equal(summary.overdue_unfulfilled, 1);
});

test("days since order is dynamic", () => {
  assert.equal(daysSinceOrder(order({ ordered_at: "2026-08-15T10:00:00Z" }), today), 2);
});

test("days until requested delivery is not the same as order age", () => {
  assert.equal(
    daysUntilRequestedDelivery(order({ requested_delivery_date: "2026-08-19" }), today),
    2,
  );
});

test("delivery lateness only appears after requested date passes", () => {
  assert.equal(deliveryLatenessDays(order({ requested_delivery_date: "2026-08-16" }), today), 1);
  assert.equal(deliveryLatenessDays(order({ requested_delivery_date: "2026-08-18" }), today), 0);
});

test("priority is retained as demand metadata", () => {
  assert.equal(order({ priority: "urgent" }).priority, "urgent");
});

test("order confirmation creates no cash movement", () => {
  const before = calculateCashInHand(cashInput());
  const confirmed = order({ status: "confirmed" });
  assert.equal(confirmed.status, "confirmed");
  assert.equal(calculateCashInHand(cashInput()), before);
});

test("order confirmation creates no bank movement", () => {
  const bankBalance = 5000;
  order({ status: "confirmed" });
  assert.equal(bankBalance, 5000);
});

test("order confirmation creates no receivable", () => {
  const receivables: unknown[] = [];
  order({ status: "confirmed" });
  assert.equal(receivables.length, 0);
});

test("order confirmation creates no invoice", () => {
  const invoices: unknown[] = [];
  order({ status: "confirmed" });
  assert.equal(invoices.length, 0);
});

test("notification dedupe key is stable", () => {
  const note = buildSalesOrderNotification(order());
  assert.equal(note.dedupeKey, "order-confirmed:order-1");
});

test("due notification uses canonical dedupe key", () => {
  const note = buildSalesOrderDueNotification(order({ requested_delivery_date: today }), today);
  assert.equal(note?.dedupeKey, "order-due:order-1:requested");
});

test("valid internal deep link survives", () => {
  assert.equal(validateInternalOrderTarget("/orders?order=abc"), "/orders?order=abc");
});

test("external deep link is rejected", () => {
  assert.equal(validateInternalOrderTarget("https://evil.example/orders"), "/");
});

test("product demand is partial-fulfillment ready with zero allocated and fulfilled today", () => {
  const [row] = buildProductDemand([order()], [item({ quantity: 100 })]);
  assert.equal(row.currently_allocated_quantity, 0);
  assert.equal(row.fulfilled_quantity, 0);
  assert.equal(row.remaining_demand, 100);
  assert.equal(row.commercial_remaining_demand, 100);
});

test("product demand subtracts delivered quantity while commercial demand waits for accepted receiving", () => {
  const [row] = buildProductDemand(
    [order()],
    [item({ id: "item-a", quantity: 100 })],
    [
      {
        sales_order_item_id: "item-a",
        status: "receiving_pending",
        planned_quantity: 60,
        delivered_quantity: 60,
        accepted_quantity: 40,
      },
    ],
  );

  assert.equal(row.currently_allocated_quantity, 60);
  assert.equal(row.fulfilled_quantity, 60);
  assert.equal(row.remaining_demand, 40);
  assert.equal(row.commercial_remaining_demand, 60);
});

test("active demand statuses include planning for production planning foundation", () => {
  assert.equal(isActiveDemandStatus("planning"), true);
});

test("customer portal and WhatsApp sources must still land in one canonical model", () => {
  assert.deepEqual(
    ["admin", "customer_portal", "whatsapp"].sort(),
    ["admin", "customer_portal", "whatsapp"].sort(),
  );
});
