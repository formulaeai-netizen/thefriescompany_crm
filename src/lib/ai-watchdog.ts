import type { AppRole } from "./roles.ts";
import { notificationDedupeKey, type NotificationSeverity } from "./notifications.ts";

export const WATCHDOG_MODULES = [
  "expenses",
  "cash_bank",
  "inventory",
  "credit_supplier",
  "invoice_receivables",
  "payroll",
] as const;

export type WatchdogModule = (typeof WATCHDOG_MODULES)[number];
export type WatchdogSeverity = "low" | "medium" | "high" | "critical";
export type WatchdogStatus = "new" | "reviewed" | "dismissed" | "resolved";

export type WatchdogSettings = {
  enabledModules: Record<WatchdogModule, boolean>;
  minimumHistoryCount: number;
  percentageThreshold: number;
  minimumAbsolutePkrVariance: number;
  cooldownHours: number;
  highSeverityPercentage: number;
  criticalSeverityPercentage: number;
  lowStockSeverityPercentage: number;
  stockVariancePercentage: number;
  stockVarianceAbsolute: number;
  frequencyWindowDays: number;
  minimumFrequencyDelta: number;
  collectionDelayDays: number;
};

export type WatchdogAlertCandidate = {
  module: WatchdogModule;
  anomalyType: string;
  severity: WatchdogSeverity;
  sourceType: string;
  sourceId: string;
  actualValue: number;
  expectedValue: number | null;
  absoluteVariance: number | null;
  percentageVariance: number | null;
  detectionMethod: "deterministic" | "statistical";
  deterministicReason: string;
  recommendation: string;
  dedupeKey: string;
  metadata?: Record<string, unknown>;
};

export type WatchdogScreeningResult =
  { alert: WatchdogAlertCandidate; skippedReason?: never } | { alert: null; skippedReason: string };

export type ExpenseLike = {
  id: string;
  item: string;
  price: number;
  date: string;
  category?: string | null;
  subcategory?: string | null;
};

export type LedgerLike = {
  id: string;
  entry_type: string;
  direction: "credit" | "debit";
  amount: number;
  account_id?: string | null;
  account_transfer_id?: string | null;
  created_at: string;
};

export type InventoryLike = {
  id: string;
  item_name: string;
  current_stock: number;
  minimum_stock: number;
  unit?: string | null;
};

export type StockAuditItemLike = {
  id: string;
  item_name_snapshot: string;
  unit_snapshot?: string | null;
  system_quantity_snapshot: number;
  reconciled_quantity: number | null;
  variance_quantity: number | null;
};

export type CreditPurchaseLike = {
  id: string;
  supplier_name: string;
  item_name_snapshot: string;
  amount_due: number;
  quantity?: number | null;
  unit?: string | null;
  due_at?: string | null;
  purchased_at: string;
  status: string;
};

export type InvoiceLike = {
  id: string;
  client_id: string | null;
  invoice_no?: string | null;
  amount: number;
  amount_received?: number | null;
  payment_status: string | null;
  date?: string | null;
  delivery_date?: string | null;
  due_date?: string | null;
  paid_at?: string | null;
};

export type PayrollLike = {
  id: string;
  employee_ref_id?: string | null;
  employee_id?: string | null;
  employee_name: string;
  month: string;
  overtime_hours: number;
  overtime_amount: number;
  bonus: number;
  allowances: number;
  other_deduction: number;
  total_deductions: number;
  status: string;
};

export const DEFAULT_WATCHDOG_SETTINGS: WatchdogSettings = {
  enabledModules: {
    expenses: true,
    cash_bank: true,
    inventory: true,
    credit_supplier: true,
    invoice_receivables: true,
    payroll: true,
  },
  minimumHistoryCount: 3,
  percentageThreshold: 35,
  minimumAbsolutePkrVariance: 500,
  cooldownHours: 24,
  highSeverityPercentage: 50,
  criticalSeverityPercentage: 100,
  lowStockSeverityPercentage: 25,
  stockVariancePercentage: 15,
  stockVarianceAbsolute: 2,
  frequencyWindowDays: 14,
  minimumFrequencyDelta: 2,
  collectionDelayDays: 7,
};

const severityRank: Record<WatchdogSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function notificationSeverityForWatchdog(severity: WatchdogSeverity): NotificationSeverity {
  if (severity === "critical") return "Critical";
  if (severity === "high") return "High";
  if (severity === "medium") return "Medium";
  return "Low";
}

