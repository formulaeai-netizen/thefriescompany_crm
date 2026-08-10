import crypto from "node:crypto";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhatsAppProvider } from "../providers/whatsapp-provider.js";
import {
  buildEarlyPaymentReply,
  buildInvalidPaidCommandReply,
  buildMultipleOpenInvoicesReply,
  buildNoOutstandingInvoiceReply,
} from "./message-builder.js";
import { classifyInboundText, parsePaidWhatsAppCommand } from "./payment-command-parser.js";

// Prompt 3, item A/B: replaces the old generic PAID/PAYMENT DONE keyword
// handling with the deterministic "PAID <amount> <invoice-id>" command for
// approvable claims, plus a separate, non-approving early-payment reply
// flow for soft "I paid" style messages. No OCR/AI/fuzzy invoice guessing
// anywhere in this file.

const PAYMENT_PROOF_BUCKET = "payment-proofs";

export type InboundClient = {
  id: string;
  legal_name: string | null;
};

export type InboundInvoice = {
  id: string;
  client_id: string | null;
  invoice_no: string | null;
  amount: number | string | null;
  amount_received: number | string | null;
  payment_status: string | null;
  is_deleted: boolean | null;
};

export type InboundMediaMetadata = {
  storagePath: string | null;
  mimetype: string | null;
  filename: string | null;
  sizeBytes: number | null;
};

const EMPTY_MEDIA: InboundMediaMetadata = {
  storagePath: null,
  mimetype: null,
  filename: null,
  sizeBytes: null,
};

export type PaymentVerificationRequestInsert = {
  client_id: string | null;
  invoice_id: string | null;
  sender_phone: string;
  incoming_message: string | null;
  storage_path: string | null;
  media_mimetype: string | null;
  media_filename: string | null;
  media_size_bytes: number | null;
  status: "pending";
  claimed_amount: number;
  parsed_invoice_reference: string;
  inbound_message_id: string;
  normalized_sender_phone: string;
  normalized_command: string;
};

export type CreateVerificationRequestResult =
  { status: "inserted"; id: string } | { status: "duplicate" };

export type InboundPaymentRepository = {
  findClientByPhone(normalizedPhone: string): Promise<InboundClient | null>;
  findOpenInvoicesForClient(clientId: string): Promise<InboundInvoice[]>;
  findInvoiceByReferenceForClient(
    clientId: string,
    invoiceReference: string,
  ): Promise<InboundInvoice | null>;
  createVerificationRequest(
    row: PaymentVerificationRequestInsert,
  ): Promise<CreateVerificationRequestResult>;
  storePaymentProof(input: {
    clientId: string | null;
    messageId: string;
    mimetype: string;
    filename: string | null;
    base64Data: string;
  }): Promise<InboundMediaMetadata>;
};

export type StrictCommandRejectionReason =
  "unknown_sender" | "invoice_not_found" | "invoice_not_owned" | "invoice_not_open";

export type InboundEventResult =
  | { kind: "ignored"; reason: string }
  | { kind: "duplicate_ignored" }
  | {
      kind: "strict_command_created";
      requestId: string;
      clientId: string;
      invoiceId: string;
      claimedAmount: number;
    }
  | { kind: "strict_command_rejected"; reason: StrictCommandRejectionReason }
  | { kind: "invalid_command_guidance"; reply: string }
  | { kind: "early_payment_reply"; reply: string; invoiceCount: number }
  | { kind: "duplicate_reply_suppressed" }
  | { kind: "unknown_sender_ignored" };

export type InboundContext = {
  /** Process-local, best-effort dedupe for informational auto-replies only
   * (early-payment / invalid-command guidance). The financially-relevant
   * path (strict PAID command) is deduplicated at the database level via
   * the unique inbound_message_id index - this Set is not relied on for
   * anything safety-critical. */
  respondedMessageIds: Set<string>;
};

export function createInboundContext(): InboundContext {
  return { respondedMessageIds: new Set() };
}

