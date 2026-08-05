import fs from "node:fs";
import crypto from "node:crypto";
import qrcode from "qrcode-terminal";
import {
  assertRealSendAllowed,
  type WhatsAppMessage,
  type WhatsAppProvider,
  type WhatsAppProviderStatus,
  type WhatsAppSendResult,
} from "./whatsapp-provider.js";

type WhatsAppWebProviderOptions = {
  sessionPath: string;
  allowRealSend: boolean;
  eventConfirmationTimeoutMs?: number;
};

export class WhatsAppWebProvider implements WhatsAppProvider {
  private client: any = null;
  private connected = false;
  private qrRequired = false;
  private lastHeartbeat: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly options: WhatsAppWebProviderOptions) {}

  private extractProviderMessageId(message: any): string | null {
    const candidates = [message?.id?._serialized, message?.id?.id, message?._data?.id?._serialized];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
    }

    return null;
  }

  private hashBody(body: string): string {
    return crypto.createHash("sha256").update(body).digest("hex");
  }

  private waitForEventConfirmation(
    chatId: string,
    bodyHash: string,
    timeoutMs: number,
  ): {
    promise: Promise<string | null>;
    cleanup: () => void;
  } {
    let settled = false;
    let timeout: NodeJS.Timeout;

    const matchesOutgoingMessage = (eventMessage: any) => {
      const eventChatId =
        eventMessage?.to ?? eventMessage?._data?.to?._serialized ?? eventMessage?._data?.id?.remote;
      const eventBodyHash =
        typeof eventMessage?.body === "string" ? this.hashBody(eventMessage.body) : null;

      return eventMessage?.fromMe === true && eventChatId === chatId && eventBodyHash === bodyHash;
    };

    let resolvePromise: (value: string | null) => void = () => undefined;
    const promise = new Promise<string | null>((resolve) => {
      resolvePromise = resolve;
      timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeoutMs);
    });

    const resolveFromEvent = (eventMessage: any) => {
      if (settled || !matchesOutgoingMessage(eventMessage)) return;
      const providerMessageId = this.extractProviderMessageId(eventMessage);
      if (!providerMessageId) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(providerMessageId);
    };

    this.client.on("message_create", resolveFromEvent);
    this.client.on("message_ack", resolveFromEvent);

    return {
      promise,
      cleanup: () => {
        clearTimeout(timeout);
        this.client.off("message_create", resolveFromEvent);
        this.client.off("message_ack", resolveFromEvent);
      },
    };
  }

  async initialize(): Promise<void> {
    fs.mkdirSync(this.options.sessionPath, { recursive: true });

    const whatsappWeb = await import("whatsapp-web.js");
    const whatsappWebExports = whatsappWeb.default ?? whatsappWeb;
    const Client = whatsappWeb.Client ?? whatsappWebExports.Client;
    const LocalAuth = whatsappWebExports.LocalAuth;

    if (!Client || !LocalAuth) {
      throw new Error("whatsapp-web.js Client/LocalAuth exports could not be loaded");
    }

    this.client = new Client({
      authStrategy: new LocalAuth({ dataPath: this.options.sessionPath }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
    });

    this.client.on("qr", (qr: string) => {
      this.qrRequired = true;
      this.lastHeartbeat = new Date().toISOString();
      console.info("WhatsApp QR required. Scan this code with the approved test WhatsApp account.");
      qrcode.generate(qr, { small: true });
    });

    this.client.on("ready", () => {
      this.connected = true;
      this.qrRequired = false;
      this.lastConnectedAt = new Date().toISOString();
      this.lastHeartbeat = this.lastConnectedAt;
      this.lastError = null;
      console.info(
        "WhatsApp Web provider connected. Real sending remains blocked unless explicitly enabled.",
      );
    });

    this.client.on("authenticated", () => {
      this.lastHeartbeat = new Date().toISOString();
      console.info("WhatsApp Web session authenticated.");
    });

    this.client.on("auth_failure", (message: string) => {
      this.connected = false;
      this.qrRequired = true;
      this.lastError = `Authentication failed: ${message}`;
      console.error(this.lastError);
    });

    this.client.on("disconnected", (reason: string) => {
      this.connected = false;
      this.lastError = `Disconnected: ${reason}`;
      console.warn(this.lastError);
    });

    await this.client.initialize();
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    await this.client.destroy();
    this.connected = false;
    this.lastHeartbeat = new Date().toISOString();
  }

  getStatus(): WhatsAppProviderStatus {
    return {
      provider: "whatsapp-web",
      connected: this.connected,
      qrRequired: this.qrRequired,
      lastHeartbeat: this.lastHeartbeat,
      lastConnectedAt: this.lastConnectedAt,
      lastError: this.lastError,
    };
  }

  async sendMessage(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    assertRealSendAllowed(this.options.allowRealSend);
    if (!this.client || !this.connected) throw new Error("WhatsApp Web provider is not connected");

    const recipient = message.to.replace(/[^\d]/g, "");
    const numberId = await this.client.getNumberId(recipient);
    if (!numberId?._serialized) {
      throw new Error("WhatsApp number is not registered or reachable");
    }

    const chatId = numberId._serialized;
    const bodyHash = this.hashBody(message.body);
    const confirmation = this.waitForEventConfirmation(
      chatId,
      bodyHash,
      this.options.eventConfirmationTimeoutMs ?? 20000,
    );

    let sent: any;
    try {
      sent = await this.client.sendMessage(chatId, message.body);
    } finally {
      // Keep listeners alive below if direct return has no id.
    }

    const directProviderMessageId = this.extractProviderMessageId(sent);
    if (directProviderMessageId) {
      confirmation.cleanup();
      return {
        providerMessageId: directProviderMessageId,
        dryRun: false,
      };
    }

    const eventProviderMessageId = await confirmation.promise;
    confirmation.cleanup();
    if (!eventProviderMessageId) {
      throw new Error("WhatsApp send confirmation timed out without a provider message id");
    }

    return {
      providerMessageId: eventProviderMessageId,
      dryRun: false,
    };
  }
}
