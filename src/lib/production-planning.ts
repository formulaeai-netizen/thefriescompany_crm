import type { AppRole } from "./roles.ts";
import { notificationDedupeKey } from "./notifications.ts";

export type OrderLike = {
  id: string;
  order_number: string;
  client_id: string;
  branch_id: string | null;
  client_name_snapshot: string;
  branch_name_snapshot?: string | null;
  ordered_at: string;
  requested_delivery_date: string;
  priority: "normal" | "high" | "urgent";
  status: string;
};

export type OrderItemLike = {
  id: string;
  sales_order_id: string;
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  unit: string;
};

export type FulfillmentDemandItemLike = {
  sales_order_item_id: string;
  status?: string | null;
  planned_quantity?: number | string | null;
  delivered_quantity?: number | string | null;
  accepted_quantity?: number | string | null;
};

export type ProductDemandRow = {
  product_id: string;
  product_name: string;
  unit: string;
  total_confirmed_demand: number;
  requested_quantity: number;
  currently_allocated_quantity: number;
  fulfilled_quantity: number;
  remaining_demand: number;
  earliest_requested_delivery: string;
  order_count: number;
  delivered_quantity: number;
  accepted_quantity: number;
  commercial_remaining_demand: number;
  affected_customer_branches: Array<{
    client_id: string;
    branch_id: string | null;
    client_name: string;
    branch_name: string;
  }>;
};

const ACTIVE_DEMAND_STATUSES = new Set([
  "confirmed",
  "planning",
  "allocated",
  "ready",
  "dispatched",
  "delivered",
  "receiving_pending",
  "receiving_confirmed",
]);

export type StockPosition = {
  productId: string;
  productName: string;
  unit: string;
  availableQuantity: number;
};

export type ProductionRequirementRow = ProductDemandRow & {
  finished_stock_available: number;
  production_required: number;
  planned_production_quantity: number;
  predicted_shortfall: number;
};

export type RecipeItem = {
  inventoryItemId: string;
  itemName: string;
  quantityRequired: number;
  unit: string;
  wastageBufferPercent?: number | null;
  supplierName?: string | null;
  supplierLeadTimeHours?: number | null;
};

export type Recipe = {
  id: string;
  finishedProductId: string;
  outputQuantity: number;
  outputUnit: string;
  active: boolean;
  items: RecipeItem[];
};

export type InventoryStock = {
  inventoryItemId: string;
  itemName: string;
  currentStock: number;
  minimumStock?: number | null;
  unit: string;
};

export type RawMaterialRequirement = {
  status: "configured" | "recipe_not_configured" | "incompatible_unit";
  productId: string;
  productName: string;
  rawMaterialId: string | null;
  rawMaterialName: string | null;
  unit: string | null;
  requiredQuantity: number | null;
  availableQuantity: number | null;
  safetyStock: number | null;
  shortageQuantity: number | null;
  recommendation: ReorderRecommendation;
  suggestedOrderQuantity: number | null;
  supplierName: string | null;
  supplierLeadTimeHours: number | null;
  reason: string;
};

export type ReorderRecommendation =
  | "No Action"
  | "Monitor"
  | "Order Soon"
  | "Order Now / Critical"
  | "Recipe Required"
  | "Check Unit";

export function normalizeUnit(unit: string | null | undefined): string {
  return String(unit ?? "")
    .trim()
    .toLowerCase();
}

export function unitsCompatible(left: string | null | undefined, right: string | null | undefined) {
  return normalizeUnit(left) === normalizeUnit(right);
}

export function buildProductionRequirements(
  orders: OrderLike[],
  items: OrderItemLike[],
  fulfillmentItems: FulfillmentDemandItemLike[],
  finishedStock: StockPosition[],
  plannedQuantities: Array<{ productId: string; unit: string; quantity: number }> = [],
): ProductionRequirementRow[] {
  const demandRows = buildProductDemandRows(orders, items, fulfillmentItems);
  return demandRows.map((row) => {
    const available = finishedStock
      .filter(
        (stock) => stock.productId === row.product_id && unitsCompatible(stock.unit, row.unit),
      )
      .reduce((sum, stock) => sum + finite(stock.availableQuantity), 0);
    const planned = plannedQuantities
      .filter((plan) => plan.productId === row.product_id && unitsCompatible(plan.unit, row.unit))
      .reduce((sum, plan) => sum + finite(plan.quantity), 0);
    const productionRequired = Math.max(row.remaining_demand - available, 0);
    return {
      ...row,
      finished_stock_available: available,
      production_required: productionRequired,
      planned_production_quantity: planned,
      predicted_shortfall: Math.max(productionRequired - planned, 0),
    };
  });
}