export function canRoleSeeWatchdogModule(role: AppRole, module: WatchdogModule): boolean {
  if (role === "admin") return true;
  if (role === "moderator") return module === "inventory";
  if (role === "staff") return module === "inventory";
  return false;
}

export function shouldCreateCanonicalNotification(severity: WatchdogSeverity): boolean {
  return severityRank[severity] >= severityRank.high;
}

export function normalizeWatchdogText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentageVariance(actual: number, expected: number): number | null {
  if (!Number.isFinite(expected) || expected === 0) return null;
  return ((actual - expected) / Math.abs(expected)) * 100;
}

export function severityFromVariance(
  percentage: number | null,
  settings: WatchdogSettings,
): WatchdogSeverity {
  const absPct = Math.abs(percentage ?? 0);
  if (absPct >= settings.criticalSeverityPercentage) return "critical";
  if (absPct >= settings.highSeverityPercentage) return "high";
  if (absPct >= settings.percentageThreshold) return "medium";
  return "low";
}

function dateKey(value: string | null | undefined): string {
  return String(value ?? "").slice(0, 10);
}

function daysBetween(start: string | null | undefined, end: string | null | undefined): number {
  if (!start || !end) return 0;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000));
}

function pkr(value: number): string {
  return `Rs. ${Math.round(value).toLocaleString("en-PK")}`;
}

function statisticalPkrAlert(params: {
  module: WatchdogModule;
  anomalyType: string;
  sourceType: string;
  sourceId: string;
  actualValue: number;
  historyValues: number[];
  label: string;
  settings: WatchdogSettings;
  dedupeParts: Array<string | number | null | undefined>;
  metadata?: Record<string, unknown>;
}): WatchdogScreeningResult {
  if (params.historyValues.length < params.settings.minimumHistoryCount) {
    return { alert: null, skippedReason: "insufficient-baseline" };
  }
  const expected = mean(params.historyValues);
  const absolute = params.actualValue - expected;
  const pct = percentageVariance(params.actualValue, expected);
  if (Math.abs(absolute) < params.settings.minimumAbsolutePkrVariance) {
    return { alert: null, skippedReason: "below-absolute-threshold" };
  }
  if (Math.abs(pct ?? 0) < params.settings.percentageThreshold) {
    return { alert: null, skippedReason: "below-percentage-threshold" };
  }

  const severity = severityFromVariance(pct, params.settings);
  const direction = absolute >= 0 ? "above" : "below";
  return {
    alert: {
      module: params.module,
      anomalyType: params.anomalyType,
      severity,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      actualValue: params.actualValue,
      expectedValue: Number(expected.toFixed(2)),
      absoluteVariance: Number(absolute.toFixed(2)),
      percentageVariance: pct == null ? null : Number(pct.toFixed(2)),
      detectionMethod: "statistical",
      deterministicReason: `${params.label} is ${pkr(Math.abs(absolute))} ${direction} recent baseline.`,
      recommendation: `Verify rate, quantity, supplier note and approval context before treating this as the new baseline.`,
      dedupeKey: notificationDedupeKey(params.dedupeParts),
      metadata: {
        sample_count: params.historyValues.length,
        ...params.metadata,
      },
    },
  };
}

export function evaluateExpenseAmountAnomaly(
  current: ExpenseLike,
  history: ExpenseLike[],
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.expenses) return { alert: null, skippedReason: "module-disabled" };
  const itemKey = normalizeWatchdogText(current.item);
  const comparable = history
    .filter((row) => row.id !== current.id && normalizeWatchdogText(row.item) === itemKey)
    .map((row) => Number(row.price))
    .filter((value) => Number.isFinite(value) && value > 0);

  return statisticalPkrAlert({
    module: "expenses",
    anomalyType: "expense_amount_spike",
    sourceType: "expense",
    sourceId: current.id,
    actualValue: Number(current.price),
    historyValues: comparable,
    label: `Expense "${current.item}"`,
    settings,
    dedupeParts: ["ai-watchdog", "expense", "amount", current.id],
    metadata: {
      item: current.item,
      category: current.category ?? null,
      subcategory: current.subcategory ?? null,
    },
  });
}

