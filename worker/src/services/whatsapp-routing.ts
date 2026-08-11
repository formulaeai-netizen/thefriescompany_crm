// Mirrors src/lib/whatsapp-routing.ts (root) - separate package, same
// deliberate local-mirror convention as payment-command-parser.ts.

export const WHATSAPP_ROUTING_FLOW_KEYS = [
  "wastage_alerts",
  "stock_audit_alerts",
  "credit_purchase_reminders",
  "expense_intake_sender",
] as const;

export type WhatsAppRoutingFlowKey = (typeof WHATSAPP_ROUTING_FLOW_KEYS)[number];

/**
 * Mirrors public.operational_alert_routing_flow_key(): stock-audit alert
 * types route to a separate recipient from wastage/other operational
 * alerts.
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
