import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhatsAppProvider } from "../providers/whatsapp-provider.js";
import {
  buildExpenseListRecordedReply,
  buildExpenseNotRecordedReply,
  buildExpenseRecordedReply,
} from "./message-builder.js";
import {
  looksLikeNumberedExpenseReport,
  parseExpenseCommand,
  totalOf,
  type ParsedExpenseCommand,
  type ParsedExpenseItem,
} from "./expense-command-parser.js";
import { isTrustedExpenseSender, normalizeWhatsAppSender } from "./whatsapp-trust.js";

// Phase 2: trusted WhatsApp expense intake. A single configured sender
// (Settings -> WhatsApp Routing) may create one or more real `expenses` rows via
// a deterministic command. This module NEVER writes to
// cash_ledger_entries directly - it only ever inserts through
// create_expenses_from_whatsapp(), which inserts plain `expenses` rows
// and lets the existing Phase 1 trigger (sync_expense_cash_ledger) do the
// one thing it already does for every other expense in the CRM.

export type ExpenseIntakeRpcResult =
  | { status: "created" | "duplicate"; expenseIds: string[]; totalAmount: number }
  | { status: "rejected"; reason: string };

export type ExpenseIntakeRepository = {
  loadTrustedExpenseSender(): Promise<string | null>;
  createExpensesFromTrustedMessage(input: {
    providerMessageId: string;
    senderNormalized: string;
    rawBody: string;
    items: ParsedExpenseItem[];
  }): Promise<ExpenseIntakeRpcResult>;
};

export type ExpenseIntakeOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "untrusted_sender" }
  | { kind: "invalid_format"; reply: string }
  | {
      kind: "recorded";
      reply: string;
      status: "created" | "duplicate";
      expenseIds: string[];
      totalAmount: number;
      itemCount: number;
    }
  | { kind: "error"; reply: string };

function extractMessageId(message: any): string {
  return (
    message?.id?._serialized ??
    message?.id?.id ??
    message?._data?.id?._serialized ??
    crypto.randomUUID()
  );
}

function extractRawSender(message: any): string | null {
  return (
    message?.from ??
    message?.author ??
    message?.id?.remote ??
    message?.id?.participant ??
    message?._data?.from ??
    message?._data?.author ??
    message?._data?.id?.remote ??
    message?._data?.id?.participant ??
    null
  );
}

async function extractNormalizedSender(message: any): Promise<string | null> {
  const direct = normalizeWhatsAppSender(extractRawSender(message));
  if (direct) return direct;

  try {
    const contact = await message.getContact?.();
    const candidates = [contact?.number, contact?.id?.user, contact?.id?._serialized];
    for (const candidate of candidates) {
      const sender = normalizeWhatsAppSender(candidate);
      if (sender) return sender;
    }
  } catch {
    // Direct message metadata may still be enough; if not, fail closed.
  }

  return null;
}

function maskSenderForLog(sender: string | null): string {
  if (!sender) return "(unknown)";
  return `***${sender.slice(-4)}`;
}

function replyFor(parsed: ParsedExpenseCommand, items: ParsedExpenseItem[]): string {
  if (parsed.kind === "single") {
    return buildExpenseRecordedReply({
      description: parsed.item.description,
      amount: parsed.item.amount,
    });
  }
  return buildExpenseListRecordedReply({ count: items.length, total: totalOf(items) });
}

/**
 * Pure-ish dispatcher (one repository call). Trust is checked twice by
 * design - here (worker-side, so an untrusted message never even reaches
 * the RPC) and again inside create_expenses_from_whatsapp() itself
 * (server-side, so a compromised/buggy worker can never bypass it) -
 * "do not trust worker-only authorization".
 */
