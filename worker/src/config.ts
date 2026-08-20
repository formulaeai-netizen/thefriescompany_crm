import "dotenv/config";
import path from "node:path";

export type WhatsAppProviderName = "whatsapp-web" | "meta-cloud";

export type WorkerConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  provider: WhatsAppProviderName;
  automationEnabled: boolean;
  dryRun: boolean;
  allowRealSend: boolean;
  webPushEnabled: boolean;
  webPushDryRun: boolean;
  webPushVapidPublicKey: string | null;
  webPushVapidPrivateKey: string | null;
  webPushSubject: string | null;
  operationsBriefEnabled: boolean;
  operationsBriefMorningCron: string;
  operationsBriefEveningCron: string;
  aiWatchdogSchedulerEnabled: boolean;
  sessionPath: string;
  messageDelayMs: number;
  maxSendRetries: number;
};

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be either true or false`);
}

function readProvider(): WhatsAppProviderName {
  const raw = process.env.WHATSAPP_PROVIDER ?? "whatsapp-web";
  if (raw === "whatsapp-web" || raw === "meta-cloud") return raw;
  throw new Error("WHATSAPP_PROVIDER must be whatsapp-web or meta-cloud");
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readNonNegativeInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
  return value;
}

export function loadWorkerConfig(): WorkerConfig {
  const sessionPath = process.env.WHATSAPP_SESSION_PATH?.trim() || ".worker-data/whatsapp-session";

  return {
    supabaseUrl: requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    provider: readProvider(),
    automationEnabled: readBoolean("WHATSAPP_AUTOMATION_ENABLED", false),
    dryRun: readBoolean("WHATSAPP_DRY_RUN", true),
    allowRealSend: readBoolean("WHATSAPP_ALLOW_REAL_SEND", false),
    webPushEnabled: readBoolean("WEB_PUSH_ENABLED", false),
    webPushDryRun: readBoolean("WEB_PUSH_DRY_RUN", true),
    webPushVapidPublicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() || null,
    webPushVapidPrivateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim() || null,
    webPushSubject: process.env.WEB_PUSH_SUBJECT?.trim() || null,
    operationsBriefEnabled: readBoolean("OPERATIONS_BRIEF_ENABLED", false),
    operationsBriefMorningCron: process.env.OPERATIONS_BRIEF_MORNING_CRON?.trim() || "0 9 * * *",
    operationsBriefEveningCron: process.env.OPERATIONS_BRIEF_EVENING_CRON?.trim() || "0 20 * * *",
    aiWatchdogSchedulerEnabled: readBoolean("AI_WATCHDOG_SCHEDULER_ENABLED", false),
    sessionPath: path.resolve(process.cwd(), sessionPath),
    messageDelayMs: readNonNegativeInteger("WHATSAPP_MESSAGE_DELAY_MS", 5000),
    maxSendRetries: readNonNegativeInteger("WHATSAPP_MAX_SEND_RETRIES", 2),
  };
}

export function safeConfigSummary(config: WorkerConfig) {
  return {
    supabaseUrlConfigured: Boolean(config.supabaseUrl),
    serviceRoleKeyConfigured: Boolean(config.supabaseServiceRoleKey),
    provider: config.provider,
    automationEnabled: config.automationEnabled,
    dryRun: config.dryRun,
    allowRealSend: config.allowRealSend,
    webPushEnabled: config.webPushEnabled,
    webPushDryRun: config.webPushDryRun,
    webPushVapidConfigured: Boolean(
      config.webPushVapidPublicKey && config.webPushVapidPrivateKey && config.webPushSubject,
    ),
    operationsBriefEnabled: config.operationsBriefEnabled,
    operationsBriefMorningCron: config.operationsBriefEnabled
      ? config.operationsBriefMorningCron
      : "disabled",
    operationsBriefEveningCron: config.operationsBriefEnabled
      ? config.operationsBriefEveningCron
      : "disabled",
    aiWatchdogSchedulerEnabled: config.aiWatchdogSchedulerEnabled,
    sessionPath: config.sessionPath,
    messageDelayMs: config.messageDelayMs,
    maxSendRetries: config.maxSendRetries,
  };
}
