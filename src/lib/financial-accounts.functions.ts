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

export const listFinancialAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("financial_accounts")
      .select("id, account_key, name, account_type, opening_balance, active")
      .eq("active", true)
      .order("account_key", { ascending: true });
    if (error) throw new Error(`Financial account list failed: ${error.message}`);
    return { rows: data ?? [] };
  });

export const getFinancialAccountBalances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any).rpc("get_financial_account_balances");
    if (error) throw new Error(`Financial account balances failed: ${error.message}`);
    const rows = (data ?? []).map((row: any) => ({
      ...row,
      opening_balance: Number(row.opening_balance ?? 0),
      credits: Number(row.credits ?? 0),
      debits: Number(row.debits ?? 0),
      balance: Number(row.balance ?? 0),
    }));
    return {
      rows,
      cash_in_hand: Number(
        rows.find((row: any) => row.account_key === "cash_in_hand")?.balance ?? 0,
      ),
      cash_in_bank: Number(
        rows.find((row: any) => row.account_key === "cash_in_bank")?.balance ?? 0,
      ),
      total_liquid_funds: rows.reduce((sum: number, row: any) => sum + Number(row.balance ?? 0), 0),
    };
  });

const transferSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount: z.number().positive("Transfer amount must be positive"),
  transfer_date: z.string().min(1),
  reference: z.string().trim().min(1, "Reference/notes are required").max(500),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const createAccountTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => transferSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: id, error } = await (context.supabase as any).rpc("create_account_transfer", {
      _from_account_id: data.from_account_id,
      _to_account_id: data.to_account_id,
      _amount: data.amount,
      _transfer_date: data.transfer_date,
      _reference: data.reference.trim(),
      _notes: data.notes?.trim() || null,
    });
    if (error) throw new Error(`Account transfer failed: ${error.message}`);
    return { ok: true, id };
  });

export const listAccountTransfers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("account_transfers")
      .select(
        "id, from_account_id, to_account_id, amount, transfer_date, reference, notes, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`Account transfer history failed: ${error.message}`);
    return { rows: data ?? [] };
  });

const pnlSchema = z.object({
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});

export const getProfitAndLossSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => pnlSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await (context.supabase as any).rpc(
      "get_profit_and_loss_summary",
      {
        _start_date: data.start_date,
        _end_date: data.end_date,
      },
    );
    if (error) throw new Error(`P&L summary failed: ${error.message}`);
    return row ?? {};
  });

const ownerHealthSchema = z.object({
  start_date: z.string().min(1),
  end_date: z.string().min(1),
  prev_start_date: z.string().min(1),
  prev_end_date: z.string().min(1),
});

export const getOwnerBusinessHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => ownerHealthSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: row, error } = await (context.supabase as any).rpc("get_owner_business_health", {
      _start_date: data.start_date,
      _end_date: data.end_date,
      _prev_start_date: data.prev_start_date,
      _prev_end_date: data.prev_end_date,
    });
    if (error) throw new Error(`Owner business health failed: ${error.message}`);
    return row ?? {};
  });
