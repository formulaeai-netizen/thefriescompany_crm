export type InvoiceOutstandingInput = {
  amount?: number | string | null;
  amount_received?: number | string | null;
  payment_status?: string | null;
  receiving_status?: string | null;
};

export type ReminderEligibilityInput = InvoiceOutstandingInput & {
  due_date?: string | null;
  is_deleted?: boolean | null;
};

export type ReminderIdempotencyInput = {
  idempotency_key?: string | null;
};

export type ReminderStage = "overdue_day_1" | "overdue_day_3" | "overdue_day_7" | "overdue_day_14";

export type ReminderSkipCode =
  | "paid"
  | "zero_outstanding"
  | "missing_due_date"
  | "not_overdue"
  | "missing_client"
  | "invalid_phone"
  | "opt_out"
  | "paused_client"
  | "duplicate"
  | "max_reminders_reached"
  | "before_launch_date"
  | "awaiting_receiving";

export type ReminderClientInput = {
  id?: string | null;
  legal_name?: string | null;
  phone?: string | null;
  phone_normalized?: string | null;
  whatsapp_opt_out?: boolean | null;
  reminders_paused?: boolean | null;
};

export type ReminderInvoiceInput = InvoiceOutstandingInput & {
  id: string;
  invoice_no?: string | null;
  client_id?: string | null;
  date?: string | null;
  delivery_date?: string | null;
  due_date?: string | null;
  is_deleted?: boolean | null;
  clients?: ReminderClientInput | ReminderClientInput[] | null;
};

export type ExistingReminderInput = {
  invoice_id?: string | null;
  reminder_stage?: string | null;
  idempotency_key?: string | null;
  status?: string | null;
};

export type ReminderEligibilityOptions = {
  today?: string | Date;
  automationLaunchDate?: string | null;
  maxRemindersPerInvoice?: number;
};

export type InvoiceReminderSettings = {
  enabled: boolean;
  dry_run: boolean;
  manual_approval_required: boolean;
  pause_all: boolean;
  provider: "whatsapp-web" | string;
  automation_launch_date: string | null;
  timezone: string;
  first_reminder_after_days: number;
  repeat_interval_days: number;
  maximum_reminders: number;
  maximum_daily_messages: number;
};

export type QueueMode = "dry_run" | "create_pending_queue";

export type ReminderPreviewRow = {
  invoice_id: string;
  invoice_no: string | null;
  client_id: string | null;
  client_name: string | null;
  due_date: string;
  days_overdue: number;
  reminder_stage: ReminderStage | null;
  outstanding_amount: number;
  original_phone: string | null;
  normalized_phone: string | null;
  idempotency_key: string;
  eligibility: "eligible" | "skipped";
  skip_reason: ReminderSkipCode | null;
};

export type PendingReminderInsert = {
  invoice_id: string;
  client_id: string | null;
  due_date_snapshot: string;
  outstanding_amount_snapshot: number;
  recipient_phone: string | null;
  normalized_recipient_phone: string;
  provider: "whatsapp-web";
  channel: "whatsapp";
  reminder_stage: ReminderStage;
  status: "pending";
  idempotency_key: string;
};

export type ReminderQueueReport = {
  mode: QueueMode;
  scanned_count: number;
  eligible_count: number;
  inserted_count: number;
  skipped_paid: number;
  skipped_zero_outstanding: number;
  skipped_missing_due_date: number;
  skipped_not_overdue: number;
  skipped_missing_client: number;
  skipped_invalid_phone: number;
  skipped_opt_out: number;
  skipped_paused_client: number;
  skipped_duplicate: number;
  skipped_max_reminders_reached: number;
  skipped_before_launch_date: number;
  sample_preview_rows: ReminderPreviewRow[];
};

export type QueueGenerationOptions = ReminderEligibilityOptions & {
  dryRunOnly?: boolean;
  createPendingQueue?: boolean;
  sampleLimit?: number;
};

export type QueueGenerationResult = ReminderQueueReport & {
  pending_rows: PendingReminderInsert[];
};

export const DEFAULT_INVOICE_REMINDER_SETTINGS: InvoiceReminderSettings = {
  enabled: false,
  dry_run: true,
  manual_approval_required: true,
  pause_all: true,
  provider: "whatsapp-web",
  automation_launch_date: null,
  timezone: "Asia/Karachi",
  first_reminder_after_days: 1,
  repeat_interval_days: 3,
  maximum_reminders: 4,
  maximum_daily_messages: 20,
};

