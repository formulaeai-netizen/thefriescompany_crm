import { loadWorkerConfig, safeConfigSummary } from "./config.js";
import { createWorkerSupabaseClient } from "./services/supabase.js";
import { DAILY_REMINDER_CRON, SCHEDULER_TIMEZONE } from "./services/scheduler.js";

async function main() {
  const config = loadWorkerConfig();
  const supabase = createWorkerSupabaseClient(config);
  const { data, error } = await supabase
    .from("invoice_reminder_settings")
    .select(
      "enabled,dry_run,manual_approval_required,pause_all,provider,automation_launch_date,timezone,maximum_reminders,maximum_daily_messages",
    )
    .limit(1)
    .single();

  if (error) throw new Error(`Reminder settings load failed: ${error.message}`);

  console.info("Reminder scheduler status", {
    cron: DAILY_REMINDER_CRON,
    schedulerTimezone: SCHEDULER_TIMEZONE,
    worker: safeConfigSummary(config),
    settings: data,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown scheduler status error";
  console.error("Reminder scheduler status failed", { error: message });
  process.exitCode = 1;
});
