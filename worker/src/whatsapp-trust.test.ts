import assert from "node:assert/strict";
import test from "node:test";
import {
  isTrustedExpenseSender,
  normalizeWhatsAppSender,
  TRUSTED_EXPENSE_SENDER,
} from "./services/whatsapp-trust.js";

test("normalizes a WhatsApp JID by stripping the suffix", () => {
  assert.equal(normalizeWhatsAppSender("923152918780@c.us"), "923152918780");
  assert.equal(normalizeWhatsAppSender("923152918780@s.whatsapp.net"), "923152918780");
  assert.equal(normalizeWhatsAppSender("923152918780@g.us"), "923152918780");
});

test("normalizes +, 00, and leading-0 Pakistani number shapes to the same canonical form", () => {
  assert.equal(normalizeWhatsAppSender("+923152918780"), "923152918780");
  assert.equal(normalizeWhatsAppSender("00923152918780"), "923152918780");
  assert.equal(normalizeWhatsAppSender("03152918780"), "923152918780");
  assert.equal(normalizeWhatsAppSender("923152918780"), "923152918780");
});

test("strips spaces and hyphens", () => {
  assert.equal(normalizeWhatsAppSender("+92 315 291 8780"), "923152918780");
  assert.equal(normalizeWhatsAppSender("0315-291-8780"), "923152918780");
});

test("rejects non-Pakistani or implausible numbers", () => {
  assert.equal(normalizeWhatsAppSender("12025550123"), null);
  assert.equal(normalizeWhatsAppSender("92315291878"), null); // too short
  assert.equal(normalizeWhatsAppSender("9231529187800"), null); // too long
});

test("rejects null/undefined/empty input", () => {
  assert.equal(normalizeWhatsAppSender(null), null);
  assert.equal(normalizeWhatsAppSender(undefined), null);
  assert.equal(normalizeWhatsAppSender(""), null);
  assert.equal(normalizeWhatsAppSender("@c.us"), null);
});

test("only the configured trusted sender is trusted for expense intake", () => {
  assert.equal(isTrustedExpenseSender(TRUSTED_EXPENSE_SENDER, TRUSTED_EXPENSE_SENDER), true);
  assert.equal(isTrustedExpenseSender("923083021375", "923083021375"), true);
});

test("any other sender, including a known CRM client number, is untrusted for expense intake", () => {
  assert.equal(isTrustedExpenseSender("923212558027", "923083021375"), false);
  assert.equal(isTrustedExpenseSender("923000000000", "923083021375"), false);
  assert.equal(isTrustedExpenseSender(null, "923083021375"), false);
  assert.equal(isTrustedExpenseSender("923083021375", null), false);
});
