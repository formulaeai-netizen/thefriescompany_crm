import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ServerContext = { supabase: any; userId: string };

async function assertAdmin(ctx: ServerContext) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden");
}

const ledgerFiltersSchema = z.object({
  search: z.string().trim().max(120).optional().nullable(),
  branch_id: z.string().uuid().optional().nullable(),
  balance_status: z.enum(["all", "outstanding", "paid"]).default("all"),
  date_from: z.string().date().optional().nullable(),
  date_to: z.string().date().optional().nullable(),
  due_status: z.enum(["all", "due_soon", "overdue"]).default("all"),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type CustomerLedgerQueryInput = z.infer<typeof ledgerFiltersSchema>;

export const listCustomerLedgerRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => ledgerFiltersSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: rows, error } = await (context.supabase as any).rpc("get_customer_ledger_rows", {
      _search: data.search || null,
      _branch_id: data.branch_id || null,
      _balance_status: data.balance_status,
      _date_from: data.date_from || null,
      _date_to: data.date_to || null,
      _due_status: data.due_status,
      _limit: data.limit,
      _offset: data.offset,
    });
    if (error) throw new Error(`Customer ledger load failed: ${error.message}`);
    return {
      rows: rows ?? [],
      total_count: Number(rows?.[0]?.total_count ?? 0),
    };
  });

export const getCustomerLedgerSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => ledgerFiltersSchema.omit({ limit: true, offset: true }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: rows, error } = await (context.supabase as any).rpc(
      "get_customer_ledger_summary",
      {
        _search: data.search || null,
        _branch_id: data.branch_id || null,
        _balance_status: data.balance_status,
        _date_from: data.date_from || null,
        _date_to: data.date_to || null,
        _due_status: data.due_status,
      },
    );
    if (error) throw new Error(`Customer ledger summary failed: ${error.message}`);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      unique_customer_branches: Number(row?.unique_customer_branches ?? 0),
      outstanding_customer_branches: Number(row?.outstanding_customer_branches ?? 0),
      total_invoice_value: Number(row?.total_invoice_value ?? 0),
      total_outstanding_balance: Number(row?.total_outstanding_balance ?? 0),
      overdue_balance: Number(row?.overdue_balance ?? 0),
    };
  });

const detailSchema = z.object({
  client_id: z.string().uuid(),
  branch_id: z.string().uuid().nullable().optional(),
});

export const getCustomerBranchLedgerDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => detailSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: detail, error } = await (context.supabase as any).rpc(
      "get_customer_branch_ledger_detail",
      {
        _client_id: data.client_id,
        _branch_id: data.branch_id ?? null,
      },
    );
    if (error) throw new Error(`Customer branch detail failed: ${error.message}`);
    return detail ?? { summary: null, history: [] };
  });

export const listCustomerLedgerBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("branches")
      .select("id, branch_name, city, clients!inner(id, legal_name)")
      .order("branch_name");
    if (error) throw new Error(`Branch filter load failed: ${error.message}`);
    return {
      rows: (data ?? []).map((row: any) => ({
        id: row.id,
        branch_name: row.branch_name,
        city: row.city,
        customer_name: row.clients?.legal_name ?? "Unknown Customer",
      })),
    };
  });
