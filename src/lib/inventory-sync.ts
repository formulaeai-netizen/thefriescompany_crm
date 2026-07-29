import { supabase } from "@/lib/supabase";

const PACK_SIZE = 2.5;

// Recompute the inventory_stock row for a given YYYY-MM-DD from source tables:
//   - opening_packs   := prior day's closing_packs (or 0)
//   - packs_produced  := sum(actual_packs_produced || packs_produced) from daily_production
//   - raw_material_kg := sum(raw_input_kg) from daily_production
//   - packs_delivered := sum(weight_kg)/2.5 from invoices on that delivery_date
export async function syncInventoryStockForDate(date: string) {
  // 1. Aggregate production for the date
  const { data: prodRows } = await supabase
    .from("daily_production")
    .select("raw_input_kg, packs_produced, actual_packs_produced")
    .eq("date", date);
  const prod = prodRows ?? [];
  const packs_produced = prod.reduce(
    (s: number, r: any) => s + Number(r.actual_packs_produced ?? r.packs_produced ?? 0),
    0,
  );
  const raw_material_kg = prod.reduce((s: number, r: any) => s + Number(r.raw_input_kg ?? 0), 0);

  // 2. Delivered packs from invoices (weight_kg / 2.5)
  const { data: invRows } = await supabase
    .from("invoices")
    .select("weight_kg, delivery_date, is_deleted")
    .eq("delivery_date", date);
  const invs = (invRows ?? []).filter((r: any) => r.is_deleted !== true);
  const packs_delivered = invs.reduce(
    (s: number, r: any) => s + (Number(r.weight_kg ?? 0) / PACK_SIZE),
    0,
  );

  // 3. Opening = prior day's closing_packs (most recent row with date < this date)
  const { data: prev } = await supabase
    .from("inventory_stock")
    .select("closing_packs, date")
    .lt("date", date)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const opening_packs = Number(prev?.closing_packs ?? 0);

  // 4. Upsert the row for this date
  const { data: existing } = await supabase
    .from("inventory_stock")
    .select("id")
    .eq("date", date)
    .maybeSingle();

  const payload = { date, opening_packs, packs_produced, packs_delivered, raw_material_kg };

  if (existing?.id) {
    const { error } = await supabase.from("inventory_stock").update(payload).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("inventory_stock").insert(payload);
    if (error) throw error;
  }
}