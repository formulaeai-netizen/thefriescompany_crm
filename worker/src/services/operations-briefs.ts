import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../config.js";

export type OperationsBriefKind = "morning" | "evening";

export type OperationsBriefFacts = {
  ordersDue: number;
  receivingPending: number;
  pendingPayments: number;
  openAlerts: number;
};

export type OperationsBriefDispatchReport = {
  reason: "disabled" | "completed" | "failed";
  kind: OperationsBriefKind;
  insertedCount: number;
  error: string | null;
};

export function buildOperationsBriefText(kind: OperationsBriefKind, facts: OperationsBriefFacts) {
  const title = kind === "morning" ? "Morning Operations Brief" : "Evening Operations Summary";
  const body = [
    `Orders due: ${facts.ordersDue}`,
    `Receiving pending: ${facts.receivingPending}`,
    `Payment verifications: ${facts.pendingPayments}`,
    `Open operational alerts: ${facts.openAlerts}`,
  ].join(" | ");
  return { title, body };
}

export function buildOperationsBriefDedupeKey(kind: OperationsBriefKind, dateIso: string) {
  return `operations-brief:${kind}:${dateIso}`;
}

async function countRows(supabase: SupabaseClient, table: string, apply: (query: any) => any) {
  const query = apply((supabase as any).from(table).select("id", { count: "exact", head: true }));
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function collectOperationsBriefFacts(
  supabase: SupabaseClient,
): Promise<OperationsBriefFacts> {
  const today = new Date().toISOString().slice(0, 10);
  const [ordersDue, receivingPending, pendingPayments, openAlerts] = await Promise.all([
    countRows(supabase, "sales_orders", (query) =>
      query.lte("requested_delivery_date", today).not("status", "in", "(cancelled,fulfilled)"),
    ),
    countRows(supabase, "sales_order_fulfillments", (query) =>
      query.eq("status", "receiving_pending"),
    ),
    countRows(supabase, "payment_verification_requests", (query) => query.eq("status", "pending")),
    countRows(supabase, "operational_alerts", (query) => query.eq("status", "open")),
  ]);

  return { ordersDue, receivingPending, pendingPayments, openAlerts };
}

export async function dispatchOperationsBrief(
  supabase: SupabaseClient,
  config: WorkerConfig,
  kind: OperationsBriefKind,
): Promise<OperationsBriefDispatchReport> {
  if (!config.operationsBriefEnabled) {
    return { reason: "disabled", kind, insertedCount: 0, error: null };
  }

  try {
    const facts = await collectOperationsBriefFacts(supabase);
    const { title, body } = buildOperationsBriefText(kind, facts);
    const dedupeKey = buildOperationsBriefDedupeKey(kind, new Date().toISOString().slice(0, 10));
    const { data, error } = await (supabase as any).rpc("create_notification_for_roles", {
      target_roles: ["admin", "moderator"],
      notification_category: "operational_alerts",
      notification_priority: kind === "morning" ? "Medium" : "Low",
      notification_title: title,
      notification_body: body,
      notification_link: "/today",
      notification_source_type: "operations_brief",
      notification_source_id: null,
      notification_dedupe_key: dedupeKey,
    });
    if (error) throw error;
    return { reason: "completed", kind, insertedCount: data ?? 0, error: null };
  } catch (error) {
    return {
      reason: "failed",
      kind,
      insertedCount: 0,
      error: error instanceof Error ? error.message : "Unknown operations brief error",
    };
  }
}

export function logOperationsBriefReport(report: OperationsBriefDispatchReport) {
  console.info("Operations brief workflow", report);
}
