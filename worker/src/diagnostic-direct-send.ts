import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadWorkerConfig } from "./config.js";
import { WhatsAppWebProvider } from "./providers/whatsapp-web.provider.js";

const DEFAULT_TEST_NUMBER = "923212558027";
const TEST_BODY = `Hello testing_dev,

Invoice TEST-WA-REMINDER-20260730-001 ka outstanding amount Rs. 1,000 hai aur due date 29 July 2026 thi.

Agar payment already ho chuki hai to payment proof share kar dein.

Regards,
The Fries Company`;

function bodyHash(body: string): string {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function extractProviderMessageId(message: any): string | null {
  for (const candidate of [
    message?.id?._serialized,
    message?.id?.id,
    message?._data?.id?._serialized,
  ]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }

  return null;
}

function safeMessageShape(message: any) {
  return {
    returnedObjectExists: Boolean(message),
    constructorName: message?.constructor?.name ?? null,
    topLevelPropertyNames: message ? Object.keys(message).slice(0, 30).sort() : [],
    messageIdExists: Boolean(message?.id),
    messageIdSerializedExists: Boolean(message?.id?._serialized),
  };
}

function readNumberArg(): string {
  const value = process.argv.find((arg) => arg.startsWith("--number="))?.split("=", 2)[1];
  const raw = value ?? DEFAULT_TEST_NUMBER;
  let digits = raw.trim().replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `92${digits.slice(1)}`;
  if (!/^923\d{9}$/.test(digits))
    throw new Error("Diagnostic number must be a valid Pakistan WhatsApp number");
  return digits;
}

function maskNumber(number: string): string {
  return `${number.slice(0, 3)}*******${number.slice(-2)}`;
}

async function waitForReady(provider: WhatsAppWebProvider) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const status = provider.getStatus();
    if (status.connected) return status;
    if (status.lastError) throw new Error(status.lastError);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("WhatsApp provider did not reach ready state in time");
}

async function main() {
  const mode = process.argv.includes("--send") ? "send" : "preflight";
  const targetNumber = readNumberArg();
  const config = loadWorkerConfig();
  const provider = new WhatsAppWebProvider({
    sessionPath: config.sessionPath,
    allowRealSend: mode === "send",
  });

  let client: any = null;
  let createEventSeen = false;
  let ackEventSeen = false;
  let eventProviderMessageId: string | null = null;

  try {
    await provider.initialize();
    const readyStatus = await waitForReady(provider);
    client = (provider as any).client;
    const numberId = await client.getNumberId(targetNumber);
    const chatId = numberId?._serialized ?? null;
    const wwebVersion = await client.getWWebVersion().catch(() => null);
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    );

    console.log(
      "DIRECT_SEND_PREFLIGHT " +
        JSON.stringify({
          connected: readyStatus.connected,
          qrRequired: readyStatus.qrRequired,
          testNumberMasked: maskNumber(targetNumber),
          getNumberIdReturned: Boolean(numberId),
          chatIdShape: chatId ? chatId.replace(/^(\d{3})\d+(\d{2}@)/, "$1*******$2") : null,
          chatIdMatchesExpectedShape: chatId === `${targetNumber}@c.us`,
          whatsappWebVersion: wwebVersion,
          whatsappWebJsVersion: packageJson.dependencies?.["whatsapp-web.js"] ?? null,
          bodySha256: bodyHash(TEST_BODY),
          sendMode: mode,
        }),
    );

    if (!chatId) {
      console.log(
        "DIRECT_SEND_RESULT " +
          JSON.stringify({
            ok: false,
            reason: "number_not_registered_or_reachable",
            messageAttempted: 0,
          }),
      );
      return;
    }

    if (mode !== "send") return;

    if (process.env.WHATSAPP_ALLOW_REAL_SEND !== "true") {
      throw new Error("Diagnostic send requires WHATSAPP_ALLOW_REAL_SEND=true");
    }

    const targetHash = bodyHash(TEST_BODY);
    const matchesOutgoingMessage = (eventMessage: any) => {
      const eventChatId =
        eventMessage?.to ?? eventMessage?._data?.to?._serialized ?? eventMessage?._data?.id?.remote;
      const eventBodyHash =
        typeof eventMessage?.body === "string" ? bodyHash(eventMessage.body) : null;
      return (
        eventMessage?.fromMe === true && eventChatId === chatId && eventBodyHash === targetHash
      );
    };

    const onMessageCreate = (eventMessage: any) => {
      if (!matchesOutgoingMessage(eventMessage)) return;
      createEventSeen = true;
      eventProviderMessageId = extractProviderMessageId(eventMessage);
    };

    const onMessageAck = (eventMessage: any) => {
      if (!matchesOutgoingMessage(eventMessage)) return;
      ackEventSeen = true;
      eventProviderMessageId = eventProviderMessageId ?? extractProviderMessageId(eventMessage);
    };

    client.on("message_create", onMessageCreate);
    client.on("message_ack", onMessageAck);
    let message: any;
    try {
      message = await client.sendMessage(chatId, TEST_BODY);
      await new Promise((resolve) => setTimeout(resolve, 2500));
    } finally {
      client.off("message_create", onMessageCreate);
      client.off("message_ack", onMessageAck);
    }

    const providerMessageId = extractProviderMessageId(message) ?? eventProviderMessageId;
    console.log(
      "DIRECT_SEND_RESULT " +
        JSON.stringify({
          ok: Boolean(message && providerMessageId),
          messageAttempted: 1,
          messageShape: safeMessageShape(message),
          createEventSeen,
          ackEventSeen,
          providerMessageIdMasked: providerMessageId
            ? `${providerMessageId.slice(0, 4)}...${providerMessageId.slice(-4)}`
            : null,
          targetMasked: maskNumber(targetNumber),
          failureReason: message ? null : "sendMessage_returned_null_or_undefined",
        }),
    );
  } finally {
    await provider.disconnect().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown diagnostic error";
  console.log("DIRECT_SEND_RESULT " + JSON.stringify({ ok: false, error: message }));
  process.exitCode = 1;
});