export function evaluateExpenseFrequencyAnomaly(
  current: ExpenseLike,
  history: ExpenseLike[],
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.expenses) return { alert: null, skippedReason: "module-disabled" };
  const itemKey = normalizeWatchdogText(current.item);
  const currentDay = dateKey(current.date);
  const currentDayCount = history.filter(
    (row) => normalizeWatchdogText(row.item) === itemKey && dateKey(row.date) === currentDay,
  ).length;
  const counts = new Map<string, number>();
  for (const row of history) {
    if (row.id === current.id || normalizeWatchdogText(row.item) !== itemKey) continue;
    const key = dateKey(row.date);
    if (!key || key === currentDay) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()];
  if (values.length < settings.minimumHistoryCount) {
    return { alert: null, skippedReason: "insufficient-baseline" };
  }
  const expected = mean(values);
  const diff = currentDayCount - expected;
  const pct = percentageVariance(currentDayCount, expected);
  if (diff < settings.minimumFrequencyDelta || (pct ?? 0) < settings.percentageThreshold) {
    return { alert: null, skippedReason: "below-frequency-threshold" };
  }
  return {
    alert: {
      module: "expenses",
      anomalyType: "expense_frequency_spike",
      severity: severityFromVariance(pct, settings),
      sourceType: "expense",
      sourceId: current.id,
      actualValue: currentDayCount,
      expectedValue: Number(expected.toFixed(2)),
      absoluteVariance: Number(diff.toFixed(2)),
      percentageVariance: pct == null ? null : Number(pct.toFixed(2)),
      detectionMethod: "statistical",
      deterministicReason: `${current.item} appeared ${currentDayCount} times on ${currentDay}, above its normal daily frequency.`,
      recommendation:
        "Check whether this is a duplicate entry, batch purchase, or real operational change.",
      dedupeKey: notificationDedupeKey([
        "ai-watchdog",
        "expense",
        "frequency",
        itemKey,
        currentDay,
      ]),
      metadata: { item: current.item, current_day: currentDay, sample_count: values.length },
    },
  };
}

export function evaluateLargeCashDebit(
  current: LedgerLike,
  history: LedgerLike[],
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.cash_bank) return { alert: null, skippedReason: "module-disabled" };
  if (current.direction !== "debit") return { alert: null, skippedReason: "not-debit" };
  if (current.entry_type === "account_transfer")
    return { alert: null, skippedReason: "account-transfer-excluded" };
  const comparable = history
    .filter(
      (row) =>
        row.id !== current.id &&
        row.direction === "debit" &&
        row.entry_type !== "account_transfer" &&
        (!current.account_id || row.account_id === current.account_id),
    )
    .map((row) => Number(row.amount))
    .filter((value) => Number.isFinite(value) && value > 0);
  return statisticalPkrAlert({
    module: "cash_bank",
    anomalyType: "large_liquid_funds_debit",
    sourceType: "cash_ledger_entry",
    sourceId: current.id,
    actualValue: Number(current.amount),
    historyValues: comparable,
    label: "Cash/Bank debit",
    settings,
    dedupeParts: ["ai-watchdog", "cash-bank", "large-debit", current.id],
    metadata: { entry_type: current.entry_type, account_id: current.account_id ?? null },
  });
}

export function evaluateAbnormalOutflow(
  currentDate: string,
  ledger: LedgerLike[],
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.cash_bank) return { alert: null, skippedReason: "module-disabled" };
  const day = dateKey(currentDate);
  const daily = new Map<string, number>();
  for (const row of ledger) {
    if (row.direction !== "debit" || row.entry_type === "account_transfer") continue;
    const key = dateKey(row.created_at);
    if (!key) continue;
    daily.set(key, (daily.get(key) ?? 0) + Number(row.amount));
  }
  const actual = daily.get(day) ?? 0;
  const historyValues = [...daily.entries()]
    .filter(([key]) => key !== day)
    .map(([, value]) => value)
    .filter((value) => value > 0);
  return statisticalPkrAlert({
    module: "cash_bank",
    anomalyType: "abnormal_daily_outflow",
    sourceType: "cash_ledger_entry",
    sourceId: `00000000-0000-0000-0000-${day.replaceAll("-", "").padStart(12, "0").slice(0, 12)}`,
    actualValue: actual,
    historyValues,
    label: "Daily cash/bank outflow",
    settings,
    dedupeParts: ["ai-watchdog", "cash-bank", "daily-outflow", day],
    metadata: { date: day },
  });
}

