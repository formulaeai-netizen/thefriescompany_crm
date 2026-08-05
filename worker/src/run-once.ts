import { loadWorkerConfig } from "./config.js";
import { MetaCloudProvider } from "./providers/meta-cloud.provider.js";
import type { WhatsAppProvider } from "./providers/whatsapp-provider.js";
import { WhatsAppWebProvider } from "./providers/whatsapp-web.provider.js";
import {
  logReminderRunReport,
  startQueueProcessor,
  type ReminderRunMode,
} from "./services/queue-processor.js";
import { createWorkerSupabaseClient } from "./services/supabase.js";

const LIVE_CONFIRMATION = "SEND_LIVE_WHATSAPP_REMINDERS";

function createProvider(config: ReturnType<typeof loadWorkerConfig>): WhatsAppProvider {
  if (config.provider === "meta-cloud") return new MetaCloudProvider(config.allowRealSend);
  return new WhatsAppWebProvider({
    sessionPath: config.sessionPath,
    allowRealSend: config.allowRealSend,
  });
}

function readMode(): ReminderRunMode {
  if (process.argv.includes("--live")) return "live";
  return "dry";
}

function readConfirmation(): string | null {
  return process.argv.find((arg) => arg.startsWith("--confirm="))?.split("=", 2)[1] ?? null;
}

async function main() {
  const mode = readMode();
  if (mode === "live" && readConfirmation() !== LIVE_CONFIRMATION) {
    throw new Error(`run-once-live requires --confirm=${LIVE_CONFIRMATION}`);
  }

  const config = loadWorkerConfig();
  if (mode === "live" && !config.allowRealSend) {
    throw new Error("run-once-live requires WHATSAPP_ALLOW_REAL_SEND=true");
  }

  const supabase = createWorkerSupabaseClient(config);
  const provider = createProvider(config);

  try {
    if (mode === "live") await provider.initialize();
    const report = await startQueueProcessor(supabase, provider, config, mode);
    logReminderRunReport(report);
  } finally {
    await provider.disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown run-once error";
  console.error("Reminder run-once failed", { error: message });
  process.exitCode = 1;
});
