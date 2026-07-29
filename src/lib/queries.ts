import { supabase } from "@/lib/supabase";

async function logAuth(tag: string) {
  const { data } = await supabase.auth.getSession();
  console.log(`[queries:${tag}] session?`, !!data.session, "user:", data.session?.user?.email ?? null);
}

export async function fetchClients() {
  await logAuth("clients");
  const { data, error } = await supabase
    .from("clients")
    .select("*, branches(id, branch_name, city), invoices(id)")
    .order("client_code");
  console.log("[queries:clients]", { count: data?.length ?? 0, error });
  if (error) throw error;
  return data ?? [];
}

export async function fetchInvoices() {
  await logAuth("invoices");
  let { data, error } = await supabase
    .from("invoices")
    .select("*, clients(id, legal_name, client_code, primary_contact, phone), branches(id, branch_name)")
    .or("is_deleted.is.null,is_deleted.eq.false")
    .order("date", { ascending: false });

  // Fallback if the soft-delete migration hasn't been applied yet
  if (error && (error as any).code === "42703") {
    console.warn("[queries:invoices] is_deleted column missing — run docs/migrations/invoice-soft-delete.sql. Falling back to unfiltered query.");
    const res = await supabase
      .from("invoices")
      .select("*, clients(id, legal_name, client_code, primary_contact, phone), branches(id, branch_name)")
      .order("date", { ascending: false });
    data = res.data;
    error = res.error;
  }

  console.log("[queries:invoices]", { count: data?.length ?? 0, error });
  if (error) throw error;
  return data ?? [];
}

export async function fetchDeletedInvoices() {
  const query: any = supabase
    .from("invoices")
    .select("*, clients(id, legal_name, client_code, primary_contact, phone), branches(id, branch_name)")
    .eq("is_deleted", true)
    .order("deleted_at", { ascending: false });
  let { data, error } = await query;
  if (error && (error as any).code === "42703") {
    console.warn("[queries:deletedInvoices] is_deleted column missing — run docs/migrations/invoice-soft-delete.sql");
    return [];
  }
  if (error) throw error;
  return data ?? [];
}

export async function fetchExpenses() {
  await logAuth("expenses");
  const { data, error } = await supabase.from("expenses").select("*").order("date", { ascending: false });
  console.log("[queries:expenses]", { count: data?.length ?? 0, error });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const ids = Array.from(new Set(rows.map((r) => r.created_by).filter(Boolean)));
  let nameById = new Map<string, string>();
  if (ids.length > 0) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    for (const p of (profs ?? []) as any[]) {
      if (p?.id) nameById.set(p.id, (p.full_name ?? "").trim());
    }
  }
  return rows.map((r) => ({
    ...r,
    added_by_name: r.created_by ? (nameById.get(r.created_by) || null) : null,
  }));
}

export async function fetchSettings() {
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).single();
  if (error) throw error;
  return data;
}

export async function fetchInventory() {
  const { data, error } = await supabase
    .from("inventory" as any)
    .select("*")
    .order("item_name");
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function fetchStockMovements() {
  const { data, error } = await supabase
    .from("stock_movements" as any)
    .select("*, inventory(id, item_name, unit), invoices(id, invoice_no)")
    .order("movement_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as any[];
}