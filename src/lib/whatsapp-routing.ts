import { normalizePakistanWhatsappPhone } from "./invoice-reminders.ts";

export { normalizePakistanWhatsappPhone };

export const WHATSAPP_ROUTING_FLOW_KEYS = [
  "wastage_alerts",
  "stock_audit_alerts",
  "credit_purchase_reminders",
] as const;

export type WhatsAppRoutingFlowKey = (typeof WHATSAPP_ROUTING_FLOW_KEYS)[number];

export function isWhatsAppRoutingFlowKey(value: string): value is WhatsAppRoutingFlowKey {
  return (WHATSAPP_ROUTING_FLOW_KEYS as readonly string[]).includes(value);
}

/**
 * Mirrors public.operational_alert_routing_flow_key(): stock-audit alert
 * types route to a separate recipient from wastage/other operational
 * alerts. Metadata/mapping only - does not dispatch anything.
 */
export function operationalAlertRoutingFlowKey(alertType: string): WhatsAppRoutingFlowKey {
  if (
    alertType === "stock_variance" ||
    alertType === "audit_missed" ||
    alertType === "audit_incomplete"
  ) {
    return "stock_audit_alerts";
  }
  return "wastage_alerts";
}

/** Display labels for the Settings > WhatsApp Routing UI. */
export const WHATSAPP_ROUTING_FLOW_LABELS: Record<WhatsAppRoutingFlowKey, string> = {
  wastage_alerts: "Wastage / Operational Alerts",
  stock_audit_alerts: "Inventory Audit Alerts",
  credit_purchase_reminders: "Credit Purchase Due Reminders",
};
