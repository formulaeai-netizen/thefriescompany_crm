import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../config.js";
import type { WhatsAppProvider } from "../providers/whatsapp-provider.js";
import { buildOverdueInvoiceMessage } from "./message-builder.js";

export type ReminderStage = "overdue_day_1" | "overdue_day_3" | "overdue_day_7" | "overdue_day_14";
export type ReminderStatus =
  "pending" | "approved" | "processing" | "sent" | "failed" | "skipped" | "cancelled";

export type InvoiceReminderSettings = {
  enabled: boolean;
  dry_run: boolean;
  manual_approval_required: boolean;
  pause_all: boolean;
  provider: string;
  automation_launch_date: string | null;
  timezone: string;
  first_reminder_after_days: number;
  repeat_interval_days: number;
  maximum_reminders: number;
  maximum_daily_messages: number;
};

export type ReminderInvoice = {
  id: string;
  invoice_no: string | null;
  client_id: string | null;
  date: string | null;
  delivery_date: string | null;
  due_date: string | null;
  amount: number | string | null;
  amount_received: number | string | null;
  payment_status: string | null;
  is_deleted: boolean | null;
  clients?: {
    id: string | null;
    legal_name: string | null;
    phone: string | null;
    phone_normalized: string | null;
    whatsapp_opt_out: boolean | null;
    reminders_paused: boolean | null;
  } | null;
};

export type ExistingReminder = {
  id?: string;
  invoice_id: string | null;
  reminder_stage: string | null;
  idempotency_key: string | null;
  status: ReminderStatus | string | null;
};

export type ReminderInsert = {
  invoice_id: string;
  client_id: string | null;
  due_date_snapshot: string;
  outstanding_amount_snapshot: number;
  recipient_phone: string | null;
  normalized_recipient_phone: string;
  provider: "whatsapp-web";
  channel: "whatsapp";
  reminder_stage: ReminderStage;
  status: "pending" | "approved";
  idempotency_key: string;
  scheduled_for: string;
};

export type SendableReminder = Omit<ReminderInsert, "status"> & {
  id: string;
  status: ReminderStatus;
  invoices: Pick<
    ReminderInvoice,
    "id" | "invoice_no" | "amount" | "amount_received" | "payment_status" | "due_date"
  > | null;
  clients: {
    id: string | null;
    legal_name: string | null;
    whatsapp_opt_out: boolean | null;
    reminders_paused: boolean | null;
  } | null;
};

export type ReminderRunMode = "dry" | "live";

export type ReminderRunReport = {
  mode: ReminderRunMode;
  reason: string;
  scanCount: number;
  eligibleCount: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  duplicateCount: number;
  workerConnected: boolean;
};

export type ReminderRepository = {
  loadSettings(): Promise<InvoiceReminderSettings>;
  listInvoices(): Promise<ReminderInvoice[]>;
  listExistingReminders(invoiceIds: string[]): Promise<ExistingReminder[]>;
  insertReminder(row: ReminderInsert): Promise<"inserted" | "duplicate">;
  listSendableReminders(limit: number, includePending: boolean): Promise<SendableReminder[]>;
  markApproved(id: string): Promise<void>;
  markProcessing(id: string): Promise<void>;
  markSent(id: string, providerMessageId: string): Promise<void>;
  markFailed(id: string, code: string, message: string): Promise<void>;
  markSkipped(id: string, code: string, message: string): Promise<void>;
};

export type ReminderWorkflowDeps = {
  repository: ReminderRepository;
  provider: WhatsAppProvider;
  config: Pick<WorkerConfig, "messageDelayMs" | "maxSendRetries">;
  mode: ReminderRunMode;
  now?: Date;
};

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function toFiniteNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateOutstandingAmount(
  invoice: Pick<ReminderInvoice, "amount" | "amount_received" | "payment_status">,
): number {
  if (invoice.payment_status === "Done") return 0;
  return Math.max(toFiniteNumber(invoice.amount) - toFiniteNumber(invoice.amount_received), 0);
}

export function normalizePakistanWhatsappPhone(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;
  let digits = rawPhone.trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `92${digits.slice(1)}`;
  return /^923\d{9}$/.test(digits) ? digits : null;
}

