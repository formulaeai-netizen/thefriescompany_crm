/**
 * Pure, in-memory mirror of the DB-level cash_ledger_entries design
 * (Phase 1 + the immutability hardening pass): an append-only audit
 * ledger where a UNIQUE index on `source_key` enforces "exactly one
 * linked cash movement per real event", and corrections/voids are always
 * new rows, never rewrites of history. These helpers reproduce that same
 * behavior in TypeScript so the accounting invariants can be unit-tested
 * without a live database connection - the SQL migrations remain the
 * authoritative implementation:
 *   supabase/migrations/20260810150000_cash_ledger_strict_accounting.sql
 *   supabase/migrations/20260810160000_cash_ledger_immutability_hardening.sql
 * This file must stay in sync with them conceptually, not replace them.
 */

export type CashLedgerEntryType =
  | "opening_balance"
  | "adjustment"
  | "client_payment_credit"
  | "expense"
  | "inventory_purchase"
  | "salary_payment"
  | "salary_advance"
  | "account_transfer";

export type CashLedgerDirection = "credit" | "debit";

export type CashLedgerEntry = {
  id: string;
  entry_type: CashLedgerEntryType;
  direction: CashLedgerDirection;
  amount: number;
  source_key: string;
  /** Null for an original/organic entry; points to the entry this one corrects/voids otherwise. */
  reverses_entry_id: string | null;
};

/**
 * Mirrors `INSERT ... ON CONFLICT (source_key) DO NOTHING`: a duplicate
 * source_key is a no-op, never a second cash movement. This is what makes
 * approval retries, double clicks, and duplicate Mark Paid calls safe for
 * client_payment_credit / inventory_purchase / salary_payment entries,
 * which remain single-INSERT, fixed-direction, never corrected in place.
 */
export function insertLedgerEntry(
  ledger: CashLedgerEntry[],
  entry: CashLedgerEntry,
): { ledger: CashLedgerEntry[]; inserted: boolean } {
  if (ledger.some((e) => e.source_key === entry.source_key)) {
    return { ledger, inserted: false };
  }
  return { ledger: [...ledger, entry], inserted: true };
}

/**
 * Mirrors get_cash_in_hand_summary() exactly: 'client_payment_credit',
 * 'inventory_purchase' and 'salary_payment' each have exactly one fixed
 * direction, so a flat SUM(amount) is correct for them. 'expense' is the
 * one type that (after the hardening pass) can contain a mix of debit
 * (original charge / upward correction) and credit (downward correction /
 * void) rows for the same underlying expense. Account transfers can be
 * either direction for a given account. Both must be netted by direction
 * instead - using a flat sum there would double-count a void or transfer.
 */
export function sumLedgerByType(ledger: CashLedgerEntry[], type: CashLedgerEntryType): number {
  const entries = ledger.filter((e) => e.entry_type === type);
  if (type === "expense") {
    return entries.reduce((sum, e) => sum + (e.direction === "debit" ? e.amount : -e.amount), 0);
  }
  if (type === "account_transfer") {
    return entries.reduce((sum, e) => sum + (e.direction === "credit" ? e.amount : -e.amount), 0);
  }
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

/** Adjustments can be either direction, same netting rule, kept as its own named export for clarity at call sites. */
export function sumAdjustments(ledger: CashLedgerEntry[]): number {
  return ledger
    .filter((e) => e.entry_type === "adjustment")
    .reduce((sum, e) => sum + (e.direction === "credit" ? e.amount : -e.amount), 0);
}

function expensePrefix(expenseId: string): string {
  return `expense:${expenseId}:`;
}

/** Current net effect of every ledger row linked to one expense (original + all corrections/voids so far). */
export function effectiveExpenseAmount(ledger: CashLedgerEntry[], expenseId: string): number {
  const prefix = expensePrefix(expenseId);
  return ledger
    .filter((e) => e.source_key.startsWith(prefix))
    .reduce((sum, e) => sum + (e.direction === "debit" ? e.amount : -e.amount), 0);
}

/**
 * Mirrors sync_expense_cash_ledger()'s INSERT/UPDATE-of-price branch:
 * posts only the delta needed to bring the net effect to `newPrice` -
 * never rewrites or removes any prior row. A brand-new expense (empty
 * history) posts one debit for the full price, identical to Phase 1's
 * original single-insert behavior. A no-op edit (newPrice already
 * matches the current effective amount) posts nothing - idempotent by
 * construction, mirroring the SQL's `IF v_delta = 0 THEN RETURN` guard.
 */
export function postExpenseCorrection(
  ledger: CashLedgerEntry[],
  params: { expenseId: string; newPrice: number; idFactory: () => string },
): { ledger: CashLedgerEntry[]; posted: CashLedgerEntry | null } {
  const prefix = expensePrefix(params.expenseId);
  const existing = ledger.filter((e) => e.source_key.startsWith(prefix));
  const effective = existing.reduce(
    (sum, e) => sum + (e.direction === "debit" ? e.amount : -e.amount),
    0,
  );
  const delta = params.newPrice - effective;

  if (delta === 0) return { ledger, posted: null };

  const lastEntry = existing[existing.length - 1] ?? null;
  const seq = existing.length + 1;
  const entry: CashLedgerEntry = {
    id: params.idFactory(),
    entry_type: "expense",
    direction: delta > 0 ? "debit" : "credit",
    amount: Math.abs(delta),
    source_key: `${prefix}v${seq}`,
    reverses_entry_id: lastEntry?.id ?? null,
  };
  return { ledger: [...ledger, entry], posted: entry };
}

/**
 * Mirrors sync_expense_cash_ledger()'s DELETE branch: posts an offsetting
 * void bringing this expense's net ledger effect to zero. The original
 * debit and every prior correction are left completely untouched - this
 * only ever appends. Deleting an expense whose net effect is already
 * zero posts nothing (idempotent).
 */
export function voidExpenseLedger(
  ledger: CashLedgerEntry[],
  params: { expenseId: string; idFactory: () => string },
): { ledger: CashLedgerEntry[]; posted: CashLedgerEntry | null } {
  const prefix = expensePrefix(params.expenseId);
  const existing = ledger.filter((e) => e.source_key.startsWith(prefix));
  const effective = existing.reduce(
    (sum, e) => sum + (e.direction === "debit" ? e.amount : -e.amount),
    0,
  );

  if (effective === 0) return { ledger, posted: null };

  const lastEntry = existing[existing.length - 1] ?? null;
  const seq = existing.length + 1;
  const entry: CashLedgerEntry = {
    id: params.idFactory(),
    entry_type: "expense",
    direction: effective > 0 ? "credit" : "debit",
    amount: Math.abs(effective),
    source_key: `${prefix}void:v${seq}`,
    reverses_entry_id: lastEntry?.id ?? null,
  };
  return { ledger: [...ledger, entry], posted: entry };
}
