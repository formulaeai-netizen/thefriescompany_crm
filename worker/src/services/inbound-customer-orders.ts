import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhatsAppProvider } from "../providers/whatsapp-provider.js";
import { parseCustomerOrder } from "./customer-order-parser.js";
import { normalizeWhatsAppSender } from "./whatsapp-trust.js";

export type CustomerOrderRepository = {
  resolveProducts(names: string[]): Promise<Array<{ id: string; name: string }>>;
  create(input: {
    sender: string;
    deliveryDate: string;
    items: Array<{ product_id: string; quantity: number; unit: string }>;
    sourceKey: string;
  }): Promise<{ status: string; id?: string }>;
};
const messageId = (m: any) => m?.id?._serialized ?? m?.id?.id ?? crypto.randomUUID();
export async function handleIncomingCustomerOrder(repo: CustomerOrderRepository, message: any) {
  if (message?.fromMe) return { kind: "ignored" as const };
  const parsed = parseCustomerOrder(String(message?.body ?? ""));
  if (!parsed) return { kind: "ignored" as const };
  const sender = normalizeWhatsAppSender(message?.from);
  if (!sender) return { kind: "ignored" as const };
  const products = await repo.resolveProducts(parsed.items.map((x) => x.productName));
  if (products.length !== parsed.items.length)
    return {
      kind: "invalid" as const,
      reply: "Order not created. Please use the supported order format.",
    };
  const byName = new Map(products.map((x) => [x.name.toLowerCase(), x]));
  const items = parsed.items.map((x) => ({
    product_id: byName.get(x.productName.toLowerCase())!.id,
    quantity: x.quantity,
    unit: "packs",
  }));
  const result = await repo.create({
    sender,
    deliveryDate: parsed.requestedDeliveryDate,
    items,
    sourceKey: `whatsapp-order:${messageId(message)}`,
  });
  if (result.status === "created" || result.status === "duplicate")
    return {
      kind: "created" as const,
      reply: result.id
        ? `Order received.\nOrder #: ${result.id}\nWe will confirm the delivery schedule shortly.`
        : "Order received.",
    };
  if (result.status === "ambiguous_branch")
    return { kind: "ambiguous" as const, reply: "Please specify your branch." };
  return { kind: "ignored" as const };
}
export class SupabaseCustomerOrderRepository implements CustomerOrderRepository {
  constructor(private supabase: SupabaseClient) {}
  async resolveProducts(names: string[]) {
    const { data, error } = await this.supabase
      .from("products")
      .select("id,name")
      .eq("is_active", true)
      .in("name", names);
    if (error) throw error;
    return (data ?? []) as any[];
  }
  async create(input: any) {
    const { data, error } = await (this.supabase as any).rpc("create_whatsapp_customer_order", {
      _sender_normalized: input.sender,
      _requested_delivery_date: input.deliveryDate,
      _items: input.items,
      _external_source_key: input.sourceKey,
    });
    if (error) throw error;
    return data as any;
  }
}
export function startInboundCustomerOrderListener(
  client: any,
  repo: CustomerOrderRepository,
  provider: WhatsAppProvider,
) {
  const onMessage = async (m: any) => {
    try {
      const r = await handleIncomingCustomerOrder(repo, m);
      const sender = normalizeWhatsAppSender(m?.from);
      if ("reply" in r && typeof r.reply === "string" && sender && provider.getStatus().connected)
        await provider.sendMessage({ to: sender, body: r.reply });
    } catch {
      console.error("Customer WhatsApp order handling failed");
    }
  };
  client.on("message", onMessage);
  return () => client.off("message", onMessage);
}
