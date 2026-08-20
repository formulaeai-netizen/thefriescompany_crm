import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assessRawMaterialPosition,
  buildProductionRequirements,
  calculateRawMaterialRequirements,
  calculateRecipeItemRequirement,
  canRoleManageProductionPlans,
  canRoleManageRecipes,
  canRoleUpdateProductionActuals,
  canRoleViewProductionPlanning,
  type OrderItemLike,
  type OrderLike,
  planVariance,
  productionPlanHasCashBankMutation,
  productionShortfallDedupeKey,
  purchaseSuggestionHasFinancialMutation,
  rawMaterialShortageDedupeKey,
} from "./production-planning.ts";

function order(overrides: Partial<OrderLike> = {}): OrderLike {
  return {
    id: overrides.id ?? "order-1",
    order_number: overrides.order_number ?? "ORD-1",
    client_id: overrides.client_id ?? "client-1",
    branch_id: overrides.branch_id ?? "branch-1",
    client_name_snapshot: overrides.client_name_snapshot ?? "Client",
    branch_name_snapshot: overrides.branch_name_snapshot ?? "Main",
    ordered_at: overrides.ordered_at ?? "2026-08-18T06:00:00.000Z",
    requested_delivery_date: overrides.requested_delivery_date ?? "2026-08-18",
    priority: overrides.priority ?? "normal",
    status: overrides.status ?? "confirmed",
  };
}

function line(overrides: Partial<OrderItemLike> = {}): OrderItemLike {
  return {
    id: overrides.id ?? "line-1",
    sales_order_id: overrides.sales_order_id ?? "order-1",
    product_id: overrides.product_id ?? "product-1",
    product_name_snapshot: overrides.product_name_snapshot ?? "Curly Fries",
    quantity: overrides.quantity ?? 100,
    unit: overrides.unit ?? "packs",
  };
}

test("1. draft/cancelled orders are excluded from production demand", () => {
  const rows = buildProductionRequirements(
    [order({ id: "draft", status: "draft" }), order({ id: "cancelled", status: "cancelled" })],
    [line({ sales_order_id: "draft" }), line({ sales_order_id: "cancelled" })],
    [],
    [],
  );
  assert.equal(rows.length, 0);
});

test("2. confirmed demand is included", () => {
  const rows = buildProductionRequirements([order()], [line({ quantity: 25 })], [], []);
  assert.equal(rows[0].remaining_demand, 25);
});

test("3. delivered quantity subtracts from physical production demand", () => {
  const rows = buildProductionRequirements(
    [order()],
    [line({ quantity: 100 })],
    [{ sales_order_item_id: "line-1", delivered_quantity: 40, accepted_quantity: 10 }],
    [],
  );
  assert.equal(rows[0].remaining_demand, 60);
});

test("4. partial delivery leaves correct remaining demand", () => {
  const rows = buildProductionRequirements(
    [order()],
    [line({ quantity: 100 })],
    [{ sales_order_item_id: "line-1", delivered_quantity: 75 }],
    [],
  );
  assert.equal(rows[0].production_required, 25);
});

test("5. finished stock reduces production requirement", () => {
  const rows = buildProductionRequirements(
    [order()],
    [line({ quantity: 100 })],
    [],
    [{ productId: "product-1", productName: "Curly Fries", unit: "packs", availableQuantity: 30 }],
  );
  assert.equal(rows[0].production_required, 70);
});

test("6. stock >= demand gives production required zero", () => {
  const rows = buildProductionRequirements(
    [order()],
    [line({ quantity: 100 })],
    [],
    [{ productId: "product-1", productName: "Curly Fries", unit: "packs", availableQuantity: 120 }],
  );
  assert.equal(rows[0].production_required, 0);
});

test("7. no recipe reports raw-material requirement unavailable", () => {
  const rows = buildProductionRequirements([order()], [line({ quantity: 100 })], [], []);
  const raw = calculateRawMaterialRequirements(rows[0], null, []);
  assert.equal(raw[0].status, "recipe_not_configured");
  assert.match(raw[0].reason, /recipe not configured/);
});

test("8. BOM requirement calculation is proportional to recipe output", () => {
  assert.equal(calculateRecipeItemRequirement(200, 100, 50, 0), 100);
});

test("9. recipe buffer calculation is explicit", () => {
  assert.equal(calculateRecipeItemRequirement(200, 100, 50, 10), 110);
});

test("10. raw material shortage is calculated from required + safety - available", () => {
  const position = assessRawMaterialPosition({
    requiredQuantity: 100,
    safetyStock: 20,
    availableQuantity: 80,
  });
  assert.equal(position.shortageQuantity, 40);
  assert.equal(position.recommendation, "Order Now / Critical");
});

test("11. sufficient raw material creates no false shortage", () => {
  const position = assessRawMaterialPosition({
    requiredQuantity: 100,
    safetyStock: 20,
    availableQuantity: 140,
  });
  assert.equal(position.shortageQuantity, 0);
  assert.equal(position.recommendation, "No Action");
});

test("12. incompatible units are not incorrectly summed", () => {
  const rows = buildProductionRequirements([order()], [line({ quantity: 100 })], [], []);
  const raw = calculateRawMaterialRequirements(
    rows[0],
    {
      id: "recipe-1",
      finishedProductId: "product-1",
      active: true,
      outputQuantity: 100,
      outputUnit: "packs",
      items: [
        {
          inventoryItemId: "oil",
          itemName: "Oil",
          quantityRequired: 5,
          unit: "litres",
        },
      ],
    },
    [{ inventoryItemId: "oil", itemName: "Oil", currentStock: 100, unit: "kg" }],
  );
  assert.equal(raw[0].status, "incompatible_unit");
  assert.equal(raw[0].availableQuantity, null);
});

test("13. purchase suggestion creates no financial movement", () => {
  assert.equal(purchaseSuggestionHasFinancialMutation(), false);
});

test("14. production plan creates no Cash/Bank movement", () => {
  assert.equal(productionPlanHasCashBankMutation(), false);
});

test("15. planned vs actual variance is truthful", () => {
  assert.deepEqual(planVariance(120, 110), {
    variance: -10,
    achievementPercent: 91.666667,
  });
  assert.deepEqual(planVariance(100, 115), { variance: 15, achievementPercent: 115 });
});

test("16. raw-material shortage notification dedupe key is stable", () => {
  assert.equal(
    rawMaterialShortageDedupeKey({
      productId: "product-1",
      rawMaterialId: "packaging",
      requiredBy: "2026-08-18",
    }),
    "raw-material-shortage:product-1:packaging:2026-08-18",
  );
});

test("17. production-shortfall notification dedupe key is stable", () => {
  assert.equal(
    productionShortfallDedupeKey({
      productId: "product-1",
      windowStart: "2026-08-18",
      windowEnd: "2026-08-20",
      unit: "packs",
    }),
    "production-shortfall:product-1:2026-08-18:2026-08-20:packs",
  );
});

test("18. role protections match Phase 5D policy", () => {
  assert.equal(canRoleViewProductionPlanning("admin"), true);
  assert.equal(canRoleViewProductionPlanning("moderator"), true);
  assert.equal(canRoleViewProductionPlanning("staff"), false);
  assert.equal(canRoleViewProductionPlanning("investor"), false);
  assert.equal(canRoleManageRecipes("admin"), true);
  assert.equal(canRoleManageRecipes("moderator"), false);
  assert.equal(canRoleManageProductionPlans("moderator"), true);
  assert.equal(canRoleUpdateProductionActuals("staff"), true);
});
