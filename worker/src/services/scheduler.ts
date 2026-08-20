import cron from "node-cron";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../config.js";
import type { WhatsAppProvider } from "../providers/whatsapp-provider.js";
import {
  logAlertDispatchReport,
  runAlertDispatchWorkflow,
  SupabaseAlertDispatchRepository,
} from "./alert-dispatch.js";
import {
  logCreditPurchaseDispatchReport,
  runCreditPurchaseDispatchWorkflow,
  SupabaseCreditPurchaseDispatchRepository,
} from "./credit-purchase-dispatch.js";
import {
  dispatchPendingPushNotifications,
  logPushDispatchReport,
} from "./push-notification-dispatch.js";
import { logReminderRunReport, startQueueProcessor } from "./queue-processor.js";
import { dispatchOperationsBrief, logOperationsBriefReport } from "./operations-briefs.js";

export const SCHEDULER_TIMEZONE = "Asia/Karachi";
export const DAILY_REMINDER_CRON = "0 11 * * *";
export const ALERT_DISPATCH_CRON = "*/30 * * * *";
export const CREDIT_REMINDER_CRON = "0 * * * *";
export const PUSH_NOTIFICATION_CRON = "* * * * *";

export type SchedulerHandle = {
  stop(): void;
};

/**
 * Wraps a workflow so that (a) a run already in progress is never started
 * a second time in parallel (overlap prevention), and (b) any error the
 * workflow throws is caught and logged here rather than propagating -
 * one failed workflow must never crash the whole worker process or block
 * the other scheduled workflows.
 */
export function createOverlapGuardedRunner(
  name: string,
  fn: () => Promise<void>,
): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) {
      console.warn(`${name} run skipped - previous run still in progress`);
      return;
    }
    running = true;
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unknown ${name} error`;
      console.error(`${name} run failed`, { error: message });
    } finally {
      running = false;
    }
  };
}

export function buildSchedulerHandle(tasks: Array<{ stop(): void }>): SchedulerHandle {
  return {
    stop: () => {
      for (const task of tasks) task.stop();
    },
  };
}

/**
 * Integrates all three worker workflows (invoice reminders, operational
 * alert dispatch, credit-purchase due reminders) into one persistent
 * scheduler. Each workflow still requires its own explicit DB/env safety
 * gates (invoice_reminder_settings.enabled, operational_alert_dispatch_settings.enabled,
 * a configured whatsapp_routing_numbers recipient, WHATSAPP_ALLOW_REAL_SEND)
 * before it can actually send anything - scheduling a workflow here never
 * bypasses those gates.
 */
export function startWorkerScheduler(
  supabase: SupabaseClient,
  provider: WhatsAppProvider,
  config: WorkerConfig,
): SchedulerHandle {
  const runReminders = createOverlapGuardedRunner("Invoice reminder workflow", async () => {
    const report = await startQueueProcessor(
      supabase,
      provider,
      config,
      config.dryRun ? "dry" : "live",
    );
    logReminderRunReport(report);
  });

  const runAlerts = createOverlapGuardedRunner("Operational alert dispatch workflow", async () => {
    const report = await runAlertDispatchWorkflow({
      repository: new SupabaseAlertDispatchRepository(supabase),
      provider,
      config,
      mode: config.dryRun ? "dry" : "live",
    });
    logAlertDispatchReport(report);
  });

  const runCreditReminders = createOverlapGuardedRunner(
    "Credit purchase reminder workflow",
    async () => {
      const report = await runCreditPurchaseDispatchWorkflow({
        repository: new SupabaseCreditPurchaseDispatchRepository(supabase),
        provider,
        config,
        mode: config.dryRun ? "dry" : "live",
      });
      logCreditPurchaseDispatchReport(report);
    },
  );
  const runPushNotifications = createOverlapGuardedRunner(
    "PWA push notification workflow",
    async () => {
      const report = await dispatchPendingPushNotifications(supabase, config);
      logPushDispatchReport(report);
    },
  );
  const runMorningOperationsBrief = createOverlapGuardedRunner(
    "Morning operations brief workflow",
    async () => {
      const report = await dispatchOperationsBrief(supabase, config, "morning");
      logOperationsBriefReport(report);
    },
  );
  const runEveningOperationsBrief = createOverlapGuardedRunner(
    "Evening operations brief workflow",
    async () => {
      const report = await dispatchOperationsBrief(supabase, config, "evening");
      logOperationsBriefReport(report);
    },
  );

  const whatsappTasks = config.automationEnabled
    ? [
        cron.schedule(DAILY_REMINDER_CRON, runReminders, {
          timezone: SCHEDULER_TIMEZONE,
        }),
        cron.schedule(ALERT_DISPATCH_CRON, runAlerts, { timezone: SCHEDULER_TIMEZONE }),
        cron.schedule(CREDIT_REMINDER_CRON, runCreditReminders, {
          timezone: SCHEDULER_TIMEZONE,
        }),
      ]
    : [];
  const pushTask = config.webPushEnabled
    ? cron.schedule(PUSH_NOTIFICATION_CRON, runPushNotifications, {
        timezone: SCHEDULER_TIMEZONE,
      })
    : null;
  const morningBriefTask = config.operationsBriefEnabled
    ? cron.schedule(config.operationsBriefMorningCron, runMorningOperationsBrief, {
        timezone: SCHEDULER_TIMEZONE,
      })
    : null;
  const eveningBriefTask = config.operationsBriefEnabled
    ? cron.schedule(config.operationsBriefEveningCron, runEveningOperationsBrief, {
        timezone: SCHEDULER_TIMEZONE,
      })
    : null;

  console.info("Worker scheduler started", {
    reminderCron: config.automationEnabled ? DAILY_REMINDER_CRON : "disabled",
    alertCron: config.automationEnabled ? ALERT_DISPATCH_CRON : "disabled",
    creditReminderCron: config.automationEnabled ? CREDIT_REMINDER_CRON : "disabled",
    pushNotificationCron: pushTask ? PUSH_NOTIFICATION_CRON : "disabled",
    morningBriefCron: morningBriefTask ? config.operationsBriefMorningCron : "disabled",
    eveningBriefCron: eveningBriefTask ? config.operationsBriefEveningCron : "disabled",
    aiWatchdogScheduler: config.aiWatchdogSchedulerEnabled ? "configured-disabled" : "disabled",
    timezone: SCHEDULER_TIMEZONE,
  });

  return buildSchedulerHandle([
    ...whatsappTasks,
    ...(pushTask ? [pushTask] : []),
    ...(morningBriefTask ? [morningBriefTask] : []),
    ...(eveningBriefTask ? [eveningBriefTask] : []),
  ]);
}
