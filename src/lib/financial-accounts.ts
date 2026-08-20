export type FinancialAccountType = "cash" | "bank";
export type LedgerDirection = "credit" | "debit";
export type AccountLedgerEntryType =
  | "opening_balance"
  | "adjustment"
  | "client_payment_credit"
  | "expense"
  | "inventory_purchase"
  | "salary_payment"
  | "salary_advance"
  | "account_transfer";

export type FinancialAccount = {
  id: string;
  account_key: "cash_in_hand" | "cash_in_bank" | string;
  name: string;
  account_type: FinancialAccountType;
  opening_balance: number;
  active?: boolean;
};

export type AccountLedgerEntry = {
  id: string;
  account_id: string;
  entry_type: AccountLedgerEntryType;
  direction: LedgerDirection;
  amount: number;
  source_key: string;
};

export type AccountBalance = {
  account_id: string;
  account_key: string;
  name: string;
  account_type: FinancialAccountType;
  opening_balance: number;
  credits: number;
  debits: number;
  balance: number;
};

function money(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function insertAccountLedgerEntry(
  ledger: AccountLedgerEntry[],
  entry: AccountLedgerEntry,
): { ledger: AccountLedgerEntry[]; inserted: boolean } {
  if (ledger.some((candidate) => candidate.source_key === entry.source_key)) {
    return { ledger, inserted: false };
  }
  if (!entry.account_id) throw new Error("Financial account is required");
  if (money(entry.amount) <= 0) throw new Error("Ledger amount must be positive");
  return { ledger: [...ledger, entry], inserted: true };
}

export function calculateAccountBalances(
  accounts: FinancialAccount[],
  ledger: AccountLedgerEntry[],
): AccountBalance[] {
  return accounts
    .filter((account) => account.active !== false)
    .map((account) => {
      const entries = ledger.filter((entry) => entry.account_id === account.id);
      const credits = entries
        .filter((entry) => entry.direction === "credit")
        .reduce((sum, entry) => sum + money(entry.amount), 0);
      const debits = entries
        .filter((entry) => entry.direction === "debit")
        .reduce((sum, entry) => sum + money(entry.amount), 0);
      return {
        account_id: account.id,
        account_key: account.account_key,
        name: account.name,
        account_type: account.account_type,
        opening_balance: money(account.opening_balance),
        credits,
        debits,
        balance: money(account.opening_balance) + credits - debits,
      };
    });
}

export function totalLiquidFunds(balances: AccountBalance[]): number {
  return balances
    .filter((balance) => balance.account_type === "cash" || balance.account_type === "bank")
    .reduce((sum, balance) => sum + balance.balance, 0);
}

export function createTransferLedgerEntries(params: {
  transferId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
}): [AccountLedgerEntry, AccountLedgerEntry] {
  if (!params.fromAccountId || !params.toAccountId) {
    throw new Error("Both transfer accounts are required");
  }
  if (params.fromAccountId === params.toAccountId) {
    throw new Error("Source and destination accounts must differ");
  }
  if (money(params.amount) <= 0) throw new Error("Transfer amount must be positive");

  return [
    {
      id: `${params.transferId}-out`,
      account_id: params.fromAccountId,
      entry_type: "account_transfer",
      direction: "debit",
      amount: money(params.amount),
      source_key: `account_transfer:${params.transferId}:out`,
    },
    {
      id: `${params.transferId}-in`,
      account_id: params.toAccountId,
      entry_type: "account_transfer",
      direction: "credit",
      amount: money(params.amount),
      source_key: `account_transfer:${params.transferId}:in`,
    },
  ];
}

export type InvoiceForReceivables = {
  amount?: number | string | null;
  amount_received?: number | string | null;
  payment_status?: string | null;
  due_date?: string | null;
  is_deleted?: boolean | null;
};

export function calculateReceivables(invoices: InvoiceForReceivables[], today: Date) {
  return invoices.reduce(
    (acc, invoice) => {
      if (invoice.is_deleted || invoice.payment_status === "Done") return acc;
      const outstanding = Math.max(money(invoice.amount) - money(invoice.amount_received), 0);
      acc.outstanding += outstanding;
      if (invoice.due_date && new Date(invoice.due_date).getTime() < today.getTime()) {
        acc.overdue += outstanding;
        if (outstanding > 0) acc.overdueCount += 1;
      }
      return acc;
    },
    { outstanding: 0, overdue: 0, overdueCount: 0 },
  );
}

export type CreditPurchaseForPayables = {
  amount_due?: number | string | null;
  status?: string | null;
  due_at?: string | null;
};

export type PayrollForPayables = {
  net_salary?: number | string | null;
  status?: string | null;
};

export function calculatePayables(
  purchases: CreditPurchaseForPayables[],
  payroll: PayrollForPayables[],
  now: Date,
) {
  const supplier = purchases.reduce(
    (acc, purchase) => {
      if (purchase.status !== "unpaid") return acc;
      const amount = money(purchase.amount_due);
      acc.outstanding += amount;
      if (purchase.due_at && new Date(purchase.due_at).getTime() < now.getTime()) {
        acc.overdue += amount;
      }
      return acc;
    },
    { outstanding: 0, overdue: 0 },
  );
  const payrollPayable = payroll
    .filter((row) => row.status === "finalized")
    .reduce((sum, row) => sum + money(row.net_salary), 0);
  return { supplier, payrollPayable };
}

export type PnlInput = {
  invoices: Array<{
    amount?: number | string | null;
    date?: string | null;
    is_deleted?: boolean | null;
  }>;
  expenses: Array<{ price?: number | string | null; date?: string | null }>;
  payroll: Array<{
    net_salary?: number | string | null;
    status?: string | null;
    period?: string | null;
  }>;
  start: string;
  end: string;
};

function inRange(date: string | null | undefined, start: string, end: string): boolean {
  if (!date) return false;
  const key = date.slice(0, 10);
  return key >= start && key <= end;
}

export function calculateTruthfulPnl(input: PnlInput) {
  const revenue = input.invoices
    .filter((invoice) => !invoice.is_deleted && inRange(invoice.date, input.start, input.end))
    .reduce((sum, invoice) => sum + money(invoice.amount), 0);
  const operatingExpenses = input.expenses
    .filter((expense) => inRange(expense.date, input.start, input.end))
    .reduce((sum, expense) => sum + money(expense.price), 0);
  const payrollExpense = input.payroll
    .filter(
      (row) =>
        (row.status === "finalized" || row.status === "paid") &&
        row.period &&
        row.period >= input.start.slice(0, 7) &&
        row.period <= input.end.slice(0, 7),
    )
    .reduce((sum, row) => sum + money(row.net_salary), 0);

  return {
    revenue,
    cogs: null as number | null,
    grossProfit: null as number | null,
    operatingExpenses,
    payrollExpense,
    netProfit: revenue - operatingExpenses - payrollExpense,
  };
}
