import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyInboundText,
  isEarlyPaymentPhrase,
  looksLikeAttemptedPaidCommand,
  parsePaidWhatsAppCommand,
} from "./services/payment-command-parser.js";

test("valid exact command parses amount and invoice reference", () => {
  assert.deepEqual(parsePaidWhatsAppCommand("PAID 25000 INV-1023"), {
    amount: 25000,
    invoiceReference: "INV-1023",
  });
});

test("lowercase command parses the same way", () => {
  assert.deepEqual(parsePaidWhatsAppCommand("paid 25000 inv-1023"), {
    amount: 25000,
    invoiceReference: "INV-1023",
  });
});

test("commas in the amount are accepted", () => {
  assert.deepEqual(parsePaidWhatsAppCommand("paid 25,000 inv-1023"), {
    amount: 25000,
    invoiceReference: "INV-1023",
  });
});

test("RS/PKR prefix is accepted", () => {
  assert.deepEqual(parsePaidWhatsAppCommand("PAID RS 25000 INV-1023"), {
    amount: 25000,
    invoiceReference: "INV-1023",
  });
  assert.deepEqual(parsePaidWhatsAppCommand("PAID PKR 25000 INV-1023"), {
    amount: 25000,
    invoiceReference: "INV-1023",
  });
});

test("missing amount is rejected", () => {
  assert.equal(parsePaidWhatsAppCommand("PAID INV-1023"), null);
});

test("invalid (non-positive or non-numeric) amount is rejected", () => {
  assert.equal(parsePaidWhatsAppCommand("PAID -500 INV-1023"), null);
  assert.equal(parsePaidWhatsAppCommand("PAID abc INV-1023"), null);
  assert.equal(parsePaidWhatsAppCommand("PAID 0 INV-1023"), null);
});

test("missing invoice ID is rejected", () => {
  assert.equal(parsePaidWhatsAppCommand("PAID 25000"), null);
});

test("a media-only message (no text) never parses as a command", () => {
  assert.equal(parsePaidWhatsAppCommand(""), null);
  assert.equal(parsePaidWhatsAppCommand(null), null);
  assert.equal(parsePaidWhatsAppCommand(undefined), null);
});

test("early-payment phrases are recognized deterministically", () => {
  assert.equal(isEarlyPaymentPhrase("Paid"), true);
  assert.equal(isEarlyPaymentPhrase("payment sent"), true);
  assert.equal(isEarlyPaymentPhrase("Transfer Done"), true);
  assert.equal(isEarlyPaymentPhrase("Payment kar di hai"), true);
  assert.equal(isEarlyPaymentPhrase("payment hogayi"), true);
  assert.equal(isEarlyPaymentPhrase("Amount send kar diya"), true);
  assert.equal(isEarlyPaymentPhrase("hello"), false);
  assert.equal(isEarlyPaymentPhrase("PAID 25000 INV-1023"), false);
});

test("attempted-but-malformed PAID commands are classified separately from early payment / strict command", () => {
  assert.equal(looksLikeAttemptedPaidCommand("PAID abc"), true);
  assert.equal(looksLikeAttemptedPaidCommand("PAID 500"), true);
  assert.equal(looksLikeAttemptedPaidCommand("Paid"), false);
  assert.equal(looksLikeAttemptedPaidCommand("PAID 25000 INV-1023"), false);
});

test("classifyInboundText routes each shape correctly", () => {
  assert.equal(classifyInboundText("PAID 25000 INV-1023"), "strict_command");
  assert.equal(classifyInboundText("Paid"), "early_payment");
  assert.equal(classifyInboundText("PAID 500"), "invalid_attempt");
  assert.equal(classifyInboundText("hello there"), "irrelevant");
});
