import type { AppRole } from "@/lib/roles";
import {
  notificationDedupeKey,
  sanitizeNotificationTargetUrl,
  type NotificationCreateInput,
} from "@/lib/notifications";

export const ORDER_SOURCES = ["admin", "customer_portal", "whatsapp"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const ORDER_PRIORITIES = ["normal", "high", "urgent"] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export const ORDER_STATUSES = [
  "draft",
  "confirmed",
  "planning",
  "allocated",
  "ready",
  "dispatched",
  "delivered",
  "receiving_pending",
  "receiving_confirmed",
  "completed",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTIVE_DEMAND_STATUSES: OrderStatus[] = [
  "confirmed",
  "planning",
  "allocated",
  "ready",
  "dispatched",
  "delivered",
  "receiving_pending",
  "receiving_confirmed",
];

export const UI_ENABLED_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ["confirmed", "cancelled"],
  confirmed: ["planning", "cancelled"],
  planning: ["cancelled"],
  allocated: [],
  ready: [],
  dispatched: [],
  delivered: [],
  receiving_pending: [],
  receiving_confirmed: [],
  completed: [],
  cancelled: [],
};

export type OrderLike = {
  id: string;
  order_number: string;
  client_id: string;
  branch_id: string | null;
  client_name_snapshot: string;
  branch_name_snapshot?: string | null;
  ordered_at: string;
  requested_delivery_date: string;
  promised_delivery_date?: string | null;
  priority: OrderPriority;
  status: OrderStatus;
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

export function canRoleManageSalesOrders(role: AppRole): boolean {
  return role === "admin" || role === "moderator";
}

export function canTransitionSalesOrder(from: OrderStatus, to: OrderStatus): boolean {
  return UI_ENABLED_ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isActiveDemandStatus(status: OrderStatus): boolean {
  return ACTIVE_DEMAND_STATUSES.includes(status);
}

export function validateOrderItemQuantity(quantity: number): boolean {
  return Number.isFinite(quantity) && quantity > 0;
}

export function validateInternalOrderTarget(targetUrl: string): string {
  return sanitizeNotificationTargetUrl(targetUrl);
}

function dateOnly(value: string | Date): Date {
  const raw = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
}

function daysBetween(left: string | Date, right: string | Date): number {
  return Math.floor((dateOnly(left).getTime() - dateOnly(right).getTime()) / 86_400_000);
}

export function daysSinceOrder(order: Pick<OrderLike, "ordered_at">, today: string | Date): number {
  return Math.max(0, daysBetween(today, order.ordered_at));
}

export function daysUntilRequestedDelivery(
  order: Pick<OrderLike, "requested_delivery_date">,
  today: string | Date,
): number {
  return daysBetween(order.requested_delivery_date, today);
}

export function deliveryLatenessDays(
  order: Pick<OrderLike, "requested_delivery_date" | "status">,
  today: string | Date,
): number {
  if (!isActiveDemandStatus(order.status)) return 0;
  return Math.max(0, -daysUntilRequestedDelivery(order, today));
}

export function branchIdentity(order: Pick<OrderLike, "client_id" | "branch_id">): string {
  return `${order.client_id}:${order.branch_id ?? "no-branch"}`;
}

export function buildSalesOrderNotification(order: OrderLike): NotificationCreateInput {
  return {
    roles: ["admin", "moderator"],
    category: "operational_alerts",
    severity: order.priority === "urgent" ? "High" : "Medium",
    title: "Sales Order Confirmed",
    body: `${order.order_number} confirmed for ${order.client_name_snapshot}${
      order.branch_name_snapshot ? ` - ${order.branch_name_snapshot}` : ""
    }.`,
    targetUrl: `/orders?order=${order.id}`,
    sourceType: "sales_order",
    sourceId: order.id,
    dedupeKey: notificationDedupeKey(["order-confirmed", order.id]),
  };
}

export function buildSalesOrderDueNotification(
  order: OrderLike,
  today: string | Date,
): NotificationCreateInput | null {
  if (!isActiveDemandStatus(order.status)) return null;
  const until = daysUntilRequestedDelivery(order, today);
  if (until > 1) return null;
  return {
    roles: ["admin", "moderator"],
    category: "operational_alerts",
    severity: until < 0 ? "High" : "Medium",
    title: "Order Delivery Date Approaching",
    body: `${order.order_number} requested delivery is ${order.requested_delivery_date}.`,
    targetUrl: `/orders?order=${order.id}`,
    sourceType: "sales_order",
    sourceId: order.id,
    dedupeKey: notificationDedupeKey(["order-due", order.id, "requested"]),
  };
}

export function buildDemandSummary(
  orders: OrderLike[],
  items: OrderItemLike[],
  today: string | Date,
) {
  const todayDate = dateOnly(today);
  const activeOrders = orders.filter((order) => isActiveDemandStatus(order.status));
  const activeIds = new Set(activeOrders.map((order) => order.id));
  const activeItems = items.filter((item) => activeIds.has(item.sales_order_id));

  const countBetween = (start: number, end: number) =>
    activeOrders.filter((order) => {
      const delta = daysBetween(order.requested_delivery_date, todayDate);
      return delta >= start && delta <= end;
    }).length;

  const quantityByProduct = new Map<
    string,
    { product_id: string; product_name: string; unit: string; quantity: number }
  >();
  for (const item of activeItems) {
    const key = `${item.product_id}:${item.unit}`;
    const current = quantityByProduct.get(key) ?? {
      product_id: item.product_id,
      product_name: item.product_name_snapshot,
      unit: item.unit,
      quantity: 0,
    };
    current.quantity += item.quantity;
    quantityByProduct.set(key, current);
  }

  return {
    demand_today: countBetween(0, 0),
    demand_tomorrow: countBetween(1, 1),
    next_3_days: countBetween(0, 2),
    next_7_days: countBetween(0, 6),
    overdue_unfulfilled: activeOrders.filter(
      (order) => daysBetween(order.requested_delivery_date, todayDate) < 0,
    ).length,
    quantity_by_product: [...quantityByProduct.values()],
  };
}

export function buildProductDemand(
  orders: OrderLike[],
  items: OrderItemLike[],
  fulfillmentItems: FulfillmentDemandItemLike[] = [],
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
    current.plannedQuantity += toFiniteNumber(fulfillmentItem.planned_quantity);
    current.deliveredQuantity += toFiniteNumber(fulfillmentItem.delivered_quantity);
    current.acceptedQuantity += toFiniteNumber(fulfillmentItem.accepted_quantity);
    fulfillmentByItemId.set(fulfillmentItem.sales_order_item_id, current);
  }

  for (const item of items) {
    const order = orderById.get(item.sales_order_id);
    if (!order || !isActiveDemandStatus(order.status)) continue;
    const fulfillment = fulfillmentByItemId.get(item.id) ?? {
      plannedQuantity: 0,
      deliveredQuantity: 0,
      acceptedQuantity: 0,
    };
    const key = `${item.product_id}:${item.unit}`;
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
        (branch) => branchIdentity(branch) === branchIdentity(order),
      )
    ) {
      row.affected_customer_branches.push({
        client_id: order.client_id,
        branch_id: order.branch_id,
        client_name: order.client_name_snapshot,
        branch_name: order.branch_name_snapshot || "No branch",
      });
    }
    row.order_count = new Set(
      items
        .filter(
          (candidate) => candidate.product_id === item.product_id && candidate.unit === item.unit,
        )
        .map((candidate) => candidate.sales_order_id)
        .filter((id) => isActiveDemandStatus(orderById.get(id)?.status as OrderStatus)),
    ).size;
    rows.set(key, row);
  }

  return [...rows.values()].sort(
    (a, b) =>
      a.earliest_requested_delivery.localeCompare(b.earliest_requested_delivery) ||
      a.product_name.localeCompare(b.product_name),
  );
}

function toFiniteNumber(value: number | string | null | undefined): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}
