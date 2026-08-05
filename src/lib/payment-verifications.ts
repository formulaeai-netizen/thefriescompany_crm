export type PaymentVerificationStatus = "pending" | "approved" | "rejected" | "unresolved";

export type PaymentVerificationRequestInput = {
  id: string;
  client_id: string | null;
  invoice_id: string | null;
  status: PaymentVerificationStatus;
  claimed_amount?: number | null;
};

export type PaymentVerificationInvoiceInput = {
  id: string;
  client_id: string | null;
  invoice_no: string | null;
  due_date?: string | null;
  amount?: number | string | null;
  amount_received?: number | string | null;
  payment_status?: string | null;
  is_deleted?: boolean | null;
};

export type PaymentVerificationReminderInput = {
  invoice_id?: string | null;
  status?: string | null;
};

const CANCELLABLE_REMINDER_STATUSES = new Set(["pending", "approved", "processing"]);

function toFiniteMoney(value: number | string | null | undefined): number {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function calculateVerificationOutstandingAmount(
  invoice: PaymentVerificationInvoiceInput,
): number {
  if (invoice.payment_status === "Done") return 0;
  return Math.max(toFiniteMoney(invoice.amount) - toFiniteMoney(invoice.amount_received), 0);
}

export function isSelectableUnpaidInvoice(invoice: PaymentVerificationInvoiceInput): boolean {
  if (invoice.is_deleted) return false;
  if (invoice.payment_status === "Done") return false;
  return calculateVerificationOutstandingAmount(invoice) > 0;
}

export function filterSelectableClientInvoices(
  clientId: string | null | undefined,
  invoices: PaymentVerificationInvoiceInput[],
): PaymentVerificationInvoiceInput[] {
  if (!clientId) return [];
  return invoices.filter(
    (invoice) => invoice.client_id === clientId && isSelectableUnpaidInvoice(invoice),
  );
}

export function getSelectedInvoiceIdForApproval(
  request: PaymentVerificationRequestInput,
  selectedInvoiceId: string | null | undefined,
): string | null {
  return request.invoice_id ?? selectedInvoiceId ?? null;
}

export function canApprovePaymentVerification(
  request: PaymentVerificationRequestInput,
  selectedInvoiceId: string | null | undefined,
): boolean {
  if (request.status !== "pending" && request.status !== "unresolved") return false;
  return !!getSelectedInvoiceIdForApproval(request, selectedInvoiceId);
}

/**
 * Mirrors the exact-amount rule enforced by approve_payment_verification_request():
 * the claimed amount must equal the invoice's current outstanding amount -
 * no partial payments, no overpayments, no silent conversion of a mismatch
 * into a full payment.
 */
export function claimedAmountMatchesOutstanding(
  claimedAmount: number | null | undefined,
  invoice: PaymentVerificationInvoiceInput,
): boolean {
  if (claimedAmount === null || claimedAmount === undefined) return false;
  if (!Number.isFinite(claimedAmount) || claimedAmount <= 0) return false;
  return claimedAmount === calculateVerificationOutstandingAmount(invoice);
}

export type ParsedPaidWhatsAppCommand = {
  amount: number;
  invoiceReference: string;
};

/**
 * Deterministic parser for the client payment-claim WhatsApp format:
 * "PAID <amount> <invoice_no>", e.g. "PAID 25000 INV-1023". Case-insensitive,
 * tolerant of extra whitespace, thousands separators (25,000) and an
 * optional RS/PKR currency prefix before the amount. Returns null for
 * anything that does not match exactly - this parser never guesses a
 * partial match, never uses OCR/AI, and never fuzzy-matches an invoice.
 */
export function parsePaidWhatsAppCommand(
  rawText: string | null | undefined,
): ParsedPaidWhatsAppCommand | null {
  if (!rawText) return null;
  const normalized = rawText.trim().replace(/\s+/g, " ");
  const match = /^PAID\s+(?:(?:RS|PKR)\.?\s+)?([\d,]+(?:\.\d+)?)\s+([A-Za-z0-9-]+)$/i.exec(
    normalized,
  );
  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return { amount, invoiceReference: match[2].toUpperCase() };
}

export function applyPaymentVerificationApprovalForTest(
  request: PaymentVerificationRequestInput,
  invoices: PaymentVerificationInvoiceInput[],
  reminders: PaymentVerificationReminderInput[],
  selectedInvoiceId: string | null,
) {
  const invoiceId = getSelectedInvoiceIdForApproval(request, selectedInvoiceId);
  if (!invoiceId) throw new Error("Invoice selection is required");

  const selectedInvoice = invoices.find((invoice) => invoice.id === invoiceId);
  if (
    !selectedInvoice ||
    selectedInvoice.client_id !== request.client_id ||
    !isSelectableUnpaidInvoice(selectedInvoice)
  ) {
    throw new Error("Selected invoice is not eligible for approval");
  }

  if (!claimedAmountMatchesOutstanding(request.claimed_amount, selectedInvoice)) {
    throw new Error("Claimed amount does not match invoice outstanding amount");
  }

  return {
    request: {
      ...request,
      invoice_id: selectedInvoice.id,
      status: "approved" as const,
    },
    invoices: invoices.map((invoice) =>
      invoice.id === selectedInvoice.id
        ? { ...invoice, payment_status: "Done", amount_received: toFiniteMoney(invoice.amount) }
        : invoice,
    ),
    reminders: reminders.map((reminder) =>
      reminder.invoice_id === selectedInvoice.id &&
      CANCELLABLE_REMINDER_STATUSES.has(reminder.status ?? "")
        ? { ...reminder, status: "cancelled" }
        : reminder,
    ),
  };
}

export function applyPaymentVerificationRejectionForTest(
  request: PaymentVerificationRequestInput,
  invoices: PaymentVerificationInvoiceInput[],
  reason: string,
) {
  if (!reason || reason.trim().length === 0) {
    throw new Error("A rejection reason is required");
  }

  return {
    request: { ...request, status: "rejected" as const, rejection_reason: reason },
    invoices: invoices.map((invoice) => ({ ...invoice })),
  };
}

export type PaymentVerificationApprovalEligibility = {
  canApprove: boolean;
  reason:
    | "ok"
    | "already_reviewed"
    | "unknown_sender"
    | "no_invoice_selected"
    | "amount_mismatch"
    | "invoice_not_selectable";
};

/**
 * UI-facing mirror of every check approve_payment_verification_request()
 * enforces server-side. The Approve button must never be enabled in a case
 * this function would reject - this only decides what's clickable, it
 * never substitutes for (or bypasses) the backend's own validation.
 */
export function evaluatePaymentVerificationApproval(
  request: PaymentVerificationRequestInput,
  selectedInvoiceId: string | null | undefined,
  invoices: PaymentVerificationInvoiceInput[],
): PaymentVerificationApprovalEligibility {
  if (request.status !== "pending" && request.status !== "unresolved") {
    return { canApprove: false, reason: "already_reviewed" };
  }
  if (!request.client_id) {
    return { canApprove: false, reason: "unknown_sender" };
  }

  const invoiceId = getSelectedInvoiceIdForApproval(request, selectedInvoiceId);
  if (!invoiceId) return { canApprove: false, reason: "no_invoice_selected" };

  const invoice = invoices.find((candidate) => candidate.id === invoiceId);
  if (!invoice || invoice.client_id !== request.client_id || !isSelectableUnpaidInvoice(invoice)) {
    return { canApprove: false, reason: "invoice_not_selectable" };
  }

  if (!claimedAmountMatchesOutstanding(request.claimed_amount, invoice)) {
    return { canApprove: false, reason: "amount_mismatch" };
  }

  return { canApprove: true, reason: "ok" };
}

/** Masks a phone number for display - never shows the full number in the UI. */
export function maskPhoneForDisplay(phone: string | null | undefined): string {
  if (!phone) return "-";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 3)}*******${digits.slice(-2)}`;
}

/** Truncates a long opaque provider message id for display, never the full value in a table cell. */
export function truncateMessageId(id: string | null | undefined): string {
  if (!id) return "-";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