function toFiniteMoney(value: number | string | null | undefined): number {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isoDateFromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toIsoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return isoDateFromUtc(value);

  const datePart = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;
}

function getReminderClient(client: ReminderInvoiceInput["clients"]): ReminderClientInput | null {
  if (Array.isArray(client)) return client[0] ?? null;
  return client ?? null;
}

function createPreviewRow(
  invoice: ReminderInvoiceInput,
  client: ReminderClientInput | null,
  dueDate: string | null,
  daysOverdue: number | null,
  reminderStage: ReminderStage | null,
  outstandingAmount: number,
  normalizedPhone: string | null,
  idempotencyKey: string,
  eligibility: "eligible" | "skipped",
  skipReason: ReminderSkipCode | null,
): ReminderPreviewRow {
  return {
    invoice_id: invoice.id,
    invoice_no: invoice.invoice_no ?? null,
    client_id: client?.id ?? invoice.client_id ?? null,
    client_name: client?.legal_name ?? null,
    due_date: dueDate ?? "",
    days_overdue: daysOverdue ?? 0,
    reminder_stage: reminderStage,
    outstanding_amount: outstandingAmount,
    original_phone: client?.phone ?? null,
    normalized_phone: normalizedPhone,
    idempotency_key: idempotencyKey,
    eligibility,
    skip_reason: skipReason,
  };
}

function addPreview(report: ReminderQueueReport, sampleLimit: number, row: ReminderPreviewRow) {
  if (report.sample_preview_rows.length < sampleLimit) report.sample_preview_rows.push(row);
}

export function addDaysToIsoDate(isoDate: string | null | undefined, days: number): string | null {
  if (!isoDate) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number.isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() + days);
  return isoDateFromUtc(date);
}

export function calculateInvoiceDueDate(deliveryDate: string | null | undefined): string | null {
  return addDaysToIsoDate(deliveryDate, 15);
}

export function calculateOutstandingAmount(invoice: InvoiceOutstandingInput): number {
  if (invoice.receiving_status === "awaiting_receiving") return 0;
  if (invoice.payment_status === "Done") return 0;
  return Math.max(toFiniteMoney(invoice.amount) - toFiniteMoney(invoice.amount_received), 0);
}

export function normalizePakistanWhatsappPhone(rawPhone: string | null | undefined): string | null {
  if (!rawPhone) return null;

  let digits = rawPhone.trim().replace(/[^\d+]/g, "");
  if (!digits) return null;

  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `92${digits.slice(1)}`;

  return /^923\d{9}$/.test(digits) ? digits : null;
}

export function calculateDaysOverdue(
  dueDate: string | null | undefined,
  today: string | Date = new Date(),
): number | null {
  const due = toIsoDate(dueDate);
  const todayIso = toIsoDate(today);
  if (!due || !todayIso) return null;

  const dueTime = Date.parse(`${due}T00:00:00.000Z`);
  const todayTime = Date.parse(`${todayIso}T00:00:00.000Z`);
  if (Number.isNaN(dueTime) || Number.isNaN(todayTime)) return null;

  return Math.floor((todayTime - dueTime) / 86400000);
}

export function selectReminderStage(daysOverdue: number): ReminderStage | null {
  if (daysOverdue < 1) return null;
  if (daysOverdue < 3) return "overdue_day_1";
  if (daysOverdue < 7) return "overdue_day_3";
  if (daysOverdue < 14) return "overdue_day_7";
  return "overdue_day_14";
}

export function createReminderIdempotencyKey(
  invoiceId: string,
  reminderStage: ReminderStage,
): string {
  return `invoice:${invoiceId}:stage:${reminderStage}`;
}

export function canModifyInvoiceReminderSettings(roles: string[]): boolean {
  return roles.includes("admin");
}

export function assertReminderSettingsAllowQueueCreation(settings: InvoiceReminderSettings): void {
  if (!settings.automation_launch_date) {
    throw new Error("Automation launch date must be set before creating pending reminders");
  }
  if (!settings.enabled) {
    throw new Error("Invoice reminder system is disabled");
  }
  if (settings.dry_run) {
    throw new Error("Dry-run mode is enabled; pending queue creation is blocked");
  }
  if (settings.pause_all) {
    throw new Error("All invoice reminders are paused");
  }
}

