import Decimal from "decimal.js-light";

// Pure business logic for the normalized monthly physical stock audit
// feature. Uses a single production-facility model: no facility-management
// module exists, callers should pass a facility_name snapshot string.

export type AuditType = "mid_month" | "month_end";

/** Precision, in the item's own unit, used for stock-variance comparisons. */
export const STOCK_VARIANCE_PRECISION = 0.01;

function parseDateOnly(date: string | Date): Date {
  if (date instanceof Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid date: ${date}`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

/** True when the given date is the 15th calendar day of its month. */
export function isMidMonthAuditDate(date: string | Date): boolean {
  return parseDateOnly(date).getUTCDate() === 15;
}

/** Returns the final calendar day of the month containing `date` (handles leap years). */
export function getLastCalendarDayOfMonth(date: string | Date): Date {
  const d = parseDateOnly(date);
  // Day 0 of the next month is the last day of the current month.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** True when the given date is the final calendar day of its month. */
export function isMonthEndAuditDate(date: string | Date): boolean {
  const d = parseDateOnly(date);
  const lastDay = getLastCalendarDayOfMonth(d);
  return (
    d.getUTCFullYear() === lastDay.getUTCFullYear() &&
    d.getUTCMonth() === lastDay.getUTCMonth() &&
    d.getUTCDate() === lastDay.getUTCDate()
  );
}

/**
 * Classifies a date as a mid-month or month-end audit date, or null if the
 * date is not a scheduled audit date at all.
 */
export function classifyAuditDate(date: string | Date): AuditType | null {
  if (isMidMonthAuditDate(date)) {
    return "mid_month";
  }
  if (isMonthEndAuditDate(date)) {
    return "month_end";
  }
  return null;
}

/** Stock variance (physical/reconciled minus system snapshot). */
export function calculateStockVariance(systemQuantity: number, physicalQuantity: number): number {
  if (physicalQuantity < 0) {
    throw new Error("Physical count cannot be negative");
  }
  return new Decimal(physicalQuantity).minus(systemQuantity).toNumber();
}

/** Whether a stock variance is outside the accepted comparison precision. */
export function isStockVarianceOutsideTolerance(variance: number): boolean {
  return new Decimal(variance).abs().greaterThan(STOCK_VARIANCE_PRECISION);
}

export type StockAuditItemCount = {
  auditItemId: string;
  physicalQuantity: number;
};

/** Validates a list of physical counts before they reach the server function. */
export function assertValidStockAuditCounts(items: StockAuditItemCount[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one item count is required");
  }
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.auditItemId || item.auditItemId.trim().length === 0) {
      throw new Error("Each count must reference an audit item");
    }
    if (seen.has(item.auditItemId)) {
      throw new Error(`Duplicate count submitted for item ${item.auditItemId}`);
    }
    seen.add(item.auditItemId);
    if (!Number.isFinite(item.physicalQuantity) || item.physicalQuantity < 0) {
      throw new Error(
        `Physical quantity for item ${item.auditItemId} must be zero or a positive number`,
      );
    }
  }
}

/**
 * Mirrors the completeness check enforced by submit_stock_audit_staff_count
 * and submit_stock_audit_management_count (static TypeScript mirror only -
 * this does not run against a database): the submitted items must cover
 * every expected audit item exactly once. Partial submissions and extra/
 * unknown items are both rejected.
 */
export function assertCompleteStockAuditSubmission(
  items: StockAuditItemCount[],
  expectedAuditItemIds: string[],
): void {
  assertValidStockAuditCounts(items);

  const expected = new Set(expectedAuditItemIds);
  const submitted = new Set(items.map((item) => item.auditItemId));

  for (const id of submitted) {
    if (!expected.has(id)) {
      throw new Error(`Item ${id} does not belong to this audit`);
    }
  }

  if (submitted.size !== expected.size) {
    throw new Error(
      `Submission must include every audit item exactly once (expected ${expected.size}, got ${submitted.size})`,
    );
  }
}

export type StockAuditReconciliationItem = {
  auditItemId: string;
  reconciledQuantity: number;
  reconciliationReason?: string | null;
};

/**
 * Mirrors the completeness/validity checks enforced by
 * reconcile_and_lock_stock_audit (static TypeScript mirror only): the
 * reconciled-items payload must be non-empty, cover every expected audit
 * item exactly once, and use zero-or-positive numeric quantities.
 */
export function assertValidStockAuditReconciliation(
  items: StockAuditReconciliationItem[],
  expectedAuditItemIds: string[],
): void {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("At least one reconciled item is required");
  }

  const seen = new Set<string>();
  for (const item of items) {
    if (!item.auditItemId || item.auditItemId.trim().length === 0) {
      throw new Error("Each reconciled item requires an audit_item_id");
    }
    if (seen.has(item.auditItemId)) {
      throw new Error(`Duplicate reconciled audit_item_id: ${item.auditItemId}`);
    }
    seen.add(item.auditItemId);
    if (!Number.isFinite(item.reconciledQuantity) || item.reconciledQuantity < 0) {
      throw new Error(`reconciled_quantity must be zero or positive for item ${item.auditItemId}`);
    }
  }

  const expected = new Set(expectedAuditItemIds);
  for (const id of seen) {
    if (!expected.has(id)) {
      throw new Error(`Item ${id} does not belong to this audit`);
    }
  }

  if (seen.size !== expected.size) {
    throw new Error(
      `Reconciliation must cover every audit item exactly once (expected ${expected.size}, got ${seen.size})`,
    );
  }
}

/**
 * Mirrors the reconcile_and_lock_stock_audit reason requirement (static
 * TypeScript mirror only): a reason is required whenever the Staff and
 * Management counts differ from each other, the reconciled value differs
 * from either submitted count, or the reconciled value differs from the
 * system snapshot beyond the shared comparison precision.
 */
export function stockAuditReconciliationNeedsReason(
  systemQuantity: number,
  staffQuantity: number,
  managementQuantity: number,
  reconciledQuantity: number,
): boolean {
  return (
    isStockVarianceOutsideTolerance(staffQuantity - managementQuantity) ||
    isStockVarianceOutsideTolerance(reconciledQuantity - staffQuantity) ||
    isStockVarianceOutsideTolerance(reconciledQuantity - managementQuantity) ||
    isStockVarianceOutsideTolerance(calculateStockVariance(systemQuantity, reconciledQuantity))
  );
}