export function selectReminderStage(daysOverdue: number): ReminderStage | null {
  if (daysOverdue < 1) return null;
  if (daysOverdue < 3) return "overdue_day_1";
  if (daysOverdue < 7) return "overdue_day_3";
  if (daysOverdue < 14) return "overdue_day_7";
  return "overdue_day_14";
}

export function createReminderIdempotencyKey(invoiceId: string, stage: ReminderStage): string {
  return `invoice:${invoiceId}:stage:${stage}`;
}

function daysBetween(today: string, dueDate: string): number {
  return Math.floor(
    (Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${dueDate}T00:00:00.000Z`)) / 86400000,
  );
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildEligibleReminderRows(
  invoices: ReminderInvoice[],
  existingReminders: ExistingReminder[],
  settings: InvoiceReminderSettings,
  now: Date,
): { rows: ReminderInsert[]; scanCount: number; skippedCount: number } {
  const today = isoDate(now);
  const existingKeys = new Set(existingReminders.map((row) => row.idempotency_key).filter(Boolean));
  const remindersByInvoice = new Map<string, ExistingReminder[]>();

  for (const reminder of existingReminders) {
    if (!reminder.invoice_id) continue;
    const rows = remindersByInvoice.get(reminder.invoice_id) ?? [];
    rows.push(reminder);
    remindersByInvoice.set(reminder.invoice_id, rows);
  }

  const rows: ReminderInsert[] = [];
  let skippedCount = 0;

  for (const invoice of invoices) {
    if (invoice.is_deleted) {
      skippedCount++;
      continue;
    }

    const dueDate = toIsoDate(invoice.due_date);
    if (!dueDate) {
      skippedCount++;
      continue;
    }

    const daysOverdue = daysBetween(today, dueDate);
    const stage = selectReminderStage(daysOverdue);
    if (!stage) {
      skippedCount++;
      continue;
    }

    const outstanding = calculateOutstandingAmount(invoice);
    if (outstanding <= 0) {
      skippedCount++;
      continue;
    }

    const client = invoice.clients;
    if (!client?.id || client.whatsapp_opt_out || client.reminders_paused) {
      skippedCount++;
      continue;
    }

    const normalizedPhone =
      normalizePakistanWhatsappPhone(client.phone_normalized) ??
      normalizePakistanWhatsappPhone(client.phone);
    if (!normalizedPhone) {
      skippedCount++;
      continue;
    }

    if (settings.automation_launch_date) {
      const invoiceDate = toIsoDate(invoice.date) ?? toIsoDate(invoice.delivery_date);
      if (invoiceDate && invoiceDate < settings.automation_launch_date) {
        skippedCount++;
        continue;
      }
    }

    const existingForInvoice = remindersByInvoice.get(invoice.id) ?? [];
    if (existingForInvoice.length >= settings.maximum_reminders) {
      skippedCount++;
      continue;
    }

    const idempotencyKey = createReminderIdempotencyKey(invoice.id, stage);
    if (
      existingKeys.has(idempotencyKey) ||
      existingForInvoice.some((row) => row.reminder_stage === stage)
    ) {
      skippedCount++;
      continue;
    }

    rows.push({
      invoice_id: invoice.id,
      client_id: client.id,
      due_date_snapshot: dueDate,
      outstanding_amount_snapshot: outstanding,
      recipient_phone: client.phone,
      normalized_recipient_phone: normalizedPhone,
      provider: "whatsapp-web",
      channel: "whatsapp",
      reminder_stage: stage,
      status: settings.manual_approval_required ? "pending" : "approved",
      idempotency_key: idempotencyKey,
      scheduled_for: new Date().toISOString(),
    });
  }

  return { rows, scanCount: invoices.length, skippedCount };
}

function isReminderStillEligible(reminder: SendableReminder): { ok: boolean; reason: string } {
  const invoice = reminder.invoices;
  const client = reminder.clients;
  if (!invoice) return { ok: false, reason: "invoice_missing" };
  if (!client) return { ok: false, reason: "client_missing" };
  if (invoice.payment_status === "Done") return { ok: false, reason: "invoice_paid_after_queue" };
  if (calculateOutstandingAmount(invoice) <= 0)
    return { ok: false, reason: "zero_outstanding_after_queue" };
  if (client.whatsapp_opt_out) return { ok: false, reason: "client_opted_out_after_queue" };
  if (client.reminders_paused) return { ok: false, reason: "client_paused_after_queue" };
  if (!normalizePakistanWhatsappPhone(reminder.normalized_recipient_phone)) {
    return { ok: false, reason: "invalid_phone_after_queue" };
  }
  return { ok: true, reason: "eligible" };
}

async function sendWithRetries(
  provider: WhatsAppProvider,
  reminder: SendableReminder,
  maxRetries: number,
): Promise<string> {
  const attempts = Math.max(1, maxRetries);
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const invoice = reminder.invoices;
      const client = reminder.clients;
      const result = await provider.sendMessage({
        to: reminder.normalized_recipient_phone,
        idempotencyKey: reminder.idempotency_key,
        body: buildOverdueInvoiceMessage({
          clientName: client?.legal_name ?? "Customer",
          invoiceNumber: invoice?.invoice_no ?? "invoice",
          dueDate: reminder.due_date_snapshot,
          outstandingAmount: reminder.outstanding_amount_snapshot,
        }),
      });

      if (result.providerMessageId) return result.providerMessageId;
      throw new Error("Provider returned no message id");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unknown WhatsApp send failure");
}

export async function runReminderWorkflow({
  repository,
  provider,
  config,
  mode,
  now = new Date(),
}: ReminderWorkflowDeps): Promise<ReminderRunReport> {
  const report: ReminderRunReport = {
    mode,
    reason: "completed",
    scanCount: 0,
    eligibleCount: 0,
    queuedCount: 0,
    sentCount: 0,
    failedCount: 0,
    skippedCount: 0,
    duplicateCount: 0,
    workerConnected: provider.getStatus().connected,
  };

  const settings = await repository.loadSettings();
  if (!settings.enabled) return { ...report, reason: "settings_disabled" };
  if (settings.pause_all) return { ...report, reason: "pause_all_enabled" };
  if (settings.provider !== "whatsapp-web") return { ...report, reason: "provider_not_supported" };

  const invoices = await repository.listInvoices();
  const invoiceIds = invoices.map((invoice) => invoice.id);
  const existingReminders = await repository.listExistingReminders(invoiceIds);
  const eligible = buildEligibleReminderRows(invoices, existingReminders, settings, now);

  report.scanCount = eligible.scanCount;
  report.eligibleCount = eligible.rows.length;
  report.skippedCount += eligible.skippedCount;

  if (mode === "dry" || settings.dry_run) {
    report.reason = "dry_run_only";
    return report;
  }

  for (const row of eligible.rows) {
    const inserted = await repository.insertReminder(row);
    if (inserted === "duplicate") {
      report.duplicateCount++;
      continue;
    }
    report.queuedCount++;
  }

  if (!provider.getStatus().connected) {
    report.workerConnected = false;
    report.reason = "whatsapp_disconnected";
    return report;
  }

  const includePending = !settings.manual_approval_required;
  const sendLimit = Math.max(0, settings.maximum_daily_messages);
  const reminders = await repository.listSendableReminders(sendLimit, includePending);

  for (const reminder of reminders) {
    const stillEligible = isReminderStillEligible(reminder);
    if (!stillEligible.ok) {
      await repository.markSkipped(reminder.id, stillEligible.reason, stillEligible.reason);
      report.skippedCount++;
      continue;
    }

    try {
      if (reminder.status === "pending") await repository.markApproved(reminder.id);
      await repository.markProcessing(reminder.id);
      const providerMessageId = await sendWithRetries(provider, reminder, config.maxSendRetries);
      await repository.markSent(reminder.id, providerMessageId);
      report.sentCount++;
      await delay(config.messageDelayMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown send error";
      await repository.markFailed(reminder.id, "whatsapp_send_failed", message);
      report.failedCount++;
    }
  }

  return report;
}

export class SupabaseReminderRepository implements ReminderRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadSettings(): Promise<InvoiceReminderSettings> {
    const { data, error } = await this.supabase
      .from("invoice_reminder_settings")
      .select("*")
      .limit(1)
      .single();
    if (error) throw new Error(`Reminder settings load failed: ${error.message}`);
    return data as InvoiceReminderSettings;
  }

  async listInvoices(): Promise<ReminderInvoice[]> {
    const { data, error } = await this.supabase
      .from("invoices")
      .select(
        "id, invoice_no, client_id, date, delivery_date, due_date, amount, amount_received, payment_status, is_deleted, clients(id, legal_name, phone, phone_normalized, whatsapp_opt_out, reminders_paused)",
      )
      .or("is_deleted.is.null,is_deleted.eq.false");
    if (error) throw new Error(`Invoice scan failed: ${error.message}`);
    return (data ?? []) as unknown as ReminderInvoice[];
  }

  async listExistingReminders(invoiceIds: string[]): Promise<ExistingReminder[]> {
    if (invoiceIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from("invoice_reminders")
      .select("id, invoice_id, reminder_stage, idempotency_key, status")
      .in("invoice_id", invoiceIds);
    if (error) throw new Error(`Existing reminder scan failed: ${error.message}`);
    return (data ?? []) as ExistingReminder[];
  }

  async insertReminder(row: ReminderInsert): Promise<"inserted" | "duplicate"> {
    const { error } = await this.supabase.from("invoice_reminders").insert(row);
    if (!error) return "inserted";
    if (error.code === "23505") return "duplicate";
    throw new Error(`Reminder insert failed: ${error.message}`);
  }

  async listSendableReminders(limit: number, includePending: boolean): Promise<SendableReminder[]> {
    if (limit <= 0) return [];
    const statuses = includePending ? ["pending", "approved"] : ["approved"];
    const { data, error } = await this.supabase
      .from("invoice_reminders")
      .select(
        "id, invoice_id, client_id, due_date_snapshot, outstanding_amount_snapshot, recipient_phone, normalized_recipient_phone, provider, channel, reminder_stage, status, idempotency_key, scheduled_for, invoices(id, invoice_no, amount, amount_received, payment_status, due_date), clients(id, legal_name, whatsapp_opt_out, reminders_paused)",
      )
      .in("status", statuses)
      .order("scheduled_for", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) throw new Error(`Sendable reminder load failed: ${error.message}`);
    return (data ?? []) as unknown as SendableReminder[];
  }

  async markApproved(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("invoice_reminders")
      .update({ status: "approved", approved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Approve failed: ${error.message}`);
  }

  async markProcessing(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("invoice_reminders")
      .update({ status: "processing" })
      .eq("id", id);
    if (error) throw new Error(`Processing update failed: ${error.message}`);
  }

  async markSent(id: string, providerMessageId: string): Promise<void> {
    const { error } = await this.supabase
      .from("invoice_reminders")
      .update({
        status: "sent",
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      })
      .eq("id", id);
    if (error) throw new Error(`Sent update failed: ${error.message}`);
  }

  async markFailed(id: string, code: string, message: string): Promise<void> {
    const { error } = await this.supabase
      .from("invoice_reminders")
      .update({
        status: "failed",
        error_code: code,
        error_message: message.slice(0, 500),
        failed_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw new Error(`Failure update failed: ${error.message}`);
  }

  async markSkipped(id: string, code: string, message: string): Promise<void> {
    const { error } = await this.supabase
      .from("invoice_reminders")
      .update({ status: "skipped", error_code: code, error_message: message.slice(0, 500) })
      .eq("id", id);
    if (error) throw new Error(`Skipped update failed: ${error.message}`);
  }
}

export async function startQueueProcessor(
  supabase: SupabaseClient,
  provider: WhatsAppProvider,
  config: WorkerConfig,
  mode: ReminderRunMode = config.dryRun ? "dry" : "live",
): Promise<ReminderRunReport> {
  if (!config.automationEnabled) {
    return {
      mode,
      reason: "env_automation_disabled",
      scanCount: 0,
      eligibleCount: 0,
      queuedCount: 0,
      sentCount: 0,
      failedCount: 0,
      skippedCount: 0,
      duplicateCount: 0,
      workerConnected: provider.getStatus().connected,
    };
  }

  return runReminderWorkflow({
    repository: new SupabaseReminderRepository(supabase),
    provider,
    config,
    mode,
  });
}

export function logReminderRunReport(report: ReminderRunReport): void {
  console.info("Reminder workflow", {
    reason: report.reason,
    mode: report.mode,
    scanCount: report.scanCount,
    eligibleCount: report.eligibleCount,
    queuedCount: report.queuedCount,
    sentCount: report.sentCount,
    failedCount: report.failedCount,
    skippedCount: report.skippedCount,
    workerConnected: report.workerConnected,
  });
}
