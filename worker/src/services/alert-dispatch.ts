import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../config.js";
import type { WhatsAppProvider } from "../providers/whatsapp-provider.js";
import { buildOperationalAlertMessage, buildStockAuditAlertMessage } from "./message-builder.js";
import { operationalAlertRoutingFlowKey, type WhatsAppRoutingFlowKey } from "./whatsapp-routing.js";

// Small, separate alert-dispatch path (Chunk 4, item B; Prompt 3, item D
// adds per-flow routing). Deliberately not mixed into the invoice-reminder
// queue/table: operational alerts are a distinct concept.

export type AlertDispatchSettings = {
  enabled: boolean;
  dry_run: boolean;
};

export type OperationalAlertRow = {
  id: string;
  alert_type: string;
  source_type: string;
  source_id: string;
  severity: string;
  message: string;
  expected_value: number | string | null;
  actual_value: number | string | null;
  variance_value: number | string | null;
  unit: string | null;
  status: string;
  created_at: string;
  whatsapp_notified_at: string | null;
};

export type AlertDispatchRepository = {
  loadSettings(): Promise<AlertDispatchSettings>;
  listUndeliveredOpenAlerts(limit: number): Promise<OperationalAlertRow[]>;
  /** Prompt 3, item D: per-flow recipient, replacing the old single hardcoded recipient. */
  resolveRecipientForFlowKey(flowKey: WhatsAppRoutingFlowKey): Promise<string | null>;
  markNotified(id: string): Promise<void>;
};

export type AlertDispatchRunMode = "dry" | "live";

export type AlertDispatchReport = {
  mode: AlertDispatchRunMode;
  reason: string;
  scanCount: number;
  sentCount: number;
  failedCount: number;
  /** Alerts skipped specifically because their flow had no valid routing number - fails safely, never crashes the run. */
  routingFailedCount: number;
  workerConnected: boolean;
};

export type AlertDispatchWorkflowDeps = {
  repository: AlertDispatchRepository;
  provider: WhatsAppProvider;
  config: Pick<WorkerConfig, "maxSendRetries">;
  mode: AlertDispatchRunMode;
  /** Maximum alerts to send in one run. Kept small and separate from the invoice-reminder daily cap. */
  maxPerRun?: number;
};

