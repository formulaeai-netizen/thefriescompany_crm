export type CustomerLedgerInvoice = {
  id: string;
  invoice_no: string;
  client_id: string;
  customer_name: string;
  branch_id?: string | null;
  branch_name?: string | null;
  stock_date: string;
  due_date?: string | null;
  item?: string | null;
  weight_kg?: number | string | null;
  no_of_packs?: number | string | null;
  amount: number | string;
  amount_received?: number | string | null;
  payment_status?: string | null;
  receiving_status?: string | null;
  is_deleted?: boolean | null;
};

export type CustomerLedgerRow = {
  invoice_id: string;
  invoice_no: string;
  client_id: string;
  customer_name: string;
  branch_id: string | null;
  branch_name: string;
  branch_key: string;
  stock_date: string;
  stock_quantity: string;
  item: string | null;
  amount: number;
  verified_collections: number;
  due_date: string | null;
  balance: number;
  days_since_stock_sent: number;
  payment_status: string;
  due_status: "paid" | "overdue" | "due_soon" | "not_due";
};

export type CustomerLedgerFilters = {
  search?: string;
  branchId?: string | null;
  balanceStatus?: "all" | "outstanding" | "paid";
  dueStatus?: "all" | "due_soon" | "overdue";
  dateFrom?: string | null;
  dateTo?: string | null;
};

export type CustomerLedgerSummary = {
  uniqueCustomerBranches: number;
  outstandingCustomerBranches: number;
  totalInvoiceValue: number;
  totalOutstandingBalance: number;
  overdueBalance: number;
};

function money(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function daysBetween(currentDate: string, stockDate: string): number {
  const current = Date.parse(`${currentDate}T00:00:00Z`);
  const stock = Date.parse(`${stockDate}T00:00:00Z`);
  if (!Number.isFinite(current) || !Number.isFinite(stock)) return 0;
  return Math.max(Math.floor((current - stock) / 86_400_000), 0);
}

export function formatStockQuantity(input: {
  weight_kg?: number | string | null;
  no_of_packs?: number | string | null;
}): string {
  const kg = money(input.weight_kg);
  const packs = money(input.no_of_packs);
  const fmt = (n: number) => Number(n.toFixed(2)).toString();
  if (kg > 0 && packs > 0) return `${fmt(kg)} kg / ${fmt(packs)} packs`;
  if (kg > 0) return `${fmt(kg)} kg`;
  if (packs > 0) return `${fmt(packs)} packs`;
  return "Not recorded";
}

export function calculateCustomerLedgerBalance(invoice: {
  amount: number | string;
  amount_received?: number | string | null;
  payment_status?: string | null;
  receiving_status?: string | null;
}): { verifiedCollections: number; balance: number } {
  if (invoice.receiving_status === "awaiting_receiving") {
    return { verifiedCollections: 0, balance: 0 };
  }

  const amount = money(invoice.amount);
  const verifiedCollections =
    invoice.payment_status === "Done" ? amount : Math.min(money(invoice.amount_received), amount);
  return {
    verifiedCollections,
    balance: Math.max(amount - verifiedCollections, 0),
  };
}

export function buildCustomerLedgerRows(
  invoices: CustomerLedgerInvoice[],
  currentDate: string,
  filters: CustomerLedgerFilters = {},
): CustomerLedgerRow[] {
  const rows = invoices
    .filter((invoice) => !invoice.is_deleted)
    .filter((invoice) => invoice.receiving_status !== "awaiting_receiving")
    .map((invoice) => {
      const stockDate = invoice.stock_date;
      const { verifiedCollections, balance } = calculateCustomerLedgerBalance(invoice);
      const dueDate = invoice.due_date ?? null;
      const dueStatus: CustomerLedgerRow["due_status"] =
        balance <= 0
          ? "paid"
          : dueDate && dueDate < currentDate
            ? "overdue"
            : dueDate && dueDate <= addDays(currentDate, 7)
              ? "due_soon"
              : "not_due";

      return {
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        client_id: invoice.client_id,
        customer_name: invoice.customer_name,
        branch_id: invoice.branch_id ?? null,
        branch_name: invoice.branch_name?.trim() || "Unassigned Branch",
        branch_key: invoice.branch_id ?? `unassigned:${invoice.client_id}`,
        stock_date: stockDate,
        stock_quantity: formatStockQuantity(invoice),
        item: invoice.item?.trim() || null,
        amount: money(invoice.amount),
        verified_collections: verifiedCollections,
        due_date: dueDate,
        balance,
        days_since_stock_sent: daysBetween(currentDate, stockDate),
        payment_status: invoice.payment_status ?? "Unknown",
        due_status: dueStatus,
      };
    });

  return applyCustomerLedgerFilters(rows, filters);
}

export function applyCustomerLedgerFilters(
  rows: CustomerLedgerRow[],
  filters: CustomerLedgerFilters,
): CustomerLedgerRow[] {
  const search = filters.search?.trim().toLowerCase();
  return rows.filter((row) => {
    if (
      search &&
      ![row.customer_name, row.branch_name, row.invoice_no].join(" ").toLowerCase().includes(search)
    ) {
      return false;
    }
    if (filters.branchId && row.branch_id !== filters.branchId) return false;
    if (filters.dateFrom && row.stock_date < filters.dateFrom) return false;
    if (filters.dateTo && row.stock_date > filters.dateTo) return false;
    if (filters.balanceStatus === "outstanding" && row.balance <= 0) return false;
    if (filters.balanceStatus === "paid" && row.balance !== 0) return false;
    if (filters.dueStatus && filters.dueStatus !== "all" && row.due_status !== filters.dueStatus) {
      return false;
    }
    return true;
  });
}

export function summarizeCustomerLedger(rows: CustomerLedgerRow[]): CustomerLedgerSummary {
  const branchKeys = new Set<string>();
  const outstandingBranchKeys = new Set<string>();
  let totalInvoiceValue = 0;
  let totalOutstandingBalance = 0;
  let overdueBalance = 0;

  for (const row of rows) {
    const key = `${row.client_id}:${row.branch_key}`;
    branchKeys.add(key);
    if (row.balance > 0) outstandingBranchKeys.add(key);
    totalInvoiceValue += row.amount;
    totalOutstandingBalance += row.balance;
    if (row.due_status === "overdue") overdueBalance += row.balance;
  }

  return {
    uniqueCustomerBranches: branchKeys.size,
    outstandingCustomerBranches: outstandingBranchKeys.size,
    totalInvoiceValue,
    totalOutstandingBalance,
    overdueBalance,
  };
}

function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  const d = new Date(t + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}
