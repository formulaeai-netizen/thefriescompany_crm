import type { AppRole } from "@/lib/roles";
import type { OrderStatus } from "@/lib/sales-orders";

export const FULFILLMENT_STATUSES = [
  "planned",
  "ready",
  "dispatched",
  "delivered",
  "receiving_pending",
  "receiving_confirmed",
  "cancelled",
  "failed",
] as const;

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export type FulfillmentQuantityInput = {
  orderedQuantity: number;
  plannedQuantity?: number;
  deliveredQuantity?: number;
  acceptedQuantity?: number;
};

export type FulfillmentLineLike = {
  id: string;
  sales_order_item_id: string;
  ordered_quantity_snapshot: number;
  planned_quantity: number;
  dispatched_quantity: number;
  delivered_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  unit_price_snapshot?: number | null;
};

export type FulfillmentLike = {
  id: string;
  sales_order_id: string;
  status: FulfillmentStatus;
  responsible_user?: string | null;
  delivered_at?: string | null;
  receiving_confirmed_at?: string | null;
};

export type ReceivingLineInput = {
  fulfillment_item_id: string;
  delivered_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  unit_price_snapshot?: number | null;
};

export type MissingReceivingIncidentInput = {
  fulfillmentId: string;
  responsibleUser?: string | null;
  deliveredAt: string;
  status: FulfillmentStatus;
};

export const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, FulfillmentStatus[]> = {
  planned: ["ready", "dispatched", "cancelled", "failed"],
  ready: ["dispatched", "cancelled", "failed"],
  dispatched: ["receiving_pending", "failed"],
  delivered: ["receiving_pending"],
  receiving_pending: ["receiving_confirmed", "failed"],
  receiving_confirmed: [],
  cancelled: [],
  failed: [],
};

export function canRoleManageFulfillment(role: AppRole): boolean {
  return role === "admin" || role === "moderator";
}

export function canRoleViewFulfillment(role: AppRole): boolean {
  return role === "admin" || role === "moderator" || role === "staff";
}

export function canTransitionFulfillment(from: FulfillmentStatus, to: FulfillmentStatus): boolean {
  return FULFILLMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function remainingToPlan(input: FulfillmentQuantityInput): number {
  return Math.max(input.orderedQuantity - (input.plannedQuantity ?? 0), 0);
}

export function remainingToDeliver(input: FulfillmentQuantityInput): number {
  return Math.max(input.orderedQuantity - (input.deliveredQuantity ?? 0), 0);
}

export function commercialRemainingToReceive(input: FulfillmentQuantityInput): number {
  return Math.max(input.orderedQuantity - (input.acceptedQuantity ?? 0), 0);
}

export function assertCanPlanQuantity(
  orderedQuantity: number,
  alreadyPlanned: number,
  next: number,
) {
  if (!Number.isFinite(next) || next <= 0) throw new Error("Quantity must be greater than zero");
  if (next > remainingToPlan({ orderedQuantity, plannedQuantity: alreadyPlanned })) {
    throw new Error("Fulfillment quantity exceeds remaining ordered quantity");
  }
}

export function validateReceivingLine(line: ReceivingLineInput) {
  if (line.accepted_quantity < 0 || line.rejected_quantity < 0) {
    throw new Error("Accepted/rejected quantities cannot be negative");
  }
  if (line.accepted_quantity + line.rejected_quantity > line.delivered_quantity) {
    throw new Error("Accepted plus rejected quantity cannot exceed delivered quantity");
  }
  if (line.accepted_quantity > 0 && line.unit_price_snapshot == null) {
    throw new Error("Cannot create payable invoice without deterministic unit price");
  }
}

export function payableAmountFromReceiving(lines: ReceivingLineInput[]): number {
  return lines.reduce((sum, line) => {
    validateReceivingLine(line);
    return sum + line.accepted_quantity * Number(line.unit_price_snapshot ?? 0);
  }, 0);
}

export function customerOutstandingBeforeReceiving(): number {
  return 0;
}

export function customerOutstandingAfterReceiving(lines: ReceivingLineInput[]): number {
  return payableAmountFromReceiving(lines);
}

export function deliveryReceivingCreatesCashMovement(): false {
  return false;
}

export function isAwaitingReceivingReminderEligible(invoice: {
  receiving_status?: string | null;
}): boolean {
  return invoice.receiving_status !== "awaiting_receiving";
}

export function missingReceivingDedupeKey(fulfillmentId: string): string {
  return `missing-receiving:${fulfillmentId}`;
}

function dateOnly(value: string | Date): Date {
  const raw = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return new Date(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()));
}

function daysBetween(left: string | Date, right: string | Date): number {
  return Math.floor((dateOnly(left).getTime() - dateOnly(right).getTime()) / 86_400_000);
}

export function isMissingReceiving3Days(
  fulfillment: Pick<MissingReceivingIncidentInput, "status" | "deliveredAt">,
  today: string | Date,
): boolean {
  if (fulfillment.status !== "receiving_pending") return false;
  return daysBetween(today, fulfillment.deliveredAt) >= 3;
}

export function selectMissingReceivingIncidents(
  fulfillments: MissingReceivingIncidentInput[],
  existingDedupeKeys: Set<string>,
  today: string | Date,
) {
  return fulfillments.filter(
    (fulfillment) =>
      isMissingReceiving3Days(fulfillment, today) &&
      !existingDedupeKeys.has(missingReceivingDedupeKey(fulfillment.fulfillmentId)),
  );
}

export function recipientsForMissingReceiving(input: {
  responsibleUser?: string | null;
  adminUserIds: string[];
}): string[] {
  return [
    ...new Set([...input.adminUserIds, ...(input.responsibleUser ? [input.responsibleUser] : [])]),
  ];
}

export function deriveOrderStatusFromFulfillment(input: {
  currentStatus: OrderStatus;
  orderedQuantity: number;
  plannedQuantity: number;
  dispatchedQuantity: number;
  deliveredQuantity: number;
  acceptedQuantity: number;
}): OrderStatus {
  if (["draft", "cancelled", "completed"].includes(input.currentStatus)) return input.currentStatus;
  if (input.acceptedQuantity >= input.orderedQuantity) return "receiving_confirmed";
  if (input.deliveredQuantity >= input.orderedQuantity) return "receiving_pending";
  if (input.dispatchedQuantity > 0) return "dispatched";
  if (input.plannedQuantity >= input.orderedQuantity) return "allocated";
  return input.currentStatus === "confirmed" ? "planning" : input.currentStatus;
}

export function demandAfterFulfillment(input: {
  orderedQuantity: number;
  deliveredQuantity: number;
  acceptedQuantity: number;
}) {
  return {
    operationalProductionDemand: remainingToDeliver(input),
    commercialOutstandingFulfillment: commercialRemainingToReceive(input),
  };
}