function buildProductDemandRows(
  orders: OrderLike[],
  items: OrderItemLike[],
  fulfillmentItems: FulfillmentDemandItemLike[],
): ProductDemandRow[] {
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const rows = new Map<string, ProductDemandRow>();
  const fulfillmentByItemId = new Map<
    string,
    { plannedQuantity: number; deliveredQuantity: number; acceptedQuantity: number }
  >();

  for (const fulfillmentItem of fulfillmentItems) {
    if (["cancelled", "failed"].includes(String(fulfillmentItem.status ?? ""))) continue;
    const current = fulfillmentByItemId.get(fulfillmentItem.sales_order_item_id) ?? {
      plannedQuantity: 0,
      deliveredQuantity: 0,
      acceptedQuantity: 0,
    };
    current.plannedQuantity += finite(fulfillmentItem.planned_quantity);
    current.deliveredQuantity += finite(fulfillmentItem.delivered_quantity);
    current.acceptedQuantity += finite(fulfillmentItem.accepted_quantity);
    fulfillmentByItemId.set(fulfillmentItem.sales_order_item_id, current);
  }

  for (const item of items) {
    const order = orderById.get(item.sales_order_id);
    if (!order || !ACTIVE_DEMAND_STATUSES.has(order.status)) continue;
    const fulfillment = fulfillmentByItemId.get(item.id) ?? {
      plannedQuantity: 0,
      deliveredQuantity: 0,
      acceptedQuantity: 0,
    };
    const key = `${item.product_id}:${normalizeUnit(item.unit)}`;
    const row = rows.get(key) ?? {
      product_id: item.product_id,
      product_name: item.product_name_snapshot,
      unit: item.unit,
      total_confirmed_demand: 0,
      requested_quantity: 0,
      currently_allocated_quantity: 0,
      fulfilled_quantity: 0,
      remaining_demand: 0,
      earliest_requested_delivery: order.requested_delivery_date,
      order_count: 0,
      delivered_quantity: 0,
      accepted_quantity: 0,
      commercial_remaining_demand: 0,
      affected_customer_branches: [],
    };
    row.total_confirmed_demand += item.quantity;
    row.requested_quantity += item.quantity;
    row.currently_allocated_quantity += fulfillment.plannedQuantity;
    row.fulfilled_quantity += fulfillment.deliveredQuantity;
    row.delivered_quantity += fulfillment.deliveredQuantity;
    row.accepted_quantity += fulfillment.acceptedQuantity;
    row.remaining_demand += Math.max(item.quantity - fulfillment.deliveredQuantity, 0);
    row.commercial_remaining_demand += Math.max(item.quantity - fulfillment.acceptedQuantity, 0);
    row.earliest_requested_delivery =
      order.requested_delivery_date < row.earliest_requested_delivery
        ? order.requested_delivery_date
        : row.earliest_requested_delivery;
    if (
      !row.affected_customer_branches.some(
        (branch) =>
          `${branch.client_id}:${branch.branch_id ?? "no-branch"}` ===
          `${order.client_id}:${order.branch_id ?? "no-branch"}`,
      )
    ) {
      row.affected_customer_branches.push({
        client_id: order.client_id,
        branch_id: order.branch_id,
        client_name: order.client_name_snapshot,
        branch_name: order.branch_name_snapshot || "No branch",
      });
    }
    rows.set(key, row);
  }

  for (const row of rows.values()) {
    row.order_count = new Set(
      items
        .filter(
          (candidate) =>
            candidate.product_id === row.product_id && unitsCompatible(candidate.unit, row.unit),
        )
        .map((candidate) => candidate.sales_order_id)
        .filter((id) => ACTIVE_DEMAND_STATUSES.has(String(orderById.get(id)?.status ?? ""))),
    ).size;
  }

  return [...rows.values()].sort(
    (a, b) =>
      a.earliest_requested_delivery.localeCompare(b.earliest_requested_delivery) ||
      a.product_name.localeCompare(b.product_name),
  );
}

export function rawMaterialRequirementUnavailable(productId: string, productName: string) {
  return {
    status: "recipe_not_configured" as const,
    productId,
    productName,
    rawMaterialId: null,
    rawMaterialName: null,
    unit: null,
    requiredQuantity: null,
    availableQuantity: null,
    safetyStock: null,
    shortageQuantity: null,
    recommendation: "Recipe Required" as const,
    suggestedOrderQuantity: null,
    supplierName: null,
    supplierLeadTimeHours: null,
    reason: "Raw-material requirement unavailable - recipe not configured.",
  };
}

export function calculateRecipeItemRequirement(
  plannedProductionQuantity: number,
  recipeOutputQuantity: number,
  itemQuantityRequired: number,
  wastageBufferPercent?: number | null,
): number {
  if (
    !Number.isFinite(plannedProductionQuantity) ||
    !Number.isFinite(recipeOutputQuantity) ||
    !Number.isFinite(itemQuantityRequired) ||
    recipeOutputQuantity <= 0 ||
    itemQuantityRequired < 0
  ) {
    throw new Error("Invalid recipe requirement inputs");
  }
  return roundDecimal(
    (plannedProductionQuantity / recipeOutputQuantity) *
      itemQuantityRequired *
      (1 + finite(wastageBufferPercent) / 100),
  );
}