export function evaluateLowStock(
  item: InventoryLike,
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.inventory) return { alert: null, skippedReason: "module-disabled" };
  const current = Number(item.current_stock);
  const minimum = Number(item.minimum_stock);
  if (!Number.isFinite(minimum) || minimum <= 0)
    return { alert: null, skippedReason: "no-threshold" };
  if (current > minimum) return { alert: null, skippedReason: "above-minimum-stock" };
  const pct = percentageVariance(current, minimum);
  const severity =
    current <= 0
      ? "critical"
      : current <= minimum * (settings.lowStockSeverityPercentage / 100)
        ? "high"
        : "medium";
  return {
    alert: {
      module: "inventory",
      anomalyType: "low_stock",
      severity,
      sourceType: "inventory",
      sourceId: item.id,
      actualValue: current,
      expectedValue: minimum,
      absoluteVariance: Number((current - minimum).toFixed(2)),
      percentageVariance: pct == null ? null : Number(pct.toFixed(2)),
      detectionMethod: "deterministic",
      deterministicReason: `${item.item_name} stock is at or below its configured minimum.`,
      recommendation: "Review current demand and reorder before production is blocked.",
      dedupeKey: notificationDedupeKey(["ai-watchdog", "inventory", "low-stock", item.id]),
      metadata: { item_name: item.item_name, unit: item.unit ?? null },
    },
  };
}

export function evaluateStockVariance(
  item: StockAuditItemLike,
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.inventory) return { alert: null, skippedReason: "module-disabled" };
  const variance = Number(item.variance_quantity ?? 0);
  const system = Number(item.system_quantity_snapshot ?? 0);
  const reconciled = Number(item.reconciled_quantity ?? 0);
  const pct = percentageVariance(reconciled, system);
  if (
    Math.abs(variance) < settings.stockVarianceAbsolute ||
    Math.abs(pct ?? 0) < settings.stockVariancePercentage
  ) {
    return { alert: null, skippedReason: "below-stock-variance-threshold" };
  }
  return {
    alert: {
      module: "inventory",
      anomalyType: "stock_variance_spike",
      severity: severityFromVariance(pct, settings),
      sourceType: "stock_audit_item",
      sourceId: item.id,
      actualValue: reconciled,
      expectedValue: system,
      absoluteVariance: Number(variance.toFixed(2)),
      percentageVariance: pct == null ? null : Number(pct.toFixed(2)),
      detectionMethod: "deterministic",
      deterministicReason: `${item.item_name_snapshot} physical/reconciled count materially differs from system stock.`,
      recommendation:
        "Verify physical count, wastage, delivery and purchase movements before adjustment.",
      dedupeKey: notificationDedupeKey(["ai-watchdog", "inventory", "stock-variance", item.id]),
      metadata: { item_name: item.item_name_snapshot, unit: item.unit_snapshot ?? null },
    },
  };
}

function creditUnitPrice(row: CreditPurchaseLike): number {
  const qty = Number(row.quantity ?? 0);
  return qty > 0 ? Number(row.amount_due) / qty : Number(row.amount_due);
}

export function evaluateSupplierPriceIncrease(
  current: CreditPurchaseLike,
  history: CreditPurchaseLike[],
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.credit_supplier)
    return { alert: null, skippedReason: "module-disabled" };
  const supplier = normalizeWatchdogText(current.supplier_name);
  const item = normalizeWatchdogText(current.item_name_snapshot);
  const comparable = history
    .filter(
      (row) =>
        row.id !== current.id &&
        normalizeWatchdogText(row.supplier_name) === supplier &&
        normalizeWatchdogText(row.item_name_snapshot) === item,
    )
    .map(creditUnitPrice)
    .filter((value) => Number.isFinite(value) && value > 0);
  return statisticalPkrAlert({
    module: "credit_supplier",
    anomalyType: "supplier_price_increase",
    sourceType: "credit_inventory_purchase",
    sourceId: current.id,
    actualValue: creditUnitPrice(current),
    historyValues: comparable,
    label: `${current.supplier_name} / ${current.item_name_snapshot} unit price`,
    settings,
    dedupeParts: ["ai-watchdog", "credit-supplier", "price", current.id],
    metadata: { supplier_name: current.supplier_name, item_name: current.item_name_snapshot },
  });
}

