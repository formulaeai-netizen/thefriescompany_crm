import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../config.js";
import type { WhatsAppProvider } from "../providers/whatsapp-provider.js";
import { buildCreditPurchaseReminderMessage } from "./message-builder.js";

// Prompt 3, item E. Consumes public.claim_due_credit_purchase_reminders()
// (Prompt 2, service-role only, atomic FOR UPDATE SKIP LOCKED claim) for
// live runs, and a read-only preview for dry runs (a true dry-run must
// never call the mutating claim RPC).

export type CreditPurchaseRow = {
  id: string;
  supplier_name: string;
  item_name_snapshot: string;
  amount_due: number | string;
  due_at: string;
  status: string;
  reminder_lead_hours: number;
  reminder_queued_at: string | null;
  reminder_sent_at: string | null;
};

export type CreditPurchaseDispatchRepository = {
  loadRoutingRecipient(): Promise<string | null>;
  /** Read-only preview - unpaid, not-yet-queued, due within lead-hours. Never mutates anything. */
  previewDuePurchases(now?: Date): Promise<CreditPurchaseRow[]>;
  /** Atomic claim (mutating) - only ever called in live mode after connectivity/recipient checks pass. */
  claimDuePurchases(): Promise<CreditPurchaseRow[]>;
  markReminderSent(id: string): Promise<void>;
  /** Resets reminder_queued_at to null so a failed send remains retryable on the next run. */
  unclaimReminder(id: string): Promise<void>;
};

export type CreditPurchaseDispatchMode = "dry" | "live";

export type CreditPurchaseDispatchReport = {
  mode: CreditPurchaseDispatchMode;
  reason: string;
  scanCount: number;
  sentCount: number;
  failedCount: number;
  workerConnected: boolean;
};

export type CreditPurchaseDispatchDeps = {
  repository: CreditPurchaseDispatchRepository;
  provider: WhatsAppProvider;
  config: Pick<WorkerConfig, "maxSendRetries">;
  mode: CreditPurchaseDispatchMode;
  now?: Date;
};

function toFiniteNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Pure eligibility mirror of the DB claim RPC's WHERE clause - used for the read-only dry-run preview and for tests. */
export function isCreditPurchaseReminderDue(
  purchase: CreditPurchaseRow,
  now: Date = new Date(),
): boolean {
  if (purchase.status !== "unpaid") return false;
  if (purchase.reminder_queued_at) return false;
  const dueAt = new Date(purchase.due_at);
  if (Number.isNaN(dueAt.getTime())) return false;
  const windowEnd = new Date(now.getTime() + purchase.reminder_lead_hours * 3600_000);
  return dueAt.getTime() <= windowEnd.getTime();
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

export async function runCreditPurchaseDispatchWorkflow({
  repository,
  provider,
  config,
  mode,
  now = new Date(),
}: CreditPurchaseDispatchDeps): Promise<CreditPurchaseDispatchReport> {
  const report: CreditPurchaseDispatchReport = {
    mode,
    reason: "completed",
    scanCount: 0,
    sentCount: 0,
    failedCount: 0,
    workerConnected: provider.getStatus().connected,
  };

  const recipient = await repository.loadRoutingRecipient();
  if (!recipient) return { ...report, reason: "recipient_not_configured" };

  const preview = await repository.previewDuePurchases(now);
  report.scanCount = preview.length;

  if (preview.length === 0) return { ...report, reason: "no_pending_reminders" };

  if (mode === "dry") return { ...report, reason: "dry_run_only" };

  if (!provider.getStatus().connected) {
    return { ...report, reason: "whatsapp_disconnected", workerConnected: false };
  }

  const claimed = await repository.claimDuePurchases();

  for (const purchase of claimed) {
    try {
      const body = buildCreditPurchaseReminderMessage({
        itemName: purchase.item_name_snapshot,
        supplierName: purchase.supplier_name,
        amountDue: toFiniteNumber(purchase.amount_due),
        dueAt: purchase.due_at,
        reference: purchase.id,
      });
      await sendWithRetries(
        provider,
        recipient,
        body,
        `credit-purchase-reminder:${purchase.id}`,
        config.maxSendRetries,
      );
      await repository.markReminderSent(purchase.id);
      report.sentCount++;
    } catch {
      // Never leave a failed send stuck as "queued forever" - unclaim so the next run retries it.
      await repository.unclaimReminder(purchase.id);
      report.failedCount++;
    }
  }

  return report;
}

export class SupabaseCreditPurchaseDispatchRepository implements CreditPurchaseDispatchRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadRoutingRecipient(): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("whatsapp_routing_numbers")
      .select("recipient_phone_normalized")
      .eq("flow_key", "credit_purchase_reminders")
      .maybeSingle();
    if (error) throw new Error(`Credit purchase routing number load failed: ${error.message}`);
    return data?.recipient_phone_normalized ?? null;
  }

  async previewDuePurchases(now: Date = new Date()): Promise<CreditPurchaseRow[]> {
    const { data, error } = await this.supabase
      .from("credit_inventory_purchases")
      .select(
        "id, supplier_name, item_name_snapshot, amount_due, due_at, status, reminder_lead_hours, reminder_queued_at, reminder_sent_at",
      )
      .eq("status", "unpaid")
      .is("reminder_queued_at", null);
    if (error) throw new Error(`Credit purchase preview scan failed: ${error.message}`);
    return ((data ?? []) as CreditPurchaseRow[]).filter((row) =>
      isCreditPurchaseReminderDue(row, now),
    );
  }

  async claimDuePurchases(): Promise<CreditPurchaseRow[]> {
    const { data, error } = await this.supabase.rpc("claim_due_credit_purchase_reminders");
    if (error) throw new Error(`Credit purchase reminder claim failed: ${error.message}`);
    return (data ?? []) as CreditPurchaseRow[];
  }

  async markReminderSent(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("credit_inventory_purchases")
      .update({ reminder_sent_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw new Error(`Marking credit purchase reminder sent failed: ${error.message}`);
  }

  async unclaimReminder(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("credit_inventory_purchases")
      .update({ reminder_queued_at: null })
      .eq("id", id);
    if (error) throw new Error(`Unclaiming credit purchase reminder failed: ${error.message}`);
  }
}

export function logCreditPurchaseDispatchReport(report: CreditPurchaseDispatchReport): void {
  console.info("Credit purchase reminder workflow", {
    reason: report.reason,
    mode: report.mode,
    scanCount: report.scanCount,
    sentCount: report.sentCount,
    failedCount: report.failedCount,
    workerConnected: report.workerConnected,
  });
}
