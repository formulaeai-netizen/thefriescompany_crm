// Phase 2: trusted-sender gate for financially-privileged WhatsApp
// commands (currently: expense intake). Deliberately separate from the
// general-purpose client-matching used by the payment-confirmation flow -
// this is an allow-list of exactly one number, not a CRM client lookup.

/** Default/backfill value used only for migrations/tests; live trust comes from DB routing settings. */
export const TRUSTED_EXPENSE_SENDER = "923152918780";

/**
 * Normalizes a raw WhatsApp sender identifier for trust comparison:
 * strips a WhatsApp JID suffix (e.g. "@c.us", "@s.whatsapp.net", "@g.us"),
 * then strips '+', spaces, hyphens and any other non-digit character,
 * then applies the same Pakistan-number normalization used everywhere
 * else in this codebase (leading '00' -> '', leading '0' -> '92').
 * Returns null if the result is not a plausible Pakistani WhatsApp number.
 */
export function normalizeWhatsAppSender(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const withoutJid = raw.split("@")[0] ?? "";
  let digits = withoutJid.trim().replace(/[^\d+]/g, "");
  if (!digits) return null;

  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `92${digits.slice(1)}`;

  return /^923\d{9}$/.test(digits) ? digits : null;
}

/** True only when the sender matches the configured expense-intake sender exactly. */
export function isTrustedExpenseSender(
  normalizedSender: string | null,
  trustedSender: string | null,
): boolean {
  return normalizedSender !== null && trustedSender !== null && normalizedSender === trustedSender;
}
