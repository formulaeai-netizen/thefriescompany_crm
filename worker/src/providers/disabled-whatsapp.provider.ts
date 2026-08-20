import type {
  WhatsAppMessage,
  WhatsAppProvider,
  WhatsAppProviderStatus,
  WhatsAppSendResult,
} from "./whatsapp-provider.js";

export class DisabledWhatsAppProvider implements WhatsAppProvider {
  async initialize(): Promise<void> {}

  async disconnect(): Promise<void> {}

  getStatus(): WhatsAppProviderStatus {
    return {
      provider: "disabled",
      connected: false,
      qrRequired: false,
      lastHeartbeat: new Date().toISOString(),
      lastConnectedAt: null,
      lastError: null,
    };
  }

  async sendMessage(_message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    throw new Error("WhatsApp provider is disabled by worker configuration.");
  }
}
