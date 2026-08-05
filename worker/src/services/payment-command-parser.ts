// Mirrors src/lib/payment-verifications.ts parsePaidWhatsAppCommand() exactly
// (the worker is a separate package with its own build/tsconfig, so this is
// a deliberate local mirror, same convention already used for
// normalizePakistanWhatsappPhone in inbound-payment-confirmations.ts /
// queue-processor.ts). Never uses OCR/AI/fuzzy matching.

export type ParsedPaidCommand = {
  amount: number;
  invoiceReference: string;
};

/**
 * Deterministic parser for "PAID <amount> <invoice-id>", e.g.
 * "PAID 25000 INV-1023". Case-insensitive, tolerant of extra whitespace,
 * thousands separators (25,000) and an optional RS/PKR currency prefix.
 * Returns null for anything that does not match exactly.
 */
export function parsePaidWhatsAppCommand(
  rawText: string | null | undefined,
): ParsedPaidCommand | null {
  if (!rawText) return null;
  const normalized = rawText.trim().replace(/\s+/g, " ");
  const match = /^PAID\s+(?:(?:RS|PKR)\.?\s+)?([\d,]+(?:\.\d+)?)\s+([A-Za-z0-9-]+)$/i.exec(
    normalized,
  );
  if (!match) return null;

  const amount = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  return { amount, invoiceReference: match[2].toUpperCase() };
}

/**
 * Deterministic (non-fuzzy) match of the fixed early-payment trigger
 * phrases from Prompt 3, item B. Case-insensitive, tolerant of an optional
 * trailing punctuation mark. Never matches the strict PAID command shape -
 * callers must try parsePaidWhatsAppCommand() first.
 */
const EARLY_PAYMENT_PATTERNS: RegExp[] = [
  /^paid\.?$/i,
  /^payment\s+sent\.?$/i,
  /^transfer\s+done\.?$/i,
  /^payment\s+kar\s+di\s+hai\.?$/i,
  /^payment\s+hogayi\.?$/i,
  /^amount\s+send\s+kar\s+diya\.?$/i,
];

export function isEarlyPaymentPhrase(rawText: string | null | undefined): boolean {
  if (!rawText) return false;
  const normalized = rawText.trim().replace(/\s+/g, " ");
  return EARLY_PAYMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * True for a message that looks like an attempted (but malformed) PAID
 * command - e.g. "PAID abc", "PAID 500" (missing invoice id). Used only to
 * decide whether to prepare correct-format guidance; never to guess the
 * amount/invoice.
 */
export function looksLikeAttemptedPaidCommand(rawText: string | null | undefined): boolean {
  if (!rawText) return false;
  const normalized = rawText.trim();
  if (parsePaidWhatsAppCommand(normalized)) return false;
  if (isEarlyPaymentPhrase(normalized)) return false;
  return /^\s*paid\b/i.test(normalized);
}

export type InboundTextClassification =
  "strict_command" | "early_payment" | "invalid_attempt" | "irrelevant";

/** Single deterministic classification entry point used by the inbound handler. */
export function classifyInboundText(rawText: string | null | undefined): InboundTextClassification {
  if (parsePaidWhatsAppCommand(rawText)) return "strict_command";
  if (isEarlyPaymentPhrase(rawText)) return "early_payment";
  if (looksLikeAttemptedPaidCommand(rawText)) return "invalid_attempt";
  return "irrelevant";
}
