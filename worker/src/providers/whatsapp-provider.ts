export type WhatsAppProviderStatus = {
  provider: string;
  connected: boolean;
  qrRequired: boolean;
  lastHeartbeat: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
};

export type WhatsAppMessage = {
  to: string;
  body: string;
  idempotencyKey?: string;
};

export type WhatsAppSendResult = {
  providerMessageId: string | null;
  dryRun: boolean;
};

export interface WhatsAppProvider {
  initialize(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): WhatsAppProviderStatus;
  sendMessage(message: WhatsAppMessage): Promise<WhatsAppSendResult>;
}

export function assertRealSendAllowed(allowRealSend: boolean): void {
  if (!allowRealSend) {
    throw new Error(
      "Real WhatsApp sending is blocked. Set WHATSAPP_ALLOW_REAL_SEND=true only after explicit approval.",
    );
  }
}
