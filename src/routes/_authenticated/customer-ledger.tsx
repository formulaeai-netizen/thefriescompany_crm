import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Clock, FileText, Search, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getCustomerBranchLedgerDetail,
  getCustomerLedgerSummary,
  listCustomerLedgerBranches,
  listCustomerLedgerRows,
} from "@/lib/customer-ledger.functions";
import { pkr } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/customer-ledger")({
  head: () => ({ meta: [{ title: "Customer Ledger - TFC CRM" }] }),
  component: CustomerLedgerPage,
});

const PAGE_SIZE = 50;

type LedgerRow = {
  invoice_id: string;
  invoice_no: string;
  client_id: string;
  customer_name: string;
  branch_id: string | null;
  branch_name: string;
  contact_number: string | null;
  stock_date: string;
  stock_quantity: string;
  item: string | null;
  amount: number | string;
  verified_collections: number | string;
  due_date: string | null;
  balance: number | string;
  days_since_stock_sent: number;
  payment_status: string;
  last_payment_date: string | null;
  due_status: string;
};

function CustomerLedgerPage() {
  const rowsFn = useServerFn(listCustomerLedgerRows);
  const summaryFn = useServerFn(getCustomerLedgerSummary);
  const branchesFn = useServerFn(listCustomerLedgerBranches);
  const detailFn = useServerFn(getCustomerBranchLedgerDetail);

  const [search, setSearch] = useState("");
  const [branchId, setBranchId] = useState("all");
  const [balanceStatus, setBalanceStatus] = useState<"all" | "outstanding" | "paid">("all");
  const [dueStatus, setDueStatus] = useState<"all" | "due_soon" | "overdue">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<LedgerRow | null>(null);

  const filters = useMemo(
    () => ({
      search: search.trim() || null,
      branch_id: branchId === "all" ? null : branchId,
      balance_status: balanceStatus,
      due_status: dueStatus,
      date_from: dateFrom || null,
      date_to: dateTo || null,
    }),
    [balanceStatus, branchId, dateFrom, dateTo, dueStatus, search],
  );

  const rowsQ = useQuery({
    queryKey: ["customer-ledger", filters, page],
    queryFn: () =>
      rowsFn({
        data: {
          ...filters,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      }),
  });
  const summaryQ = useQuery({
    queryKey: ["customer-ledger-summary", filters],
    queryFn: () => summaryFn({ data: filters }),
  });
  const branchesQ = useQuery({
    queryKey: ["customer-ledger-branches"],
    queryFn: () => branchesFn({}),
  });
  const detail = useMutation({
    mutationFn: (row: LedgerRow) =>
      detailFn({ data: { client_id: row.client_id, branch_id: row.branch_id } }),
  });

  const rows = (rowsQ.data?.rows ?? []) as LedgerRow[];
  const total = Number(rowsQ.data?.total_count ?? 0);
  const hasNext = (page + 1) * PAGE_SIZE < total;

  function openDetail(row: LedgerRow) {
    setSelected(row);
    detail.mutate(row);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          Customer Ledger (Branch Wise)
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto-calculated from Stock Date to Today.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <SummaryCard
          icon={FileText}
          label="Unique Customer Branches"
          value={summaryQ.data?.unique_customer_branches ?? 0}
        />
        <SummaryCard
          icon={WalletCards}
          label="Outstanding Branches"
          value={summaryQ.data?.outstanding_customer_branches ?? 0}
        />
        <SummaryCard
          icon={FileText}
          label="Total Stock Value"
          value={pkr(summaryQ.data?.total_invoice_value ?? 0)}
        />
        <SummaryCard
          icon={WalletCards}
          label="Outstanding Balance"
          value={pkr(summaryQ.data?.total_outstanding_balance ?? 0)}
          emphasize
        />
        <SummaryCard
          icon={Clock}
          label="Overdue Balance"
          value={pkr(summaryQ.data?.overdue_balance ?? 0)}
          danger={Number(summaryQ.data?.overdue_balance ?? 0) > 0}
        />
      </div>

      <Card className="mobile-sticky-filters">
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1.2fr_1fr_0.8fr_0.8fr_0.8fr_0.8fr_auto]">
          <div>
            <Label className="text-xs">Search Customer</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setPage(0);
                  setSearch(e.target.value);
                }}
                placeholder="Customer, branch or invoice"
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Branch</Label>
            <Select
              value={branchId}
              onValueChange={(value) => {
                setPage(0);
                setBranchId(value);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {(branchesQ.data?.rows ?? []).map((branch: any) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.customer_name} - {branch.branch_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Balance</Label>
            <Select
              value={balanceStatus}
              onValueChange={(value: any) => {
                setPage(0);
                setBalanceStatus(value);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="outstanding">Outstanding</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Due</Label>
            <Select
              value={dueStatus}
              onValueChange={(value: any) => {
                setPage(0);
                setDueStatus(value);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="due_soon">Due Soon</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setPage(0);
                setDateFrom(e.target.value);
              }}
            />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setPage(0);
                setDateTo(e.target.value);
              }}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              onClick={() => {
                setSearch("");
                setBranchId("all");
                setBalanceStatus("all");
                setDueStatus("all");
                setDateFrom("");
                setDateTo("");
                setPage(0);
              }}
            >
              Reset
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Ledger Rows</CardTitle>
          <div className="text-xs text-muted-foreground">
            {rowsQ.isLoading ? "Loading..." : `${total} row${total === 1 ? "" : "s"}`}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rowsQ.isError ? (
            <div className="p-4 text-sm text-destructive">
              Could not load customer ledger: {(rowsQ.error as Error)?.message}
            </div>
          ) : (
            <div className="desktop-table overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer Name</TableHead>
                    <TableHead>Branch Name</TableHead>
                    <TableHead>Stock Date</TableHead>
                    <TableHead>Stock Quantity</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Days Since Stock Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow
                      key={row.invoice_id}
                      className="cursor-pointer"
                      onClick={() => openDetail(row)}
                    >
                      <TableCell>
                        <div className="font-medium">{row.customer_name}</div>
                        <div className="text-xs text-muted-foreground">{row.invoice_no}</div>
                      </TableCell>
                      <TableCell>{row.branch_name}</TableCell>
                      <TableCell>{formatDate(row.stock_date)}</TableCell>
                      <TableCell>
                        <div>{row.stock_quantity}</div>
                        {row.item && (
                          <div className="text-xs text-muted-foreground">{row.item}</div>
                        )}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {pkr(Number(row.amount))}
                      </TableCell>
                      <TableCell>
                        <div>{row.due_date ? formatDate(row.due_date) : "-"}</div>
                        <DueBadge status={row.due_status} />
                      </TableCell>
                      <TableCell className="tabular text-right font-semibold">
                        <span
                          className={
                            Number(row.balance) > 0 ? "text-warning" : "text-muted-foreground"
                          }
                        >
                          {pkr(Number(row.balance))}
                        </span>
                      </TableCell>
                      <TableCell className="tabular text-right">
                        <span className="rounded-md border border-border px-2 py-1 font-medium">
                          {row.days_since_stock_sent}d
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                  {!rowsQ.isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                        No customer ledger rows match these filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {!rowsQ.isError && (
            <div className="mobile-card-list">
              {rows.map((row) => (
                <button
                  key={row.invoice_id}
                  type="button"
                  onClick={() => openDetail(row)}
                  className="mobile-data-card text-left"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{row.customer_name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.branch_name}
                      </div>
                      <div className="mt-1 font-mono text-xs text-muted-foreground">
                        {row.invoice_no}
                      </div>
                    </div>
                    <DueBadge status={row.due_status} />
                  </div>
                  <div className="mobile-data-row">
                    <span>Balance</span>
                    <span className="font-semibold text-primary">{pkr(Number(row.balance))}</span>
                  </div>
                  <div className="mobile-data-row">
                    <span>Stock Date</span>
                    <span>{formatDate(row.stock_date)}</span>
                  </div>
                  <div className="mobile-data-row">
                    <span>Stock Quantity</span>
                    <span>{row.stock_quantity}</span>
                  </div>
                  <div className="mobile-data-row">
                    <span>Due Date</span>
                    <span>{row.due_date ? formatDate(row.due_date) : "-"}</span>
                  </div>
                  <div className="mobile-data-row">
                    <span>Days Since Stock Sent</span>
                    <span>{row.days_since_stock_sent}d</span>
                  </div>
                  {row.item && <div className="mt-2 text-xs text-muted-foreground">{row.item}</div>}
                </button>
              ))}
              {!rowsQ.isLoading && rows.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No customer ledger rows match these filters.
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-between border-t border-border p-3 text-sm">
            <span className="text-muted-foreground">
              Page {page + 1} of {Math.max(Math.ceil(total / PAGE_SIZE), 1)}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(p - 1, 0))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Customer Branch Ledger</DialogTitle>
          </DialogHeader>
          {detail.isPending ? (
            <div className="py-8 text-sm text-muted-foreground">Loading branch ledger...</div>
          ) : detail.isError ? (
            <div className="py-8 text-sm text-destructive">
              Could not load branch detail: {(detail.error as Error)?.message}
            </div>
          ) : (
            <BranchDetail detail={detail.data} fallback={selected} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  emphasize,
  danger,
}: {
  icon: typeof FileText;
  label: string;
  value: string | number;
  emphasize?: boolean;
  danger?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div
          className={`tabular mt-2 text-xl font-semibold ${
            danger ? "text-destructive" : emphasize ? "text-primary" : "text-foreground"
          }`}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function BranchDetail({ detail, fallback }: { detail: any; fallback: LedgerRow | null }) {
  const summary = detail?.summary ?? {};
  const history = (detail?.history ?? []) as LedgerRow[];
  return (
    <div className="space-y-4">
      <div>
        <div className="text-lg font-semibold">
          {summary.customer_name ?? fallback?.customer_name ?? "-"}
        </div>
        <div className="text-sm text-muted-foreground">
          {summary.branch_name ?? fallback?.branch_name ?? "-"}
          {summary.contact_number ? ` · ${maskPhone(summary.contact_number)}` : ""}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-5">
        <SummaryCard
          icon={FileText}
          label="Total Stock/Sales"
          value={pkr(summary.total_stock_sales_value ?? 0)}
        />
        <SummaryCard
          icon={WalletCards}
          label="Verified Collections"
          value={pkr(summary.total_verified_collections ?? 0)}
        />
        <SummaryCard
          icon={WalletCards}
          label="Current Outstanding"
          value={pkr(summary.current_outstanding ?? 0)}
          emphasize
        />
        <SummaryCard
          icon={CalendarDays}
          label="Oldest Outstanding"
          value={
            summary.oldest_outstanding_stock_date
              ? formatDate(summary.oldest_outstanding_stock_date)
              : "-"
          }
        />
        <SummaryCard
          icon={Clock}
          label="Oldest Days"
          value={summary.current_oldest_days_since_stock_sent ?? 0}
        />
      </div>
      <div className="desktop-table max-h-[45vh] overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Invoice/Dispatch</TableHead>
              <TableHead>Products/Quantity</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-right">Verified Payments</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((row) => (
              <TableRow key={row.invoice_id}>
                <TableCell>{formatDate(row.stock_date)}</TableCell>
                <TableCell>{row.invoice_no}</TableCell>
                <TableCell>
                  {row.item ? `${row.item} · ` : ""}
                  {row.stock_quantity}
                </TableCell>
                <TableCell className="tabular text-right">{pkr(Number(row.amount))}</TableCell>
                <TableCell>{row.due_date ? formatDate(row.due_date) : "-"}</TableCell>
                <TableCell className="tabular text-right">
                  {pkr(Number(row.verified_collections ?? 0))}
                </TableCell>
                <TableCell className="tabular text-right font-semibold">
                  {pkr(Number(row.balance))}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{row.payment_status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mobile-card-list max-h-[48vh] overflow-y-auto rounded-md border border-border p-2">
        {history.map((row) => (
          <div key={row.invoice_id} className="mobile-data-card">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{row.invoice_no}</div>
                <div className="text-xs text-muted-foreground">{formatDate(row.stock_date)}</div>
              </div>
              <Badge variant="outline">{row.payment_status}</Badge>
            </div>
            <div className="mobile-data-row">
              <span>Products / Quantity</span>
              <span>
                {row.item ? `${row.item} - ` : ""}
                {row.stock_quantity}
              </span>
            </div>
            <div className="mobile-data-row">
              <span>Amount</span>
              <span>{pkr(Number(row.amount))}</span>
            </div>
            <div className="mobile-data-row">
              <span>Due Date</span>
              <span>{row.due_date ? formatDate(row.due_date) : "-"}</span>
            </div>
            <div className="mobile-data-row">
              <span>Verified Payments</span>
              <span>{pkr(Number(row.verified_collections ?? 0))}</span>
            </div>
            <div className="mobile-data-row">
              <span>Balance</span>
              <span className="font-semibold text-primary">{pkr(Number(row.balance))}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DueBadge({ status }: { status: string }) {
  if (status === "paid") {
    return (
      <Badge className="mt-1 border-success/40 text-success" variant="outline">
        Paid
      </Badge>
    );
  }
  if (status === "overdue") {
    return (
      <Badge className="mt-1 border-destructive/40 text-destructive" variant="outline">
        Overdue
      </Badge>
    );
  }
  if (status === "due_soon") {
    return (
      <Badge className="mt-1 border-warning/40 text-warning" variant="outline">
        Due Soon
      </Badge>
    );
  }
  return (
    <Badge className="mt-1" variant="outline">
      Not Due
    </Badge>
  );
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function maskPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "-";
  return `${digits.slice(0, 3)}*******${digits.slice(-2)}`;
}