function toFiniteNumberOrNull(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Masks a normalized phone number for safe logging - never logs the full number. */
export function maskPhoneForLog(phone: string | null | undefined): string {
  if (!phone) return "(none)";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 3)}******${digits.slice(-3)}`;
}

/** Pure selection of which alerts are eligible to notify: open, not yet notified. Mirrors the DB query's own filter, for tests. */
export function selectAlertsPendingNotification(
  rows: OperationalAlertRow[],
): OperationalAlertRow[] {
  return rows.filter((row) => row.status === "open" && row.whatsapp_notified_at == null);
}

function toMessageInput(row: OperationalAlertRow) {
  return {
    alertType: row.alert_type,
    severity: row.severity,
    message: row.message,
    sourceType: row.source_type,
    sourceId: row.source_id,
    expectedValue: toFiniteNumberOrNull(row.expected_value),
    actualValue: toFiniteNumberOrNull(row.actual_value),
    varianceValue: toFiniteNumberOrNull(row.variance_value),
    unit: row.unit,
    createdAt: row.created_at,
  };
}

function buildMessageForFlow(row: OperationalAlertRow, flowKey: WhatsAppRoutingFlowKey): string {
  const input = toMessageInput(row);
  return flowKey === "stock_audit_alerts"
    ? buildStockAuditAlertMessage(input)
    : buildOperationalAlertMessage(input);
}

async function sendWithRetries(
  provider: WhatsAppProvider,
  to: string,
  body: string,
  idempotencyKey: string,
  maxRetries: number,
): Promise<string> {
  const attempts = Math.max(1, maxRetries);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await provider.sendMessage({ to, body, idempotencyKey });
      if (result.providerMessageId) return result.providerMessageId;
      throw new Error("Provider returned no message id");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown WhatsApp send failure");
}

export async function runAlertDispatchWorkflow({
  repository,
  provider,
  config,
  mode,
  maxPerRun = 20,
}: AlertDispatchWorkflowDeps): Promise<AlertDispatchReport> {
  const report: AlertDispatchReport = {
    mode,
    reason: "completed",
    scanCount: 0,
    sentCount: 0,
    failedCount: 0,
    routingFailedCount: 0,
    workerConnected: provider.getStatus().connected,
  };

  const settings = await repository.loadSettings();
  if (!settings.enabled) return { ...report, reason: "settings_disabled" };

  const alerts = await repository.listUndeliveredOpenAlerts(maxPerRun);
  const eligible = selectAlertsPendingNotification(alerts);
  report.scanCount = eligible.length;

  if (eligible.length === 0) return { ...report, reason: "no_pending_alerts" };

  if (mode === "dry" || settings.dry_run) {
    return { ...report, reason: "dry_run_only" };
  }

  if (!provider.getStatus().connected) {
    return { ...report, reason: "whatsapp_disconnected", workerConnected: false };
  }

  for (const alert of eligible) {
    const flowKey = operationalAlertRoutingFlowKey(alert.alert_type);
    const recipient = await repository.resolveRecipientForFlowKey(flowKey);

    if (!recipient) {
      // Missing/invalid routing number fails safely: never sends, never
      // marks notified, never crashes the run - other alerts still process.
      report.routingFailedCount++;
      continue;
    }

    try {
      const body = buildMessageForFlow(alert, flowKey);
      await sendWithRetries(
        provider,
        recipient,
        body,
        `operational-alert:${alert.id}`,
        config.maxSendRetries,
      );
      await repository.markNotified(alert.id);
      report.sentCount++;
    } catch {
      // Never mark notified on failure - it stays eligible for the next run.
      report.failedCount++;
    }
  }

  return report;
}

export class SupabaseAlertDispatchRepository implements AlertDispatchRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadSettings(): Promise<AlertDispatchSettings> {
    const { data, error } = await this.supabase
      .from("operational_alert_dispatch_settings")
      .select("enabled, dry_run")
      .limit(1)
      .single();
    if (error) throw new Error(`Alert dispatch settings load failed: ${error.message}`);
    return data as AlertDispatchSettings;
  }

  async listUndeliveredOpenAlerts(limit: number): Promise<OperationalAlertRow[]> {
    const { data, error } = await this.supabase
      .from("operational_alerts")
      .select(
        "id, alert_type, source_type, source_id, severity, message, expected_value, actual_value, variance_value, unit, status, created_at, whatsapp_notified_at",
      )
      .eq("status", "open")
      .is("whatsapp_notified_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) throw new Error(`Undelivered alert scan failed: ${error.message}`);
    return (data ?? []) as OperationalAlertRow[];
  }

  async resolveRecipientForFlowKey(flowKey: WhatsAppRoutingFlowKey): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("whatsapp_routing_numbers")
      .select("recipient_phone_normalized")
      .eq("flow_key", flowKey)
      .maybeSingle();
    if (error) throw new Error(`Alert routing number load failed: ${error.message}`);
    return data?.recipient_phone_normalized ?? null;
  }

  async markNotified(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("operational_alerts")
      .update({ whatsapp_notified_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Marking alert notified failed: ${error.message}`);
  }
}

export function logAlertDispatchReport(report: AlertDispatchReport): void {
  console.info("Alert dispatch workflow", {
    reason: report.reason,
    mode: report.mode,
    scanCount: report.scanCount,
    sentCount: report.sentCount,
    failedCount: report.failedCount,
    routingFailedCount: report.routingFailedCount,
    workerConnected: report.workerConnected,
  });
}