export async function handleIncomingExpenseMessage(
  repository: ExpenseIntakeRepository,
  message: any,
): Promise<ExpenseIntakeOutcome> {
  if (message?.fromMe) return { kind: "ignored", reason: "outgoing_message" };

  const body = typeof message?.body === "string" ? message.body : "";
  const trimmedBody = body.trim();
  const isExplicitExpenseCommand = /^EXPENSE\b/i.test(trimmedBody);
  if (!isExplicitExpenseCommand && !looksLikeNumberedExpenseReport(trimmedBody)) {
    return { kind: "ignored", reason: "not_relevant" };
  }

  const sender = await extractNormalizedSender(message);
  if (!sender) return { kind: "ignored", reason: "sender_unrecognized" };

  const trustedSender = await repository.loadTrustedExpenseSender();
  if (!isTrustedExpenseSender(sender, trustedSender)) {
    // Unknown/untrusted sender: no expense insert, no cash ledger
    // mutation, no financial data disclosure, no reply at all - safe
    // log/audit only (handled by the caller via console logging).
    return { kind: "untrusted_sender" };
  }

  const parsed = parseExpenseCommand(trimmedBody);
  if (!parsed) {
    return isExplicitExpenseCommand
      ? { kind: "invalid_format", reply: buildExpenseNotRecordedReply() }
      : { kind: "invalid_format", reply: buildExpenseNotRecordedReply() };
  }

  const items = parsed.kind === "single" ? [parsed.item] : parsed.items;
  const messageId = extractMessageId(message);

  const result = await repository.createExpensesFromTrustedMessage({
    providerMessageId: messageId,
    senderNormalized: sender,
    rawBody: body,
    items,
  });

  if (result.status === "rejected") {
    // Never leak the raw DB/RPC error text back to WhatsApp.
    return { kind: "error", reply: buildExpenseNotRecordedReply() };
  }

  return {
    kind: "recorded",
    reply: replyFor(parsed, items),
    status: result.status,
    expenseIds: result.expenseIds,
    totalAmount: result.totalAmount,
    itemCount: items.length,
  };
}

export class SupabaseExpenseIntakeRepository implements ExpenseIntakeRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadTrustedExpenseSender(): Promise<string | null> {
    const { data, error } = await this.supabase
      .from("whatsapp_routing_numbers")
      .select("recipient_phone_normalized")
      .eq("flow_key", "expense_intake_sender")
      .maybeSingle();
    if (error) throw new Error(`Expense intake sender load failed: ${error.message}`);
    return data?.recipient_phone_normalized ?? null;
  }

  async createExpensesFromTrustedMessage(input: {
    providerMessageId: string;
    senderNormalized: string;
    rawBody: string;
    items: ParsedExpenseItem[];
  }): Promise<ExpenseIntakeRpcResult> {
    const { data, error } = await (this.supabase as any).rpc("create_expenses_from_whatsapp", {
      _provider_message_id: input.providerMessageId,
      _sender_normalized: input.senderNormalized,
      _raw_body: input.rawBody,
      _items: input.items.map((item) => ({
        description: item.description,
        amount: item.amount,
        expense_date: item.expenseDate ?? null,
      })),
    });

    if (error) return { status: "rejected", reason: error.message };

    const row = Array.isArray(data) ? data[0] : data;
    return {
      status: row?.status === "duplicate" ? "duplicate" : "created",
      expenseIds: (row?.expense_ids ?? []) as string[],
      totalAmount: Number(row?.total_amount ?? 0),
    };
  }
}

/**
 * Wires the handler to a live WhatsApp-web client. Only ever invoked when
 * the worker process is actually started with a real, connected session
 * (never during this phase). Replies go through the same
 * provider.sendMessage() as every other worker flow, so they remain
 * subject to the existing WHATSAPP_ALLOW_REAL_SEND gate and
 * event-confirmation safety logic.
 */
export function startInboundExpenseListener(
  client: any,
  repository: ExpenseIntakeRepository,
  provider: WhatsAppProvider,
) {
  const onMessage = async (message: any) => {
    try {
      const rawBody = typeof message?.body === "string" ? message.body.trim() : "";
      const candidateExpenseMessage =
        /^EXPENSE\b/i.test(rawBody) || looksLikeNumberedExpenseReport(rawBody);
      if (candidateExpenseMessage) {
        const sender = await extractNormalizedSender(message);
        console.info("Expense intake: candidate message received", {
          sender: maskSenderForLog(sender),
          fromMe: Boolean(message?.fromMe),
        });
      }

      const outcome = await handleIncomingExpenseMessage(repository, message);

      if (outcome.kind === "untrusted_sender") {
        console.info(
          "Expense intake: message from untrusted sender ignored (no insert, no disclosure)",
        );
        return;
      }
      if (outcome.kind === "ignored") {
        if (candidateExpenseMessage) {
          console.info("Expense intake: candidate ignored", { reason: outcome.reason });
        }
        return;
      }

      if (outcome.kind === "recorded") {
        console.info("Expense(s) recorded from trusted WhatsApp message", {
          status: outcome.status,
          itemCount: outcome.itemCount,
          totalAmount: outcome.totalAmount,
        });
      } else {
        console.info("Expense intake rejected", { kind: outcome.kind });
      }

      if (provider.getStatus().connected) {
        const sender = await extractNormalizedSender(message);
        if (sender) await provider.sendMessage({ to: sender, body: outcome.reply });
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : "Unknown expense intake error";
      console.error("Inbound expense intake handling failed", { error: errMessage });
    }
  };

  client.on("message", onMessage);
  return () => client.off("message", onMessage);
}
