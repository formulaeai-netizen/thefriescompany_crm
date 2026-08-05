import type { WhatsAppProviderStatus } from "../providers/whatsapp-provider.js";

export type WorkerStatus = WhatsAppProviderStatus & {
  automationEnabled: boolean;
  dryRun: boolean;
  allowRealSend: boolean;
};

export function buildWorkerStatus(
  providerStatus: WhatsAppProviderStatus,
  safety: Pick<WorkerStatus, "automationEnabled" | "dryRun" | "allowRealSend">,
): WorkerStatus {
  return {
    ...providerStatus,
    ...safety,
    lastHeartbeat: new Date().toISOString(),
  };
}

export function logWorkerStatus(status: WorkerStatus): void {
  console.info("Worker status", {
    provider: status.provider,
    connected: status.connected,
    qrRequired: status.qrRequired,
    lastHeartbeat: status.lastHeartbeat,
    lastConnectedAt: status.lastConnectedAt,
    lastError: status.lastError,
    automationEnabled: status.automationEnabled,
    dryRun: status.dryRun,
    allowRealSend: status.allowRealSend,
  });
}
