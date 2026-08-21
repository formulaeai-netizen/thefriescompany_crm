import { loadWorkerConfig, safeConfigSummary } from "./config.js";
import { DisabledWhatsAppProvider } from "./providers/disabled-whatsapp.provider.js";
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
import {
  startInboundExpenseListener,
  SupabaseExpenseIntakeRepository,
} from "./services/inbound-expense-intake.js";
import {
  startInboundCustomerOrderListener,
  SupabaseCustomerOrderRepository,
} from "./services/inbound-customer-orders.js";

const WORKER_KEEP_ALIVE_MS = 60_000;

function createProvider(config: ReturnType<typeof loadWorkerConfig>): WhatsAppProvider {
  if (!config.automationEnabled) return new DisabledWhatsAppProvider();
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
  let stopExpenseIntakeListener: (() => void) | null = null;
  let stopCustomerOrderListener: (() => void) | null = null;
  const keepAlive = setInterval(() => undefined, WORKER_KEEP_ALIVE_MS);

  const shutdown = async (signal: string) => {
    console.info(`${signal} received. Stopping scheduler and disconnecting provider...`);
    clearInterval(keepAlive);
    scheduler?.stop();
    stopInboundListener?.();
    stopExpenseIntakeListener?.();
    stopCustomerOrderListener?.();
    await provider.disconnect();
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await provider.initialize();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown WhatsApp provider startup error";
    console.error("WhatsApp provider initialization failed; worker will remain online without WhatsApp", {
      error: message,
    });
  }
  const whatsappClient = (provider as any).client;
  if (config.automationEnabled && whatsappClient) {
    stopInboundListener = startInboundPaymentListener(
      whatsappClient,
      new SupabaseInboundPaymentRepository(supabase),
      provider,
    );
    console.info("Inbound payment confirmation listener started");

    stopExpenseIntakeListener = startInboundExpenseListener(
      whatsappClient,
      new SupabaseExpenseIntakeRepository(supabase),
      provider,
    );
    console.info("Inbound trusted expense intake listener started");
    stopCustomerOrderListener = startInboundCustomerOrderListener(
      whatsappClient,
      new SupabaseCustomerOrderRepository(supabase),
      provider,
    );
    console.info("Inbound customer order listener started");
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
