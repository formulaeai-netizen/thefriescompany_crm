import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  DEFAULT_INVOICE_REMINDER_SETTINGS,
  assertReminderSettingsAllowQueueCreation,
  buildReminderQueueGeneration,
  type ExistingReminderInput,
  type InvoiceReminderSettings,
  type ReminderInvoiceInput,
} from "@/lib/invoice-reminders";

const queueSchema = z
  .object({
    dry_run_only: z.boolean().default(true),
    create_pending_queue: z.boolean().default(false),
    sample_limit: z.number().int().min(0).max(50).default(10),
    second_confirmation: z.boolean().default(false),
  })
  .refine((data) => !(data.dry_run_only && data.create_pending_queue), {
    message: "Use dry_run_only or create_pending_queue, not both",
  });

const updateSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  pause_all: z.boolean().optional(),
  automation_launch_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

function normalizeSettings(row: any): InvoiceReminderSettings {
  return {
    ...DEFAULT_INVOICE_REMINDER_SETTINGS,
    enabled: !!row?.enabled,
    dry_run: row?.dry_run ?? true,
    manual_approval_required: row?.manual_approval_required ?? true,
    pause_all: row?.pause_all ?? true,
    provider: row?.provider ?? "whatsapp-web",
    automation_launch_date: row?.automation_launch_date ?? null,
    timezone: row?.timezone ?? "Asia/Karachi",
    first_reminder_after_days: Number(row?.first_reminder_after_days ?? 1),
    repeat_interval_days: Number(row?.repeat_interval_days ?? 3),
    maximum_reminders: Number(row?.maximum_reminders ?? 4),
    maximum_daily_messages: Number(row?.maximum_daily_messages ?? 20),
  };
}

async function assertAdmin(ctx: any) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });

  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden");
}

async function readSettings(ctx: any): Promise<{
  settings: InvoiceReminderSettings;
  settingsId: string | null;
  migrationRequired: boolean;
}> {
  const { data, error } = await (ctx.supabase as any)
    .from("invoice_reminder_settings")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "42P01" || /invoice_reminder_settings/i.test(error.message ?? "")) {
      return {
        settings: DEFAULT_INVOICE_REMINDER_SETTINGS,
        settingsId: null,
        migrationRequired: true,
      };
    }
    throw new Error(`Reminder settings load failed: ${error.message}`);
  }

  return {
    settings: normalizeSettings(data),
    settingsId: data?.id ?? null,
    migrationRequired: !data,
  };
}

export const getInvoiceReminderSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const result = await readSettings(context);
    return {
      settings: result.settings,
      migration_required: result.migrationRequired,
    };
  });

export const updateInvoiceReminderSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSettingsSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const current = await readSettings(context);
    if (current.migrationRequired || !current.settingsId) {
      throw new Error("Invoice reminder settings migration has not been applied");
    }

    const { error } = await (context.supabase as any)
      .from("invoice_reminder_settings")
      .update(data)
      .eq("id", current.settingsId);

    if (error) throw new Error(`Reminder settings update failed: ${error.message}`);
    return { ok: true };
  });

export const listPendingInvoiceReminders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("invoice_reminders")
      .select(
        "id, invoice_id, client_id, due_date_snapshot, outstanding_amount_snapshot, recipient_phone, normalized_recipient_phone, reminder_stage, status, created_at, invoices(invoice_no), clients(legal_name)",
      )
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(`Pending reminders load failed: ${error.message}`);
    return data ?? [];
  });

export const generateInvoiceReminderQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => queueSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const settingsResult = await readSettings(context);
    if (settingsResult.migrationRequired) {
      throw new Error("Invoice reminder settings migration has not been applied");
    }

    const settings = settingsResult.settings;
    if (data.create_pending_queue) {
      if (!data.second_confirmation) throw new Error("Second confirmation is required");
      assertReminderSettingsAllowQueueCreation(settings);
    }

    const { data: invoiceRows, error: invoiceError } = await (context.supabase as any)
      .from("invoices")
      .select(
        "id, invoice_no, client_id, date, delivery_date, due_date, amount, amount_received, payment_status, receiving_status, is_deleted, clients(id, legal_name, phone, phone_normalized, whatsapp_opt_out, reminders_paused)",
      )
      .or("is_deleted.is.null,is_deleted.eq.false");

    if (invoiceError) throw new Error(`Invoice scan failed: ${invoiceError.message}`);

    const invoices = (invoiceRows ?? []) as ReminderInvoiceInput[];
    const invoiceIds = invoices.map((invoice) => invoice.id);

    let existingReminders: ExistingReminderInput[] = [];
    if (invoiceIds.length > 0) {
      const { data: reminderRows, error: reminderError } = await (context.supabase as any)
        .from("invoice_reminders")
        .select("invoice_id, reminder_stage, idempotency_key, status")
        .in("invoice_id", invoiceIds);

      if (reminderError) throw new Error(`Reminder scan failed: ${reminderError.message}`);
      existingReminders = (reminderRows ?? []) as ExistingReminderInput[];
    }

    const result = buildReminderQueueGeneration(invoices, existingReminders, {
      dryRunOnly: data.dry_run_only,
      createPendingQueue: data.create_pending_queue,
      automationLaunchDate: settings.automation_launch_date,
      maxRemindersPerInvoice: settings.maximum_reminders,
      sampleLimit: data.sample_limit,
    });

    if (data.create_pending_queue) {
      const rowsToInsert = result.pending_rows.slice(0, settings.maximum_daily_messages);
      if (rowsToInsert.length > 0) {
        const { error: insertError } = await (context.supabase as any)
          .from("invoice_reminders")
          .insert(rowsToInsert);

        if (insertError) throw new Error(`Pending queue insert failed: ${insertError.message}`);
      }

      result.inserted_count = rowsToInsert.length;
    }

    const { pending_rows, ...report } = result;
    return {
      ...report,
      settings: {
        enabled: settings.enabled,
        dry_run: settings.dry_run,
        pause_all: settings.pause_all,
        provider: settings.provider,
        automation_launch_date: settings.automation_launch_date,
        maximum_reminders: settings.maximum_reminders,
        maximum_daily_messages: settings.maximum_daily_messages,
      },
    };
  });