export function normalizePakistanWhatsappPhone(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;
  let digits = rawPhone.trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `92${digits.slice(1)}`;
  return /^923\d{9}$/.test(digits) ? digits : null;
}

function toFiniteMoney(value: number | string | null | undefined): number {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function calculateOutstanding(invoice: InboundInvoice): number {
  if (invoice.payment_status === "Done") return 0;
  return Math.max(toFiniteMoney(invoice.amount) - toFiniteMoney(invoice.amount_received), 0);
}

function sanitizeFilename(value: string | null | undefined): string {
  const name = value?.trim() || "payment-proof";
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

function extensionFromMime(mimetype: string): string {
  if (mimetype.includes("png")) return ".png";
  if (mimetype.includes("jpeg") || mimetype.includes("jpg")) return ".jpg";
  if (mimetype.includes("pdf")) return ".pdf";
  return "";
}

function messageIdForStorage(messageId: string): string {
  return crypto.createHash("sha256").update(messageId).digest("hex").slice(0, 24);
}

function extractMessageId(message: any): string {
  return (
    message?.id?._serialized ??
    message?.id?.id ??
    message?._data?.id?._serialized ??
    crypto.randomUUID()
  );
}

async function extractSenderPhone(message: any): Promise<string | null> {
  const candidates: Array<string | null | undefined> = [
    message?.from,
    message?.author,
    message?._data?.from,
    message?._data?.author,
  ];

  try {
    const contact = await message.getContact?.();
    candidates.push(contact?.number, contact?.id?.user);
  } catch {
    // Ignore contact lookup failures; direct message metadata may still contain a phone.
  }

  for (const candidate of candidates) {
    const phone = normalizePakistanWhatsappPhone(String(candidate ?? "").replace(/@.+$/, ""));
    if (phone) return phone;
  }

  return null;
}

async function captureMediaMetadata(
  repository: InboundPaymentRepository,
  message: any,
  clientId: string | null,
  messageId: string,
): Promise<InboundMediaMetadata> {
  if (!message?.hasMedia) return EMPTY_MEDIA;

  const media = await message.downloadMedia?.();
  if (!media?.data || !media?.mimetype) return EMPTY_MEDIA;

  return repository.storePaymentProof({
    clientId,
    messageId,
    mimetype: media.mimetype,
    filename: media.filename ?? null,
    base64Data: media.data,
  });
}

/**
 * Prompt 3, item A. A media-only message (no valid strict command text)
 * must never create an approvable claim, even if media is present -
 * media may only ever be stored as supplementary evidence attached to a
 * request created by a valid strict command (see handleStrictPaidCommand).
 */
async function handleStrictPaidCommand(
  repository: InboundPaymentRepository,
  message: any,
  input: { messageId: string; senderPhone: string; body: string },
): Promise<InboundEventResult> {
  const parsed = parsePaidWhatsAppCommand(input.body);
  if (!parsed) return { kind: "ignored", reason: "not_relevant" };

  const client = await repository.findClientByPhone(input.senderPhone);
  if (!client) return { kind: "strict_command_rejected", reason: "unknown_sender" };

  const invoice = await repository.findInvoiceByReferenceForClient(
    client.id,
    parsed.invoiceReference,
  );
  if (!invoice) return { kind: "strict_command_rejected", reason: "invoice_not_found" };
  if (invoice.client_id !== client.id)
    return { kind: "strict_command_rejected", reason: "invoice_not_owned" };
  if (invoice.is_deleted || invoice.payment_status === "Done") {
    return { kind: "strict_command_rejected", reason: "invoice_not_open" };
  }

  const media = await captureMediaMetadata(repository, message, client.id, input.messageId);

  const insertResult = await repository.createVerificationRequest({
    client_id: client.id,
    invoice_id: invoice.id,
    sender_phone: input.senderPhone,
    incoming_message: input.body,
    storage_path: media.storagePath,
    media_mimetype: media.mimetype,
    media_filename: media.filename,
    media_size_bytes: media.sizeBytes,
    status: "pending",
    claimed_amount: parsed.amount,
    parsed_invoice_reference: parsed.invoiceReference,
    inbound_message_id: input.messageId,
    normalized_sender_phone: input.senderPhone,
    normalized_command: `PAID ${parsed.amount} ${parsed.invoiceReference}`,
  });

  if (insertResult.status === "duplicate") return { kind: "duplicate_ignored" };

  return {
    kind: "strict_command_created",
    requestId: insertResult.id,
    clientId: client.id,
    invoiceId: invoice.id,
    claimedAmount: parsed.amount,
  };
}

async function handleEarlyPaymentMessage(
  repository: InboundPaymentRepository,
  input: { messageId: string; senderPhone: string; context: InboundContext },
): Promise<InboundEventResult> {
  if (input.context.respondedMessageIds.has(input.messageId)) {
    return { kind: "duplicate_reply_suppressed" };
  }

  const client = await repository.findClientByPhone(input.senderPhone);
  input.context.respondedMessageIds.add(input.messageId);

  if (!client) {
    // Unknown senders: no invoice information, no client data exposure, no payment request.
    return { kind: "unknown_sender_ignored" };
  }

  const invoices = await repository.findOpenInvoicesForClient(client.id);
  const clientName = client.legal_name ?? "Customer";

  if (invoices.length === 0) {
    return {
      kind: "early_payment_reply",
      reply: buildNoOutstandingInvoiceReply(clientName),
      invoiceCount: 0,
    };
  }

  if (invoices.length > 1) {
    return {
      kind: "early_payment_reply",
      reply: buildMultipleOpenInvoicesReply(
        clientName,
        invoices.map((invoice) => ({
          invoiceNumber: invoice.invoice_no ?? "invoice",
          outstandingAmount: calculateOutstanding(invoice),
        })),
      ),
      invoiceCount: invoices.length,
    };
  }

  const invoice = invoices[0];
  return {
    kind: "early_payment_reply",
    reply: buildEarlyPaymentReply({
      clientName,
      invoiceNumber: invoice.invoice_no ?? "invoice",
      outstandingAmount: calculateOutstanding(invoice),
    }),
    invoiceCount: 1,
  };
}

export async function handleIncomingPaymentMessage(
  repository: InboundPaymentRepository,
  message: any,
  context: InboundContext,
): Promise<InboundEventResult> {
  if (message?.fromMe) return { kind: "ignored", reason: "outgoing_message" };

  const body = typeof message?.body === "string" ? message.body : "";
  const senderPhone = await extractSenderPhone(message);
  if (!senderPhone) return { kind: "ignored", reason: "sender_phone_unrecognized" };

  const messageId = extractMessageId(message);
  const classification = classifyInboundText(body);

  if (classification === "strict_command") {
    return handleStrictPaidCommand(repository, message, { messageId, senderPhone, body });
  }

  if (classification === "invalid_attempt") {
    return { kind: "invalid_command_guidance", reply: buildInvalidPaidCommandReply() };
  }

  if (classification === "early_payment") {
    return handleEarlyPaymentMessage(repository, { messageId, senderPhone, context });
  }

  if (!body && message?.hasMedia) {
    return { kind: "ignored", reason: "media_only_not_a_payment_confirmation" };
  }

  return { kind: "ignored", reason: "not_relevant" };
}

export class SupabaseInboundPaymentRepository implements InboundPaymentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findClientByPhone(normalizedPhone: string): Promise<InboundClient | null> {
    const { data, error } = await this.supabase
      .from("clients")
      .select("id, legal_name")
      .or(`phone_normalized.eq.${normalizedPhone},phone.eq.${normalizedPhone}`)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Client phone lookup failed: ${error.message}`);
    return data as InboundClient | null;
  }

  async findOpenInvoicesForClient(clientId: string): Promise<InboundInvoice[]> {
    const { data, error } = await this.supabase
      .from("invoices")
      .select("id, client_id, invoice_no, amount, amount_received, payment_status, is_deleted")
      .eq("client_id", clientId)
      .or("is_deleted.is.null,is_deleted.eq.false")
      .neq("payment_status", "Done")
      .order("due_date", { ascending: true, nullsFirst: false });
    if (error) throw new Error(`Open invoice lookup failed: ${error.message}`);
    return (data ?? []) as InboundInvoice[];
  }

  async findInvoiceByReferenceForClient(
    clientId: string,
    invoiceReference: string,
  ): Promise<InboundInvoice | null> {
    const { data, error } = await this.supabase
      .from("invoices")
      .select("id, client_id, invoice_no, amount, amount_received, payment_status, is_deleted")
      .eq("client_id", clientId)
      .ilike("invoice_no", invoiceReference)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`Invoice reference lookup failed: ${error.message}`);
    return data as InboundInvoice | null;
  }

  async createVerificationRequest(
    row: PaymentVerificationRequestInsert,
  ): Promise<CreateVerificationRequestResult> {
    const { data, error } = await this.supabase
      .from("payment_verification_requests")
      .insert(row)
      .select("id")
      .single();
    if (!error) return { status: "inserted", id: data.id };
    if (error.code === "23505") return { status: "duplicate" };
    throw new Error(`Payment verification request insert failed: ${error.message}`);
  }

  async storePaymentProof(input: {
    clientId: string | null;
    messageId: string;
    mimetype: string;
    filename: string | null;
    base64Data: string;
  }): Promise<InboundMediaMetadata> {
    const extension = path.extname(input.filename ?? "") || extensionFromMime(input.mimetype);
    const safeName = sanitizeFilename(input.filename);
    const storagePath = [
      input.clientId ?? "unknown-client",
      `${new Date().toISOString().slice(0, 10)}-${messageIdForStorage(input.messageId)}-${safeName}${extension}`,
    ].join("/");
    const buffer = Buffer.from(input.base64Data, "base64");
    const { error } = await this.supabase.storage
      .from(PAYMENT_PROOF_BUCKET)
      .upload(storagePath, buffer, {
        contentType: input.mimetype,
        upsert: false,
      });
    if (error) throw new Error(`Payment proof upload failed: ${error.message}`);
    return {
      storagePath,
      mimetype: input.mimetype,
      filename: input.filename,
      sizeBytes: buffer.byteLength,
    };
  }
}

/**
 * Wires the inbound handler to a live WhatsApp-web client. Only ever
 * invoked when the worker process is actually started with a real,
 * connected session (not during this prompt). Auto-replies (early-payment
 * template, no-outstanding-invoice, multiple-invoice guidance, invalid-
 * command guidance) go through the same provider.sendMessage() used
 * everywhere else in the worker, so they are already subject to the
 * existing WHATSAPP_ALLOW_REAL_SEND gate and event-confirmation safety
 * logic - never sent without a real connected session's confirmation.
 */
export function startInboundPaymentListener(
  client: any,
  repository: InboundPaymentRepository,
  provider: WhatsAppProvider,
  context: InboundContext = createInboundContext(),
) {
  const onMessage = async (message: any) => {
    try {
      const result = await handleIncomingPaymentMessage(repository, message, context);

      if (result.kind === "strict_command_created") {
        console.info("Payment verification request created from strict PAID command", {
          claimedAmount: result.claimedAmount,
        });
      } else if (result.kind === "strict_command_rejected") {
        console.info("Strict PAID command rejected", { reason: result.reason });
      } else if (result.kind === "duplicate_ignored") {
        console.info("Duplicate inbound payment message ignored");
      } else if (
        (result.kind === "early_payment_reply" || result.kind === "invalid_command_guidance") &&
        provider.getStatus().connected
      ) {
        const senderPhone = await extractSenderPhone(message);
        if (senderPhone) {
          await provider.sendMessage({ to: senderPhone, body: result.reply });
        }
      }
    } catch (error) {
      const errMessage = error instanceof Error ? error.message : "Unknown inbound payment error";
      console.error("Inbound payment confirmation handling failed", { error: errMessage });
    }
  };

  client.on("message", onMessage);
  return () => client.off("message", onMessage);
}
