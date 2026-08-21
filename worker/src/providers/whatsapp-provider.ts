export type WhatsAppAckStatus =
  | "ACK_ERROR"
  | "ACK_PENDING"
  | "ACK_SERVER"
  | "ACK_DEVICE"
  | "ACK_READ"
  | "ACK_PLAYED";

export type WhatsAppLifecycleEvent =
  | "authenticated"
  | "ready"
  | "disconnected"
  | "auth_failure"
  | "change_state"
  | "browser_exit"
  | "process_exit";

export type WhatsAppAckTransition = {
  providerMessageIdMasked: string;
  status: WhatsAppAckStatus;
  timestamp: string;
  recipientEnding?: string;
};

export type WhatsAppProviderStatus = {
  provider: string;
  connected: boolean;
  qrRequired: boolean;
  lastHeartbeat: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  senderMasked?: string | null;
  lifecycleState?: WhatsAppLifecycleEvent | null;
  lastAckStatus?: WhatsAppAckStatus | null;
};

export type WhatsAppMessage = {
  to: string;
  body: string;
  idempotencyKey?: string;
};

export type WhatsAppSendResult = {
  providerMessageId: string | null;
  dryRun: boolean;
  ackStatus?: WhatsAppAckStatus;
  deliveryConfirmed?: boolean;
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

export function mapWhatsAppAckStatus(value: unknown): WhatsAppAckStatus | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (numeric === -1) return "ACK_ERROR";
  if (numeric === 0) return "ACK_PENDING";
  if (numeric === 1) return "ACK_SERVER";
  if (numeric === 2) return "ACK_DEVICE";
  if (numeric === 3) return "ACK_READ";
  if (numeric === 4) return "ACK_PLAYED";

  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  return normalized.startsWith("ACK_") &&
    ["ACK_ERROR", "ACK_PENDING", "ACK_SERVER", "ACK_DEVICE", "ACK_READ", "ACK_PLAYED"].includes(normalized)
    ? (normalized as WhatsAppAckStatus)
    : null;
}