export function assessRawMaterialPosition(input: {
  requiredQuantity: number;
  availableQuantity: number;
  safetyStock?: number | null;
}): {
  shortageQuantity: number;
  recommendation: Exclude<ReorderRecommendation, "Recipe Required" | "Check Unit">;
  suggestedOrderQuantity: number;
} {
  const required = finite(input.requiredQuantity);
  const available = finite(input.availableQuantity);
  const safety = finite(input.safetyStock);
  const shortage = Math.max(required + safety - available, 0);
  let recommendation: Exclude<ReorderRecommendation, "Recipe Required" | "Check Unit"> =
    "No Action";
  if (shortage > 0) recommendation = available < required ? "Order Now / Critical" : "Order Soon";
  else if (available <= safety) recommendation = "Monitor";
  return {
    shortageQuantity: shortage,
    recommendation,
    suggestedOrderQuantity: shortage,
  };
}

export function calculateRawMaterialRequirements(
  requirement: Pick<
    ProductionRequirementRow,
    "product_id" | "product_name" | "unit" | "production_required" | "planned_production_quantity"
  >,
  recipe: Recipe | null | undefined,
  inventory: InventoryStock[],
): RawMaterialRequirement[] {
  if (!recipe || !recipe.active || !unitsCompatible(recipe.outputUnit, requirement.unit)) {
    return [rawMaterialRequirementUnavailable(requirement.product_id, requirement.product_name)];
  }
  const planningQuantity = Math.max(
    finite(requirement.production_required),
    finite(requirement.planned_production_quantity),
  );
  return recipe.items.map((item) => {
    const stock = inventory.find((row) => row.inventoryItemId === item.inventoryItemId);
    const required = calculateRecipeItemRequirement(
      planningQuantity,
      recipe.outputQuantity,
      item.quantityRequired,
      item.wastageBufferPercent,
    );
    if (!stock || !unitsCompatible(stock.unit, item.unit)) {
      return {
        status: "incompatible_unit",
        productId: requirement.product_id,
        productName: requirement.product_name,
        rawMaterialId: item.inventoryItemId,
        rawMaterialName: item.itemName,
        unit: item.unit,
        requiredQuantity: required,
        availableQuantity: null,
        safetyStock: null,
        shortageQuantity: null,
        recommendation: "Check Unit" as const,
        suggestedOrderQuantity: null,
        supplierName: item.supplierName ?? null,
        supplierLeadTimeHours: item.supplierLeadTimeHours ?? null,
        reason: "Raw material inventory unit does not match configured recipe unit.",
      };
    }
    const position = assessRawMaterialPosition({
      requiredQuantity: required,
      availableQuantity: stock.currentStock,
      safetyStock: stock.minimumStock,
    });
    return {
      status: "configured",
      productId: requirement.product_id,
      productName: requirement.product_name,
      rawMaterialId: item.inventoryItemId,
      rawMaterialName: item.itemName,
      unit: item.unit,
      requiredQuantity: required,
      availableQuantity: stock.currentStock,
      safetyStock: finite(stock.minimumStock),
      shortageQuantity: position.shortageQuantity,
      recommendation: position.recommendation,
      suggestedOrderQuantity: position.suggestedOrderQuantity,
      supplierName: item.supplierName ?? null,
      supplierLeadTimeHours: item.supplierLeadTimeHours ?? null,
      reason:
        position.shortageQuantity > 0
          ? "Required quantity plus safety stock exceeds available raw material."
          : "Raw material position is sufficient for this planning window.",
    };
  });
}

export function planVariance(planned: number, actual: number | null | undefined) {
  if (actual == null || !Number.isFinite(Number(actual))) {
    return { variance: null, achievementPercent: null };
  }
  const plannedValue = finite(planned);
  const actualValue = finite(actual);
  return {
    variance: actualValue - plannedValue,
    achievementPercent: plannedValue > 0 ? roundDecimal((actualValue / plannedValue) * 100) : null,
  };
}

export function productionShortfallDedupeKey(input: {
  productId: string;
  windowStart: string;
  windowEnd: string;
  unit: string;
}) {
  return notificationDedupeKey([
    "production-shortfall",
    input.productId,
    input.windowStart,
    input.windowEnd,
    input.unit,
  ]);
}

export function rawMaterialShortageDedupeKey(input: {
  productId: string;
  rawMaterialId: string;
  requiredBy: string;
}) {
  return notificationDedupeKey([
    "raw-material-shortage",
    input.productId,
    input.rawMaterialId,
    input.requiredBy,
  ]);
}

export function canRoleViewProductionPlanning(role: AppRole): boolean {
  return role === "admin" || role === "moderator";
}

export function canRoleManageRecipes(role: AppRole): boolean {
  return role === "admin";
}

export function canRoleManageProductionPlans(role: AppRole): boolean {
  return role === "admin" || role === "moderator";
}

export function canRoleUpdateProductionActuals(role: AppRole): boolean {
  return role === "admin" || role === "moderator" || role === "staff";
}

export function purchaseSuggestionHasFinancialMutation(): false {
  return false;
}

export function productionPlanHasCashBankMutation(): false {
  return false;
}

function finite(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundDecimal(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
