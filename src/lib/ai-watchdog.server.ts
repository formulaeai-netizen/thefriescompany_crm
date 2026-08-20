import OpenAI from "openai";
import { z } from "zod";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  DEFAULT_WATCHDOG_SETTINGS,
  WATCHDOG_MODULES,
  dedupeCandidates,
  evaluateAbnormalOutflow,
  evaluateExpenseAmountAnomaly,
  evaluateExpenseFrequencyAnomaly,
  evaluateLargeCashDebit,
  evaluateLargeCreditPurchase,
  evaluateLowStock,
  evaluatePayrollOutlier,
  evaluateSlowCustomerCollection,
  evaluateStockVariance,
  evaluateSupplierPriceIncrease,
  type ExpenseLike,
  type LedgerLike,
  type WatchdogAlertCandidate,
  type WatchdogModule,
  type WatchdogSettings,
} from "@/lib/ai-watchdog";

type ScanResult = {
  scannedModules: WatchdogModule[];
  candidateCount: number;
  insertedCount: number;
  duplicateCount: number;
  aiAttemptedCount: number;
  aiFailedCount: number;
};

const aiExplanationSchema = z.object({
  explanation: z.string().trim().min(1).max(700),
  recommendation: z.string().trim().min(1).max(700),
});

function aiEnabled() {
  return process.env.AI_WATCHDOG_AI_ENABLED === "true";
}

async function explainAlertWithAi(candidate: WatchdogAlertCandidate): Promise<{
  explanation: string | null;
  recommendation: string | null;
  attempted: boolean;
  failed: boolean;
}> {
  if (!aiEnabled()) {
    return { explanation: null, recommendation: null, attempted: false, failed: false };
  }
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.AI_WATCHDOG_OPENAI_MODEL || process.env.OPENAI_TEXT_MODEL;
  if (!apiKey || !model) {
    return { explanation: null, recommendation: null, attempted: false, failed: false };
  }

  try {
    const client = new OpenAI({ apiKey, maxRetries: 0 });
    const response = await client.responses.create({
      model,
      store: false,
      input: [
        {
          role: "system",
          content:
            "You explain CRM anomaly alerts. You are advisory only. Never suggest changing records automatically.",
        },
        {
          role: "user",
          content: JSON.stringify({
            module: candidate.module,
            anomaly_type: candidate.anomalyType,
            severity: candidate.severity,
            actual_value: candidate.actualValue,
            expected_value: candidate.expectedValue,
            absolute_variance: candidate.absoluteVariance,
            percentage_variance: candidate.percentageVariance,
            deterministic_reason: candidate.deterministicReason,
            metadata: candidate.metadata ?? {},
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ai_watchdog_explanation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              explanation: { type: "string" },
              recommendation: { type: "string" },
            },
            required: ["explanation", "recommendation"],
          },
        },
      },
    });
    const parsed = aiExplanationSchema.parse(JSON.parse(response.output_text ?? "{}"));
    return {
      explanation: parsed.explanation,
      recommendation: parsed.recommendation,
      attempted: true,
      failed: false,
    };
  } catch {
    return { explanation: null, recommendation: null, attempted: true, failed: true };
  }
}

function mergeSettings(rows: Array<Record<string, any>>): WatchdogSettings {
  const settings = {
    ...DEFAULT_WATCHDOG_SETTINGS,
    enabledModules: { ...DEFAULT_WATCHDOG_SETTINGS.enabledModules },
  };
  for (const row of rows) {
    const module = row.module as WatchdogModule;
    if (!WATCHDOG_MODULES.includes(module)) continue;
    settings.enabledModules[module] = row.enabled !== false;
    settings.minimumHistoryCount = Math.max(
      settings.minimumHistoryCount,
      Number(row.minimum_history_count ?? settings.minimumHistoryCount),
    );
    settings.percentageThreshold = Number(row.percentage_threshold ?? settings.percentageThreshold);
    settings.minimumAbsolutePkrVariance = Number(
      row.minimum_absolute_pkr_variance ?? settings.minimumAbsolutePkrVariance,
    );
    settings.cooldownHours = Number(row.cooldown_hours ?? settings.cooldownHours);
    settings.highSeverityPercentage = Number(
      row.high_severity_percentage ?? settings.highSeverityPercentage,
    );
    settings.criticalSeverityPercentage = Number(
      row.critical_severity_percentage ?? settings.criticalSeverityPercentage,
    );
  }
  return settings;
}

