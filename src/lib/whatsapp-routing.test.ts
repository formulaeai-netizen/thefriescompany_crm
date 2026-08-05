import assert from "node:assert/strict";
import test from "node:test";

import {
  isWhatsAppRoutingFlowKey,
  normalizePakistanWhatsappPhone,
  operationalAlertRoutingFlowKey,
  WHATSAPP_ROUTING_FLOW_KEYS,
  WHATSAPP_ROUTING_FLOW_LABELS,
} from "./whatsapp-routing.ts";

test("routing numbers normalize Pakistani and international input the same way as reminders", () => {
  assert.equal(normalizePakistanWhatsappPhone("03211112222"), "923211112222");
  assert.equal(normalizePakistanWhatsappPhone("+923211112222"), "923211112222");
  assert.equal(normalizePakistanWhatsappPhone("00923211112222"), "923211112222");
  assert.equal(normalizePakistanWhatsappPhone("923211112222"), "923211112222");
  assert.equal(normalizePakistanWhatsappPhone("not-a-phone"), null);
});

test("stock-audit alerts route to a separate recipient flow from wastage/operational alerts", () => {
  assert.equal(operationalAlertRoutingFlowKey("stock_variance"), "stock_audit_alerts");
  assert.equal(operationalAlertRoutingFlowKey("audit_missed"), "stock_audit_alerts");
  assert.equal(operationalAlertRoutingFlowKey("audit_incomplete"), "stock_audit_alerts");
  assert.equal(operationalAlertRoutingFlowKey("wastage_variance"), "wastage_alerts");
  assert.equal(operationalAlertRoutingFlowKey("ai_weight_mismatch"), "wastage_alerts");
  assert.equal(operationalAlertRoutingFlowKey("wastage_over_threshold"), "wastage_alerts");
  assert.notEqual(
    operationalAlertRoutingFlowKey("stock_variance"),
    operationalAlertRoutingFlowKey("wastage_variance"),
  );
});

test("all three configurable flow keys are recognized; invoice reminders is not one of them", () => {
  assert.deepEqual([...WHATSAPP_ROUTING_FLOW_KEYS].sort(), [
    "credit_purchase_reminders",
    "stock_audit_alerts",
    "wastage_alerts",
  ]);
  assert.equal(isWhatsAppRoutingFlowKey("wastage_alerts"), true);
  assert.equal(isWhatsAppRoutingFlowKey("invoice_reminders"), false);
});

test("each flow has an independent, distinct display label", () => {
  const labels = Object.values(WHATSAPP_ROUTING_FLOW_LABELS);
  assert.equal(new Set(labels).size, labels.length);
  for (const key of WHATSAPP_ROUTING_FLOW_KEYS) {
    assert.ok(WHATSAPP_ROUTING_FLOW_LABELS[key]);
  }
});

test("valid Pakistani local number is normalized and accepted", () => {
  assert.equal(normalizePakistanWhatsappPhone("0300 123 4567"), "923001234567");
});

test("invalid number is rejected (normalizes to null)", () => {
  assert.equal(normalizePakistanWhatsappPhone("12345"), null);
  assert.equal(normalizePakistanWhatsappPhone("not-a-phone"), null);
});
