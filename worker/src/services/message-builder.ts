export type ReminderMessageInput = {
  clientName: string;
  invoiceNumber: string;
  dueDate: string;
  outstandingAmount: number;
};

function formatMoney(amount: number): string {
  return amount.toLocaleString("en-PK");
}

/** Prompt 3, item C: every due reminder must clearly include the exact PAID command. */
export function buildOverdueInvoiceMessage(input: ReminderMessageInput): string {
  return [
    `Assalam-o-Alaikum ${input.clientName}.`,
    "",
    `Aapki invoice ${input.invoiceNumber} ka outstanding amount Rs. ${formatMoney(input.outstandingAmount)} due hai.`,
    "",
    "Payment karne ke baad exact reply karein:",
    "",
    `PAID ${Math.round(input.outstandingAmount)} ${input.invoiceNumber}`,
  ].join("\n");
}

export type EarlyPaymentReplyInput = {
  clientName: string;
  invoiceNumber: string;
  outstandingAmount: number;
};

/** Prompt 3, item B: sent when a client has exactly one open invoice. Never marks anything paid. */
export function buildEarlyPaymentReply(input: EarlyPaymentReplyInput): string {
  return [
    `Assalam-o-Alaikum ${input.clientName}.`,
    "",
    `Aapki current invoice ${input.invoiceNumber} ka outstanding amount Rs. ${formatMoney(input.outstandingAmount)} hai.`,
    "",
    "Payment confirmation ke liye exact reply karein:",
    "",
    `PAID ${Math.round(input.outstandingAmount)} ${input.invoiceNumber}`,
  ].join("\n");
}

/** Sent when a known client has zero open invoices - never fabricates one. */
export function buildNoOutstandingInvoiceReply(clientName: string): string {
  return [
    `Assalam-o-Alaikum ${clientName}.`,
    "",
    "Is waqt aapki koi outstanding invoice nahi hai.",
  ].join("\n");
}

/** Sent when a known client has more than one open invoice - never guesses which one. */
export function buildMultipleOpenInvoicesReply(clientName: string): string {
  return [
    `Assalam-o-Alaikum ${clientName}.`,
    "",
    "Aapki ek se zyada outstanding invoices hain.",
    "Payment confirm karne ke liye, apni invoice ya reminder message mein diya gaya exact Invoice ID istemal karein:",
    "",
    "PAID <Amount> <Invoice-ID>",
  ].join("\n");
}

/** Guidance sent when a message looks like an attempted PAID command but does not match the required format. */
export function buildInvalidPaidCommandReply(): string {
  return [
    "Payment confirm karne ke liye exact format mein reply karein:",
    "",
    "PAID <Amount> <Invoice-ID>",
    "",
    "Misaal: PAID 25000 INV-1023",
  ].join("\n");
}

export type OperationalAlertMessageInput = {
  alertType: string;
  severity: string;
  message: string;
  sourceType: string;
  sourceId: string;
  expectedValue: number | null;
  actualValue: number | null;
  varianceValue: number | null;
  unit: string | null;
  createdAt: string;
};

export function buildOperationalAlertMessage(input: OperationalAlertMessageInput): string {
  const lines = [
    `Operational Alert (${input.severity.toUpperCase()}): ${input.alertType}`,
    input.message,
  ];

  if (input.expectedValue != null && input.actualValue != null) {
    const unit = input.unit ?? "";
    lines.push(
      `Expected: ${input.expectedValue}${unit} | Actual: ${input.actualValue}${unit} | Variance: ${input.varianceValue}${unit}`,
    );
  }

  lines.push(`Reference: ${input.sourceType} ${input.sourceId}`);
  lines.push(`Time: ${input.createdAt}`);

  return lines.join("\n");
}

function formatKarachiTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-PK", {
      timeZone: "Asia/Karachi",
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/**
 * Prompt 3, item D: stock-audit-specific template. operational_alerts has
 * no dedicated item_name column - the raising function
 * (reconcile_and_lock_stock_audit) already embeds the item name and audit
 * type into `message` (e.g. "Physical stock variance detected for <item>
 * during <audit_type> audit"), so it is surfaced here as the alert detail
 * line rather than duplicated as a separate structured field.
 */
export function buildStockAuditAlertMessage(input: OperationalAlertMessageInput): string {
  const unit = input.unit ?? "";
  const lines = [
    "Stock Audit Alert",
    "",
    input.message,
    "",
    `System quantity: ${input.expectedValue ?? "-"}${unit}`,
    `Physical/Reconciled quantity: ${input.actualValue ?? "-"}${unit}`,
    `Difference: ${input.varianceValue ?? "-"}${unit}`,
    `Status: ${input.alertType}`,
    `Audit time: ${formatKarachiTime(input.createdAt)}`,
    `Reference: ${input.sourceType} ${input.sourceId}`,
  ];
  return lines.join("\n");
}

export type CreditPurchaseReminderMessageInput = {
  itemName: string;
  supplierName: string;
  amountDue: number;
  dueAt: string;
  reference: string;
};

/** Prompt 3, item E. Send target comes from whatsapp_routing_numbers.flow_key = 'credit_purchase_reminders'. */
export function buildCreditPurchaseReminderMessage(
  input: CreditPurchaseReminderMessageInput,
): string {
  return [
    "Credit Payment Due",
    "",
    `Product: ${input.itemName}`,
    `Supplier: ${input.supplierName}`,
    `Amount: Rs. ${formatMoney(input.amountDue)}`,
    `Due: ${formatKarachiTime(input.dueAt)}`,
    `Reference: ${input.reference}`,
  ].join("\n");
}
