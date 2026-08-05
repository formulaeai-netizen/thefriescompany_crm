import {
  assertRealSendAllowed,
  type WhatsAppMessage,
  type WhatsAppProvider,
  type WhatsAppProviderStatus,
  type WhatsAppSendResult,
} from "./whatsapp-provider.js";

export class MetaCloudProvider implements WhatsAppProvider {
  constructor(private readonly allowRealSend: boolean) {}

  async initialize(): Promise<void> {
    throw new Error("Meta WhatsApp Cloud API provider is not configured yet.");
  }

  async disconnect(): Promise<void> {
    return;
  }

  getStatus(): WhatsAppProviderStatus {
    return {
      provider: "meta-cloud",
      connected: false,
      qrRequired: false,
      lastHeartbeat: new Date().toISOString(),
      lastConnectedAt: null,
      lastError: "Meta WhatsApp Cloud API provider is not configured yet.",
    };
  }

  async sendMessage(_message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    assertRealSendAllowed(this.allowRealSend);
    throw new Error("Meta WhatsApp Cloud API provider is not configured yet.");
  }
}
