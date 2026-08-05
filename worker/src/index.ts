import { loadWorkerConfig, safeConfigSummary } from "./config.js";
import { MetaCloudProvider } from "./providers/meta-cloud.provider.js";
import type { WhatsAppProvider } from "./providers/whatsapp-provider.js";
import { WhatsAppWebProvider } from "./providers/whatsapp-web.provider.js";
import { createWorkerSupabaseClient } from "./services/supabase.js";
import { buildWorkerStatus, logWorkerStatus } from "./services/worker-status.js";
import { startWorkerScheduler, type SchedulerHandle } from "./services/scheduler.js";
import {
  startInboundPaymentListener,
  SupabaseInboundPaymentRepository,
} from "./services/inbound-payment-confirmations.js";

function createProvider(config: ReturnType<typeof loadWorkerConfig>): WhatsAppProvider {
  if (config.provider === "meta-cloud") return new MetaCloudProvider(config.allowRealSend);
  return new WhatsAppWebProvider({
    sessionPath: config.sessionPath,
    allowRealSend: config.allowRealSend,
  });
}

async function main() {
  const config = loadWorkerConfig();
  console.info("Worker config loaded", safeConfigSummary(config));

  const supabase = createWorkerSupabaseClient(config);
  const provider = createProvider(config);
  let scheduler: SchedulerHandle | null = null;
  let stopInboundListener: (() => void) | null = null;

  const shutdown = async (signal: string) => {
    console.info(`${signal} received. Stopping scheduler and disconnecting provider...`);
    scheduler?.stop();
    stopInboundListener?.();
    await provider.disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await provider.initialize();
  const whatsappClient = (provider as any).client;
  if (whatsappClient) {
    stopInboundListener = startInboundPaymentListener(
      whatsappClient,
      new SupabaseInboundPaymentRepository(supabase),
      provider,
    );
    console.info("Inbound payment confirmation listener started");
  }
  logWorkerStatus(
    buildWorkerStatus(provider.getStatus(), {
      automationEnabled: config.automationEnabled,
      dryRun: config.dryRun,
      allowRealSend: config.allowRealSend,
    }),
  );

  scheduler = startWorkerScheduler(supabase, provider, config);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown worker startup error";
  console.error("Worker failed to start", { error: message });
  process.exitCode = 1;
});
