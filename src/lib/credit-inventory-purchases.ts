export type CreditPurchasePaymentMode = "cash" | "credit";

export type CreditInventoryPurchaseInput = {
  status: "unpaid" | "paid" | "cancelled";
  due_at: string;
  reminder_lead_hours: number;
  reminder_queued_at?: string | null;
};

/**
 * Mirrors public.claim_due_credit_purchase_reminders()'s eligibility
 * condition: unpaid, not yet queued, and due within its own
 * reminder_lead_hours window. Pure/read-only - never claims/mutates
 * anything itself (the DB RPC is the only place that actually queues).
 */
export function isCreditPurchaseReminderDue(
  purchase: CreditInventoryPurchaseInput,
  now: Date = new Date(),
): boolean {
  if (purchase.status !== "unpaid") return false;
  if (purchase.reminder_queued_at) return false;

  const dueAt = new Date(purchase.due_at);
  if (Number.isNaN(dueAt.getTime())) return false;

  const windowEnd = new Date(now.getTime() + purchase.reminder_lead_hours * 3600_000);
  return dueAt.getTime() <= windowEnd.getTime();
}

export function selectDueCreditPurchaseReminders(
  purchases: CreditInventoryPurchaseInput[],
  now: Date = new Date(),
): CreditInventoryPurchaseInput[] {
  return purchases.filter((p) => isCreditPurchaseReminderDue(p, now));
}

/** An unpaid purchase past its due date/time - used to visually flag overdue rows. Paid/cancelled rows are never overdue. */
export function isCreditPurchaseOverdue(
  purchase: Pick<CreditInventoryPurchaseInput, "status" | "due_at">,
  now: Date = new Date(),
): boolean {
  if (purchase.status !== "unpaid") return false;
  const dueAt = new Date(purchase.due_at);
  if (Number.isNaN(dueAt.getTime())) return false;
  return dueAt.getTime() < now.getTime();
}

export type CreditPurchaseFormInput = {
  supplier_name: string;
  item_name_snapshot: string;
  amount_due: number | string;
  due_at: string;
  reminder_lead_hours?: number | string;
};

export type CreditPurchaseFormErrors = Partial<Record<keyof CreditPurchaseFormInput, string>>;

/**
 * Mirrors the server-side Zod schema in credit-purchases.functions.ts, so
 * the create/edit form can show inline errors before ever calling the
 * server function - the server function remains the authoritative check.
 */
export function validateCreditPurchaseFormInput(
  input: CreditPurchaseFormInput,
): CreditPurchaseFormErrors {
  const errors: CreditPurchaseFormErrors = {};

  if (!input.supplier_name || !input.supplier_name.trim()) {
    errors.supplier_name = "Supplier name is required";
  }
  if (!input.item_name_snapshot || !input.item_name_snapshot.trim()) {
    errors.item_name_snapshot = "Item name is required";
  }

  const amount = typeof input.amount_due === "number" ? input.amount_due : Number(input.amount_due);
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount_due = "Amount due must be a positive number";
  }

  if (!input.due_at || Number.isNaN(new Date(input.due_at).getTime())) {
    errors.due_at = "A valid due date/time is required";
  }

  if (input.reminder_lead_hours !== undefined && input.reminder_lead_hours !== "") {
    const leadHours =
      typeof input.reminder_lead_hours === "number"
        ? input.reminder_lead_hours
        : Number(input.reminder_lead_hours);
    if (!Number.isInteger(leadHours) || leadHours <= 0 || leadHours > 720) {
      errors.reminder_lead_hours = "Reminder lead hours must be a whole number between 1 and 720";
    }
  }

  return errors;
}