export function evaluateLargeCreditPurchase(
  current: CreditPurchaseLike,
  history: CreditPurchaseLike[],
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.credit_supplier)
    return { alert: null, skippedReason: "module-disabled" };
  const comparable = history
    .filter((row) => row.id !== current.id)
    .map((row) => Number(row.amount_due))
    .filter((value) => Number.isFinite(value) && value > 0);
  return statisticalPkrAlert({
    module: "credit_supplier",
    anomalyType: "large_credit_purchase",
    sourceType: "credit_inventory_purchase",
    sourceId: current.id,
    actualValue: Number(current.amount_due),
    historyValues: comparable,
    label: "Credit purchase amount",
    settings,
    dedupeParts: ["ai-watchdog", "credit-supplier", "large-purchase", current.id],
    metadata: { supplier_name: current.supplier_name, item_name: current.item_name_snapshot },
  });
}

export function evaluateSlowCustomerCollection(
  current: InvoiceLike,
  history: InvoiceLike[],
  now: Date = new Date(),
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.invoice_receivables)
    return { alert: null, skippedReason: "module-disabled" };
  if (!current.client_id) return { alert: null, skippedReason: "missing-client" };
  if (current.payment_status === "Done") return { alert: null, skippedReason: "already-paid" };
  const currentStart = current.delivery_date ?? current.date ?? current.due_date;
  const currentAge = daysBetween(currentStart, now.toISOString());
  const samples = history
    .filter(
      (row) =>
        row.id !== current.id &&
        row.client_id === current.client_id &&
        row.payment_status === "Done" &&
        !!row.paid_at,
    )
    .map((row) => daysBetween(row.delivery_date ?? row.date ?? row.due_date, row.paid_at))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (samples.length < settings.minimumHistoryCount) {
    return { alert: null, skippedReason: "insufficient-baseline" };
  }
  const expected = mean(samples);
  const absolute = currentAge - expected;
  const pct = percentageVariance(currentAge, expected);
  if (
    absolute < settings.collectionDelayDays ||
    Math.abs(pct ?? 0) < settings.percentageThreshold
  ) {
    return { alert: null, skippedReason: "below-collection-delay-threshold" };
  }
  return {
    alert: {
      module: "invoice_receivables",
      anomalyType: "slower_customer_collection",
      severity: severityFromVariance(pct, settings),
      sourceType: "invoice",
      sourceId: current.id,
      actualValue: currentAge,
      expectedValue: Number(expected.toFixed(2)),
      absoluteVariance: Number(absolute.toFixed(2)),
      percentageVariance: pct == null ? null : Number(pct.toFixed(2)),
      detectionMethod: "statistical",
      deterministicReason: `Invoice ${current.invoice_no ?? current.id} is aging slower than this client's verified paid-invoice baseline.`,
      recommendation:
        "Follow up with the customer and ignore pending/rejected payment proofs until Admin approval completes.",
      dedupeKey: notificationDedupeKey([
        "ai-watchdog",
        "receivables",
        "slow-collection",
        current.id,
      ]),
      metadata: { invoice_no: current.invoice_no ?? null, client_id: current.client_id },
    },
  };
}

export function evaluatePayrollOutlier(
  current: PayrollLike,
  history: PayrollLike[],
  metric: "overtime_hours" | "overtime_amount" | "bonus" | "allowances" | "other_deduction",
  settings: WatchdogSettings = DEFAULT_WATCHDOG_SETTINGS,
): WatchdogScreeningResult {
  if (!settings.enabledModules.payroll) return { alert: null, skippedReason: "module-disabled" };
  const employeeKey =
    current.employee_ref_id ?? current.employee_id ?? normalizeWatchdogText(current.employee_name);
  const comparable = history
    .filter((row) => {
      const key =
        row.employee_ref_id ?? row.employee_id ?? normalizeWatchdogText(row.employee_name);
      return row.id !== current.id && key === employeeKey;
    })
    .map((row) => Number(row[metric]))
    .filter((value) => Number.isFinite(value) && value > 0);
  return statisticalPkrAlert({
    module: "payroll",
    anomalyType: `payroll_${metric}_spike`,
    sourceType: "employee_salary",
    sourceId: current.id,
    actualValue: Number(current[metric]),
    historyValues: comparable,
    label: `${current.employee_name} ${metric.replaceAll("_", " ")}`,
    settings,
    dedupeParts: ["ai-watchdog", "payroll", metric, current.id],
    metadata: { employee_name: current.employee_name, metric },
  });
}

export function dedupeCandidates(candidates: WatchdogAlertCandidate[]): WatchdogAlertCandidate[] {
  const seen = new Set<string>();
  const result: WatchdogAlertCandidate[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.dedupeKey)) continue;
    seen.add(candidate.dedupeKey);
    result.push(candidate);
  }
  return result;
}