async function loadWatchdogSettings(): Promise<WatchdogSettings> {
  const { data, error } = await (supabaseAdmin as any).from("ai_watchdog_settings").select("*");
  if (error) throw new Error(`AI watchdog settings load failed: ${error.message}`);
  return mergeSettings(data ?? []);
}

async function getRows(table: string, select: string, limit = 500) {
  const { data, error } = await (supabaseAdmin as any)
    .from(table)
    .select(select)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`${table} load failed: ${error.message}`);
  return data ?? [];
}

async function collectExpenseCandidates(settings: WatchdogSettings) {
  const rows = (await getRows(
    "expenses",
    "id, item, price, date, category, subcategory, created_at",
    800,
  )) as ExpenseLike[];
  const candidates: WatchdogAlertCandidate[] = [];
  for (const row of rows.slice(0, 100)) {
    const amount = evaluateExpenseAmountAnomaly(row, rows, settings);
    if (amount.alert) candidates.push(amount.alert);
    const frequency = evaluateExpenseFrequencyAnomaly(row, rows, settings);
    if (frequency.alert) candidates.push(frequency.alert);
  }
  return candidates;
}

async function collectCashBankCandidates(settings: WatchdogSettings) {
  const rows = (await getRows(
    "cash_ledger_entries",
    "id, entry_type, direction, amount, account_id, account_transfer_id, created_at",
    800,
  )) as LedgerLike[];
  const candidates: WatchdogAlertCandidate[] = [];
  for (const row of rows.slice(0, 100)) {
    const debit = evaluateLargeCashDebit(row, rows, settings);
    if (debit.alert) candidates.push(debit.alert);
  }
  const today = new Date().toISOString();
  const outflow = evaluateAbnormalOutflow(today, rows, settings);
  if (outflow.alert) candidates.push(outflow.alert);
  return candidates;
}

async function collectInventoryCandidates(settings: WatchdogSettings) {
  const inventory = await getRows(
    "inventory",
    "id, item_name, current_stock, minimum_stock, unit, created_at",
    500,
  );
  const auditItems = await getRows(
    "stock_audit_items",
    "id, item_name_snapshot, unit_snapshot, system_quantity_snapshot, reconciled_quantity, variance_quantity, created_at",
    500,
  );
  const candidates: WatchdogAlertCandidate[] = [];
  for (const row of inventory) {
    const result = evaluateLowStock(row, settings);
    if (result.alert) candidates.push(result.alert);
  }
  for (const row of auditItems) {
    const result = evaluateStockVariance(row, settings);
    if (result.alert) candidates.push(result.alert);
  }
  return candidates;
}

async function collectCreditSupplierCandidates(settings: WatchdogSettings) {
  const rows = await getRows(
    "credit_inventory_purchases",
    "id, supplier_name, item_name_snapshot, amount_due, quantity, unit, due_at, purchased_at, status, created_at",
    500,
  );
  const candidates: WatchdogAlertCandidate[] = [];
  for (const row of rows.slice(0, 100)) {
    const price = evaluateSupplierPriceIncrease(row, rows, settings);
    if (price.alert) candidates.push(price.alert);
    const large = evaluateLargeCreditPurchase(row, rows, settings);
    if (large.alert) candidates.push(large.alert);
  }
  return candidates;
}