export function isInvoiceReminderEligible(
  invoice: ReminderEligibilityInput,
  today: Date = new Date(),
): boolean {
  if (invoice.is_deleted) return false;
  if (invoice.receiving_status === "awaiting_receiving") return false;
  if (invoice.payment_status !== "Not Done" && invoice.payment_status !== "Partial") return false;
  if (!invoice.due_date) return false;
  if (calculateOutstandingAmount(invoice) <= 0) return false;

  return invoice.due_date < isoDateFromUtc(today);
}

export function buildReminderQueueGeneration(
  invoices: ReminderInvoiceInput[],
  existingReminders: ExistingReminderInput[],
  options: QueueGenerationOptions = {},
): QueueGenerationResult {
  const dryRunOnly = options.dryRunOnly ?? true;
  const createPendingQueue = options.createPendingQueue ?? false;
  const mode = createPendingQueue && !dryRunOnly ? "create_pending_queue" : "dry_run";
  const maxRemindersPerInvoice = Math.max(0, options.maxRemindersPerInvoice ?? 4);
  const sampleLimit = Math.max(0, options.sampleLimit ?? 10);
  const today = options.today ?? new Date();
  const launchDate = toIsoDate(options.automationLaunchDate);

  const existingByInvoice = new Map<string, ExistingReminderInput[]>();
  const existingKeys = new Set<string>();

  for (const reminder of existingReminders) {
    if (reminder.idempotency_key) existingKeys.add(reminder.idempotency_key);
    if (!reminder.invoice_id) continue;

    const rows = existingByInvoice.get(reminder.invoice_id) ?? [];
    rows.push(reminder);
    existingByInvoice.set(reminder.invoice_id, rows);
  }

  const report: ReminderQueueReport = {
    mode,
    scanned_count: invoices.length,
    eligible_count: 0,
    inserted_count: 0,
    skipped_paid: 0,
    skipped_zero_outstanding: 0,
    skipped_missing_due_date: 0,
    skipped_not_overdue: 0,
    skipped_missing_client: 0,
    skipped_invalid_phone: 0,
    skipped_opt_out: 0,
    skipped_paused_client: 0,
    skipped_duplicate: 0,
    skipped_max_reminders_reached: 0,
    skipped_before_launch_date: 0,
    sample_preview_rows: [],
  };
  const pendingRows: PendingReminderInsert[] = [];

  for (const invoice of invoices) {
    if (invoice.is_deleted) continue;

    if (invoice.receiving_status === "awaiting_receiving") {
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          getReminderClient(invoice.clients),
          toIsoDate(invoice.due_date),
          calculateDaysOverdue(invoice.due_date, today),
          null,
          0,
          null,
          "",
          "skipped",
          "awaiting_receiving",
        ),
      );
      continue;
    }

    if (invoice.payment_status === "Done") {
      report.skipped_paid++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          getReminderClient(invoice.clients),
          toIsoDate(invoice.due_date),
          calculateDaysOverdue(invoice.due_date, today),
          null,
          0,
          null,
          "",
          "skipped",
          "paid",
        ),
      );
      continue;
    }

    const dueDate = toIsoDate(invoice.due_date);
    if (!dueDate) {
      report.skipped_missing_due_date++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          getReminderClient(invoice.clients),
          null,
          null,
          null,
          calculateOutstandingAmount(invoice),
          null,
          "",
          "skipped",
          "missing_due_date",
        ),
      );
      continue;
    }

    const daysOverdue = calculateDaysOverdue(dueDate, today);
    const stage = daysOverdue == null ? null : selectReminderStage(daysOverdue);
    if (!stage || daysOverdue == null) {
      report.skipped_not_overdue++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          getReminderClient(invoice.clients),
          dueDate,
          daysOverdue,
          null,
          calculateOutstandingAmount(invoice),
          null,
          "",
          "skipped",
          "not_overdue",
        ),
      );
      continue;
    }

    const outstandingAmount = calculateOutstandingAmount(invoice);
    if (outstandingAmount <= 0) {
      report.skipped_zero_outstanding++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          getReminderClient(invoice.clients),
          dueDate,
          daysOverdue,
          stage,
          outstandingAmount,
          null,
          createReminderIdempotencyKey(invoice.id, stage),
          "skipped",
          "zero_outstanding",
        ),
      );
      continue;
    }

    const client = getReminderClient(invoice.clients);
    if (!client?.id) {
      report.skipped_missing_client++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          null,
          dueDate,
          daysOverdue,
          stage,
          outstandingAmount,
          null,
          createReminderIdempotencyKey(invoice.id, stage),
          "skipped",
          "missing_client",
        ),
      );
      continue;
    }

    if (client.whatsapp_opt_out) {
      report.skipped_opt_out++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          client,
          dueDate,
          daysOverdue,
          stage,
          outstandingAmount,
          null,
          createReminderIdempotencyKey(invoice.id, stage),
          "skipped",
          "opt_out",
        ),
      );
      continue;
    }

    if (client.reminders_paused) {
      report.skipped_paused_client++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          client,
          dueDate,
          daysOverdue,
          stage,
          outstandingAmount,
          null,
          createReminderIdempotencyKey(invoice.id, stage),
          "skipped",
          "paused_client",
        ),
      );
      continue;
    }

    const normalizedPhone =
      normalizePakistanWhatsappPhone(client.phone_normalized) ??
      normalizePakistanWhatsappPhone(client.phone);
    if (!normalizedPhone) {
      report.skipped_invalid_phone++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          client,
          dueDate,
          daysOverdue,
          stage,
          outstandingAmount,
          null,
          createReminderIdempotencyKey(invoice.id, stage),
          "skipped",
          "invalid_phone",
        ),
      );
      continue;
    }

    if (launchDate) {
      const invoiceDate = toIsoDate(invoice.date) ?? toIsoDate(invoice.delivery_date);
      if (invoiceDate && invoiceDate < launchDate) {
        report.skipped_before_launch_date++;
        addPreview(
          report,
          sampleLimit,
          createPreviewRow(
            invoice,
            client,
            dueDate,
            daysOverdue,
            stage,
            outstandingAmount,
            normalizedPhone,
            createReminderIdempotencyKey(invoice.id, stage),
            "skipped",
            "before_launch_date",
          ),
        );
        continue;
      }
    }

    const existingForInvoice = existingByInvoice.get(invoice.id) ?? [];
    const idempotencyKey = createReminderIdempotencyKey(invoice.id, stage);
    if (
      existingKeys.has(idempotencyKey) ||
      existingForInvoice.some((row) => row.reminder_stage === stage)
    ) {
      report.skipped_duplicate++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          client,
          dueDate,
          daysOverdue,
          stage,
          outstandingAmount,
          normalizedPhone,
          idempotencyKey,
          "skipped",
          "duplicate",
        ),
      );
      continue;
    }

    if (existingForInvoice.length >= maxRemindersPerInvoice) {
      report.skipped_max_reminders_reached++;
      addPreview(
        report,
        sampleLimit,
        createPreviewRow(
          invoice,
          client,
          dueDate,
          daysOverdue,
          stage,
          outstandingAmount,
          normalizedPhone,
          idempotencyKey,
          "skipped",
          "max_reminders_reached",
        ),
      );
      continue;
    }

    const preview = createPreviewRow(
      invoice,
      client,
      dueDate,
      daysOverdue,
      stage,
      outstandingAmount,
      normalizedPhone,
      idempotencyKey,
      "eligible",
      null,
    );

    report.eligible_count++;
    addPreview(report, sampleLimit, preview);

    pendingRows.push({
      invoice_id: invoice.id,
      client_id: client.id,
      due_date_snapshot: dueDate,
      outstanding_amount_snapshot: outstandingAmount,
      recipient_phone: client.phone ?? null,
      normalized_recipient_phone: normalizedPhone,
      provider: "whatsapp-web",
      channel: "whatsapp",
      reminder_stage: stage,
      status: "pending",
      idempotency_key: idempotencyKey,
    });
  }

  return { ...report, pending_rows: pendingRows };
}

export function assertUniqueReminderIdempotencyKeys(rows: ReminderIdempotencyInput[]): void {
  const seen = new Set<string>();

  for (const row of rows) {
    const key = row.idempotency_key?.trim();
    if (!key) throw new Error("Reminder idempotency key is required");
    if (seen.has(key)) throw new Error(`Duplicate reminder idempotency key: ${key}`);
    seen.add(key);
  }
}
