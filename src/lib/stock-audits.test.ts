import assert from "node:assert/strict";
import test from "node:test";

import {
  STOCK_VARIANCE_PRECISION,
  assertCompleteStockAuditSubmission,
  assertValidStockAuditCounts,
  assertValidStockAuditReconciliation,
  calculateStockVariance,
  classifyAuditDate,
  getLastCalendarDayOfMonth,
  isMidMonthAuditDate,
  isMonthEndAuditDate,
  isStockVarianceOutsideTolerance,
  stockAuditReconciliationNeedsReason,
} from "./stock-audits.ts";

test("the 15th is a valid mid-month audit date", () => {
  assert.equal(isMidMonthAuditDate("2026-07-15"), true);
  assert.equal(classifyAuditDate("2026-07-15"), "mid_month");
});

test("30-day month end is detected correctly", () => {
  assert.equal(isMonthEndAuditDate("2026-06-30"), true);
  assert.equal(classifyAuditDate("2026-06-30"), "month_end");
  assert.equal(isMonthEndAuditDate("2026-06-29"), false);
});

test("31-day month end is detected correctly", () => {
  assert.equal(isMonthEndAuditDate("2026-07-31"), true);
  assert.equal(classifyAuditDate("2026-07-31"), "month_end");
});

test("February handles a non-leap year (28 days)", () => {
  assert.equal(getLastCalendarDayOfMonth("2026-02-01").getUTCDate(), 28);
  assert.equal(isMonthEndAuditDate("2026-02-28"), true);
  assert.equal(classifyAuditDate("2026-02-28"), "month_end");
});

test("February handles a leap year (29 days)", () => {
  assert.equal(getLastCalendarDayOfMonth("2028-02-01").getUTCDate(), 29);
  assert.equal(isMonthEndAuditDate("2028-02-29"), true);
  assert.equal(isMonthEndAuditDate("2028-02-28"), false);
  assert.equal(classifyAuditDate("2028-02-29"), "month_end");
});

test("a normal date is not an audit date", () => {
  assert.equal(classifyAuditDate("2026-07-20"), null);
  assert.equal(isMidMonthAuditDate("2026-07-20"), false);
  assert.equal(isMonthEndAuditDate("2026-07-20"), false);
});

test("positive, negative and zero stock variance", () => {
  assert.equal(calculateStockVariance(100, 105), 5);
  assert.equal(calculateStockVariance(100, 95), -5);
  assert.equal(calculateStockVariance(100, 100), 0);
});

test("stock variance rejects a negative physical count", () => {
  assert.throws(() => calculateStockVariance(100, -1));
});

test("variance tolerance uses the shared precision constant", () => {
  assert.equal(STOCK_VARIANCE_PRECISION, 0.01);
  assert.equal(isStockVarianceOutsideTolerance(0), false);
  assert.equal(isStockVarianceOutsideTolerance(0.01), false);
  assert.equal(isStockVarianceOutsideTolerance(0.02), true);
  assert.equal(isStockVarianceOutsideTolerance(-5), true);
});

test("audit count validation rejects invalid input", () => {
  assert.throws(() => assertValidStockAuditCounts([]));
  assert.throws(() => assertValidStockAuditCounts([{ auditItemId: "", physicalQuantity: 5 }]));
  assert.throws(() =>
    assertValidStockAuditCounts([{ auditItemId: "item-1", physicalQuantity: -1 }]),
  );
  assert.throws(() =>
    assertValidStockAuditCounts([
      { auditItemId: "item-1", physicalQuantity: 5 },
      { auditItemId: "item-1", physicalQuantity: 6 },
    ]),
  );
  assert.doesNotThrow(() =>
    assertValidStockAuditCounts([
      { auditItemId: "item-1", physicalQuantity: 5 },
      { auditItemId: "item-2", physicalQuantity: 0 },
    ]),
  );
});

test("a partial item-set is rejected as an incomplete submission", () => {
  assert.throws(() =>
    assertCompleteStockAuditSubmission(
      [{ auditItemId: "item-1", physicalQuantity: 5 }],
      ["item-1", "item-2"],
    ),
  );
});

test("an extra/unknown item is rejected", () => {
  assert.throws(() =>
    assertCompleteStockAuditSubmission(
      [
        { auditItemId: "item-1", physicalQuantity: 5 },
        { auditItemId: "item-2", physicalQuantity: 5 },
        { auditItemId: "item-3", physicalQuantity: 5 },
      ],
      ["item-1", "item-2"],
    ),
  );
});

test("a complete item-set covering every expected item is accepted", () => {
  assert.doesNotThrow(() =>
    assertCompleteStockAuditSubmission(
      [
        { auditItemId: "item-1", physicalQuantity: 5 },
        { auditItemId: "item-2", physicalQuantity: 7 },
      ],
      ["item-1", "item-2"],
    ),
  );
});

test("reconciliation rejects an empty, partial or duplicate payload", () => {
  assert.throws(() => assertValidStockAuditReconciliation([], ["item-1"]));
  assert.throws(() =>
    assertValidStockAuditReconciliation(
      [{ auditItemId: "item-1", reconciledQuantity: 5 }],
      ["item-1", "item-2"],
    ),
  );
  assert.throws(() =>
    assertValidStockAuditReconciliation(
      [
        { auditItemId: "item-1", reconciledQuantity: 5 },
        { auditItemId: "item-1", reconciledQuantity: 6 },
      ],
      ["item-1"],
    ),
  );
});

test("reconciliation rejects a negative reconciled quantity", () => {
  assert.throws(() =>
    assertValidStockAuditReconciliation(
      [{ auditItemId: "item-1", reconciledQuantity: -1 }],
      ["item-1"],
    ),
  );
});

test("reconciliation accepts a complete, valid payload", () => {
  assert.doesNotThrow(() =>
    assertValidStockAuditReconciliation(
      [
        { auditItemId: "item-1", reconciledQuantity: 5 },
        { auditItemId: "item-2", reconciledQuantity: 0 },
      ],
      ["item-1", "item-2"],
    ),
  );
});

test("a reconciliation reason is required whenever counts differ beyond precision", () => {
  assert.equal(stockAuditReconciliationNeedsReason(100, 100, 100, 100), false);
  assert.equal(stockAuditReconciliationNeedsReason(100, 100, 95, 100), true);
  assert.equal(stockAuditReconciliationNeedsReason(100, 100, 100, 95), true);
  assert.equal(stockAuditReconciliationNeedsReason(100, 95, 95, 95), true);
});