async function collectReceivablesCandidates(settings: WatchdogSettings) {
  const rows = await getRows(
    "invoices",
    "id, client_id, invoice_no, amount, amount_received, payment_status, date, delivery_date, due_date, paid_at, created_at",
    800,
  );
  const candidates: WatchdogAlertCandidate[] = [];
  const now = new Date();
  for (const row of rows.slice(0, 150)) {
    const result = evaluateSlowCustomerCollection(row, rows, now, settings);
    if (result.alert) candidates.push(result.alert);
  }
  return candidates;
}

async function collectPayrollCandidates(settings: WatchdogSettings) {
  const rows = await getRows(
    "employee_salaries",
    "id, employee_ref_id, employee_id, employee_name, month, overtime_hours, overtime_amount, bonus, allowances, other_deduction, total_deductions, status, created_at",
    500,
  );
  const candidates: WatchdogAlertCandidate[] = [];
  for (const row of rows.slice(0, 100)) {
    for (const metric of [
      "overtime_hours",
      "overtime_amount",
      "bonus",
      "allowances",
      "other_deduction",
    ] as const) {
      const result = evaluatePayrollOutlier(row, rows, metric, settings);
      if (result.alert) candidates.push(result.alert);
    }
  }
  return candidates;
}

async function collectCandidates(module: WatchdogModule, settings: WatchdogSettings) {
  if (!settings.enabledModules[module]) return [];
  if (module === "expenses") return collectExpenseCandidates(settings);
  if (module === "cash_bank") return collectCashBankCandidates(settings);
  if (module === "inventory") return collectInventoryCandidates(settings);
  if (module === "credit_supplier") return collectCreditSupplierCandidates(settings);
  if (module === "invoice_receivables") return collectReceivablesCandidates(settings);
  return collectPayrollCandidates(settings);
}

async function persistCandidate(candidate: WatchdogAlertCandidate) {
  const ai = await explainAlertWithAi(candidate);
  const { data, error } = await (supabaseAdmin as any)
    .from("ai_watchdog_alerts")
    .upsert(
      {
        module: candidate.module,
        anomaly_type: candidate.anomalyType,
        severity: candidate.severity,
        source_type: candidate.sourceType,
        source_id: candidate.sourceId,
        actual_value: candidate.actualValue,
        expected_value: candidate.expectedValue,
        absolute_variance: candidate.absoluteVariance,
        percentage_variance: candidate.percentageVariance,
        detection_method: candidate.detectionMethod,
        deterministic_reason: candidate.deterministicReason,
        ai_explanation: ai.explanation,
        recommendation: ai.recommendation ?? candidate.recommendation,
        dedupe_key: candidate.dedupeKey,
        metadata: {
          ...(candidate.metadata ?? {}),
          ai_attempted: ai.attempted,
          ai_failed: ai.failed,
        },
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(`AI watchdog alert persist failed: ${error.message}`);
  return { inserted: (data ?? []).length > 0, aiAttempted: ai.attempted, aiFailed: ai.failed };
}

export async function scanAiWatchdog(
  params: {
    module?: WatchdogModule | "all";
  } = {},
): Promise<ScanResult> {
  const settings = await loadWatchdogSettings();
  const modules =
    !params.module || params.module === "all"
      ? [...WATCHDOG_MODULES]
      : ([params.module] as WatchdogModule[]);
  const scannedModules = modules.filter((module) => settings.enabledModules[module]);
  const candidates = dedupeCandidates(
    (await Promise.all(scannedModules.map((module) => collectCandidates(module, settings)))).flat(),
  );

  let insertedCount = 0;
  let aiAttemptedCount = 0;
  let aiFailedCount = 0;
  for (const candidate of candidates) {
    const result = await persistCandidate(candidate);
    if (result.inserted) insertedCount += 1;
    if (result.aiAttempted) aiAttemptedCount += 1;
    if (result.aiFailed) aiFailedCount += 1;
  }

  return {
    scannedModules,
    candidateCount: candidates.length,
    insertedCount,
    duplicateCount: candidates.length - insertedCount,
    aiAttemptedCount,
    aiFailedCount,
  };
}
