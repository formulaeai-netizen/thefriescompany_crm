import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FinancialAccountSelect } from "@/components/financial-account-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { fmtDate, pkr } from "@/lib/format";
import { useIsAdmin } from "@/lib/roles";
import {
  calculateVerificationOutstandingAmount,
  evaluatePaymentVerificationApproval,
  maskPhoneForDisplay,
  truncateMessageId,
} from "@/lib/payment-verifications";
import {
  approvePaymentVerificationRequest,
  listPaymentVerificationRequests,
  rejectPaymentVerificationRequest,
} from "@/lib/payment-verifications.functions";
import { listFinancialAccounts } from "@/lib/financial-accounts.functions";

export const Route = createFileRoute("/_authenticated/payment-verifications")({
  head: () => ({ meta: [{ title: "Payment Verifications - TFC CRM" }] }),
  component: PaymentVerificationsPage,
});

function relation(row: any, key: "clients" | "invoices" | "cash_ledger_entries") {
  const value = row[key];
  return Array.isArray(value) ? value[0] : value;
}

function statusTone(status: string) {
  if (status === "pending") return "border-warning/30 text-warning";
  if (status === "unresolved") return "border-destructive/30 text-destructive";
  if (status === "approved") return "border-success/30 text-success";
  if (status === "rejected") return "border-muted-foreground/30 text-muted-foreground";
  return "";
}

const APPROVAL_BLOCK_MESSAGES: Record<string, string> = {
  already_reviewed: "Already reviewed.",
  unknown_sender: "Unknown sender - no matched client. Cannot be approved.",
  no_invoice_selected: "Select an invoice first.",
  invoice_not_selectable: "Selected invoice is not eligible (paid, archived, or wrong client).",
  amount_mismatch: "Claimed amount does not match the invoice's outstanding amount.",
};

function RejectDialog({ requestId, disabled }: { requestId: string; disabled: boolean }) {
  const qc = useQueryClient();
  const rejectFn = useServerFn(rejectPaymentVerificationRequest);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  const reject = useMutation({
    mutationFn: () => rejectFn({ data: { request_id: requestId, reason: reason.trim() } }),
    onSuccess: () => {
      toast.success("Payment proof rejected");
      qc.invalidateQueries({ queryKey: ["payment-verification-requests"] });
      setOpen(false);
      setReason("");
    },
    onError: (error: any) => toast.error(error?.message ?? "Rejection failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <XCircle className="mr-2 h-4 w-4" />
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject payment claim</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Reason for rejecting this payment claim (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={!reason.trim() || reject.isPending}
            onClick={() => reject.mutate()}
          >
            Confirm Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentVerificationsPage() {
  const qc = useQueryClient();
  const { isAdmin, isLoading } = useIsAdmin();
  const [selectedInvoices, setSelectedInvoices] = useState<Record<string, string>>({});
  const [selectedAccounts, setSelectedAccounts] = useState<Record<string, string>>({});
  const listFn = useServerFn(listPaymentVerificationRequests);
  const approveFn = useServerFn(approvePaymentVerificationRequest);
  const accountsFn = useServerFn(listFinancialAccounts);

  const requestsQ = useQuery({
    queryKey: ["payment-verification-requests"],
    queryFn: () => listFn({}),
    enabled: isAdmin,
  });
  const accountsQ = useQuery({
    queryKey: ["financial-accounts"],
    queryFn: () => accountsFn({}),
    enabled: isAdmin,
  });

  const approve = useMutation({
    mutationFn: ({
      requestId,
      selectedInvoiceId,
      accountId,
    }: {
      requestId: string;
      selectedInvoiceId: string | null;
      accountId: string;
    }) =>
      approveFn({
        data: {
          request_id: requestId,
          selected_invoice_id: selectedInvoiceId,
          account_id: accountId,
        },
      }),
    onSuccess: () => {
      toast.success("Payment approved, invoice closed, selected account credited");
      qc.invalidateQueries({ queryKey: ["payment-verification-requests"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoice-reminders-pending"] });
      qc.invalidateQueries({ queryKey: ["cash-in-hand-summary"] });
      qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Approval failed"),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading access...</div>;

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Admin access is required.
        </CardContent>
      </Card>
    );
  }

  if (requestsQ.isError) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
              Payment Verifications
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review WhatsApp payment confirmations. Approval is the only action that marks invoices
              paid and credits the selected financial account.
            </p>
          </div>
          <Button variant="outline" onClick={() => requestsQ.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">
            Payment verification requests could not be loaded:{" "}
            {requestsQ.error instanceof Error ? requestsQ.error.message : "Unknown error"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const allRows = requestsQ.data?.rows ?? [];
  const unpaidInvoicesByClient = requestsQ.data?.unpaidInvoicesByClient ?? {};
  const migrationRequired = !!requestsQ.data?.migration_required;
  const pendingRows = allRows.filter(
    (r: any) => r.status === "pending" || r.status === "unresolved",
  );
  const decidedRows = allRows.filter(
    (r: any) => r.status === "approved" || r.status === "rejected",
  );
  const accounts = accountsQ.data?.rows ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            Payment Verifications
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review WhatsApp payment confirmations. Approval is the only action that marks invoices
            paid and credits the selected financial account.
          </p>
        </div>
        <Button variant="outline" onClick={() => requestsQ.refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {migrationRequired && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="py-4 text-sm text-muted-foreground">
            Payment verification migration has not been applied yet.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending Review</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="desktop-table overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Created</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Command</TableHead>
                  <TableHead>Invoice / Match</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Message ID</TableHead>
                  <TableHead>Proof</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No payment confirmations need review.
                    </TableCell>
                  </TableRow>
                ) : (
                  pendingRows.map((row: any) => {
                    const client = relation(row, "clients");
                    const invoice = relation(row, "invoices");
                    const clientUnpaidInvoices = row.client_id
                      ? (unpaidInvoicesByClient[row.client_id] ?? [])
                      : [];
                    const selectedInvoiceId = selectedInvoices[row.id] ?? "";
                    const selectedAccountId = selectedAccounts[row.id] ?? "";
                    const selectedInvoice =
                      clientUnpaidInvoices.find(
                        (candidate: any) => candidate.id === selectedInvoiceId,
                      ) ?? invoice;
                    const evaluation = evaluatePaymentVerificationApproval(
                      row,
                      selectedInvoiceId || null,
                      invoice ? [invoice, ...clientUnpaidInvoices] : clientUnpaidInvoices,
                    );
                    const canApprove = evaluation.canApprove && !!selectedAccountId;
                    const claimedAmount =
                      row.claimed_amount != null ? Number(row.claimed_amount) : null;
                    const outstanding = selectedInvoice
                      ? calculateVerificationOutstandingAmount(selectedInvoice)
                      : null;
                    const mismatch =
                      claimedAmount != null && outstanding != null && claimedAmount !== outstanding;

                    return (
                      <TableRow key={row.id} className="align-top">
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDate(row.created_at)}
                        </TableCell>
                        <TableCell>
                          {client?.legal_name ?? (
                            <Badge
                              variant="outline"
                              className="border-destructive/30 text-destructive"
                            >
                              Unknown sender
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[220px] text-xs">
                          <div className="font-mono">
                            {row.normalized_command ?? row.incoming_message ?? "-"}
                          </div>
                          <div className="mt-1 text-muted-foreground">
                            Claimed: {claimedAmount != null ? pkr(claimedAmount) : "-"}
                            {row.parsed_invoice_reference
                              ? ` · Ref: ${row.parsed_invoice_reference}`
                              : ""}
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.status === "unresolved" ? (
                            <div className="w-72 space-y-2">
                              <Select
                                value={selectedInvoiceId}
                                onValueChange={(value) =>
                                  setSelectedInvoices((current) => ({
                                    ...current,
                                    [row.id]: value,
                                  }))
                                }
                              >
                                <SelectTrigger className="h-9">
                                  <SelectValue placeholder="Select unpaid invoice" />
                                </SelectTrigger>
                                <SelectContent>
                                  {clientUnpaidInvoices.map((candidate: any) => (
                                    <SelectItem key={candidate.id} value={candidate.id}>
                                      {candidate.invoice_no ?? "Invoice"} ·{" "}
                                      {fmtDate(candidate.due_date)} ·{" "}
                                      {pkr(calculateVerificationOutstandingAmount(candidate))}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {clientUnpaidInvoices.length === 0 && (
                                <div className="text-xs text-muted-foreground">
                                  No unpaid invoices found for this client.
                                </div>
                              )}
                              {selectedInvoice && (
                                <div className="rounded-md border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground">
                                  <div className="font-mono text-foreground">
                                    {selectedInvoice.invoice_no}
                                  </div>
                                  <div>Due {fmtDate(selectedInvoice.due_date)}</div>
                                  <div>
                                    Amount {pkr(Number(selectedInvoice.amount ?? 0))} · Outstanding{" "}
                                    {pkr(calculateVerificationOutstandingAmount(selectedInvoice))}
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : invoice ? (
                            <div>
                              <div className="font-mono text-xs">{invoice.invoice_no}</div>
                              <div className="text-xs text-muted-foreground">
                                {pkr(Number(invoice.amount ?? 0))} / {invoice.payment_status} ·
                                Outstanding {outstanding != null ? pkr(outstanding) : "-"}
                              </div>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">No invoice linked</span>
                          )}
                          {mismatch && (
                            <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1 text-xs text-destructive">
                              Claimed {pkr(claimedAmount!)} does not match outstanding{" "}
                              {pkr(outstanding!)}.
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {maskPhoneForDisplay(row.normalized_sender_phone ?? row.sender_phone)}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {truncateMessageId(row.inbound_message_id)}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.storage_path ? (
                            <div>
                              <div className="font-mono">
                                {row.media_filename ?? "payment proof"}
                              </div>
                              <div className="text-muted-foreground">
                                {row.media_mimetype ?? ""}
                              </div>
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusTone(row.status)}>
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="space-y-2 text-right">
                          <FinancialAccountSelect
                            accounts={accounts}
                            value={selectedAccountId}
                            onValueChange={(value) =>
                              setSelectedAccounts((current) => ({ ...current, [row.id]: value }))
                            }
                            placeholder="Received in"
                            disabled={approve.isPending}
                          />
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                data-financial-action
                                size="sm"
                                disabled={!canApprove || approve.isPending}
                                title={
                                  canApprove
                                    ? undefined
                                    : !selectedAccountId
                                      ? "Select Cash or Bank first."
                                      : APPROVAL_BLOCK_MESSAGES[evaluation.reason]
                                }
                              >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Approve
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Approve payment confirmation?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will mark invoice{" "}
                                  {selectedInvoice?.invoice_no ?? "the selected invoice"} as paid,
                                  set amount received to the invoice amount, cancel pending
                                  reminders for that invoice, and create exactly one
                                  selected-account credit for{" "}
                                  {claimedAmount != null
                                    ? pkr(claimedAmount)
                                    : "the claimed amount"}
                                  .
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  data-financial-action
                                  disabled={!canApprove || approve.isPending}
                                  onClick={() =>
                                    approve.mutate({
                                      requestId: row.id,
                                      selectedInvoiceId: selectedInvoiceId || null,
                                      accountId: selectedAccountId,
                                    })
                                  }
                                >
                                  Approve payment
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <RejectDialog requestId={row.id} disabled={approve.isPending} />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mobile-card-list">
            {pendingRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No payment confirmations need review.
              </div>
            ) : (
              pendingRows.map((row: any) => {
                const client = relation(row, "clients");
                const invoice = relation(row, "invoices");
                const clientUnpaidInvoices = row.client_id
                  ? (unpaidInvoicesByClient[row.client_id] ?? [])
                  : [];
                const selectedInvoiceId = selectedInvoices[row.id] ?? "";
                const selectedAccountId = selectedAccounts[row.id] ?? "";
                const selectedInvoice =
                  clientUnpaidInvoices.find(
                    (candidate: any) => candidate.id === selectedInvoiceId,
                  ) ?? invoice;
                const evaluation = evaluatePaymentVerificationApproval(
                  row,
                  selectedInvoiceId || null,
                  invoice ? [invoice, ...clientUnpaidInvoices] : clientUnpaidInvoices,
                );
                const canApprove = evaluation.canApprove && !!selectedAccountId;
                const claimedAmount =
                  row.claimed_amount != null ? Number(row.claimed_amount) : null;
                const outstanding = selectedInvoice
                  ? calculateVerificationOutstandingAmount(selectedInvoice)
                  : null;
                const mismatch =
                  claimedAmount != null && outstanding != null && claimedAmount !== outstanding;

                return (
                  <div key={row.id} className="mobile-data-card space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">
                          {client?.legal_name ?? "Unknown sender"}
                        </div>
                        <div className="mt-1 font-mono text-xs text-muted-foreground">
                          {row.normalized_command ?? row.incoming_message ?? "-"}
                        </div>
                      </div>
                      <Badge variant="outline" className={statusTone(row.status)}>
                        {row.status}
                      </Badge>
                    </div>
                    <div className="mobile-data-row">
                      <span>Claimed</span>
                      <span>{claimedAmount != null ? pkr(claimedAmount) : "-"}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Invoice</span>
                      <span>{selectedInvoice?.invoice_no ?? invoice?.invoice_no ?? "-"}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Outstanding</span>
                      <span>{outstanding != null ? pkr(outstanding) : "-"}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Sender</span>
                      <span className="font-mono">
                        {maskPhoneForDisplay(row.normalized_sender_phone ?? row.sender_phone)}
                      </span>
                    </div>
                    {row.status === "unresolved" && (
                      <Select
                        value={selectedInvoiceId}
                        onValueChange={(value) =>
                          setSelectedInvoices((current) => ({ ...current, [row.id]: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select unpaid invoice" />
                        </SelectTrigger>
                        <SelectContent>
                          {clientUnpaidInvoices.map((candidate: any) => (
                            <SelectItem key={candidate.id} value={candidate.id}>
                              {candidate.invoice_no ?? "Invoice"} -{" "}
                              {pkr(calculateVerificationOutstandingAmount(candidate))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {mismatch && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                        Claimed {pkr(claimedAmount!)} does not match outstanding {pkr(outstanding!)}
                        .
                      </div>
                    )}
                    <FinancialAccountSelect
                      accounts={accounts}
                      value={selectedAccountId}
                      onValueChange={(value) =>
                        setSelectedAccounts((current) => ({ ...current, [row.id]: value }))
                      }
                      placeholder="Received in"
                      disabled={approve.isPending}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            data-financial-action
                            disabled={!canApprove || approve.isPending}
                            title={
                              canApprove
                                ? undefined
                                : !selectedAccountId
                                  ? "Select Cash or Bank first."
                                  : APPROVAL_BLOCK_MESSAGES[evaluation.reason]
                            }
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Approve
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Approve payment confirmation?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will mark invoice{" "}
                              {selectedInvoice?.invoice_no ?? "the selected invoice"} as paid and
                              credit the selected account for{" "}
                              {claimedAmount != null ? pkr(claimedAmount) : "the claimed amount"}.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              data-financial-action
                              disabled={!canApprove || approve.isPending}
                              onClick={() =>
                                approve.mutate({
                                  requestId: row.id,
                                  selectedInvoiceId: selectedInvoiceId || null,
                                  accountId: selectedAccountId,
                                })
                              }
                            >
                              Approve payment
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <RejectDialog requestId={row.id} disabled={approve.isPending} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently Decided</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="desktop-table overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reviewed</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Claimed Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Outcome</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decidedRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No decided requests yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  decidedRows.map((row: any) => {
                    const client = relation(row, "clients");
                    const invoice = relation(row, "invoices");
                    const cashEntry = relation(row, "cash_ledger_entries");
                    const claimedAmount =
                      row.claimed_amount != null ? Number(row.claimed_amount) : null;
                    return (
                      <TableRow key={row.id} className="align-top">
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {row.reviewed_at ? fmtDate(row.reviewed_at) : "-"}
                        </TableCell>
                        <TableCell>{client?.legal_name ?? "-"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {invoice?.invoice_no ?? "-"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {claimedAmount != null ? pkr(claimedAmount) : "-"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusTone(row.status)}>
                            {row.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.status === "approved" && (
                            <span className="text-success">
                              Selected account credited
                              {cashEntry ? ` (${pkr(Number(cashEntry.amount))})` : ""}
                            </span>
                          )}
                          {row.status === "rejected" && (
                            <span className="text-muted-foreground">
                              Reason: {row.rejection_reason ?? "-"}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mobile-card-list">
            {decidedRows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No decided requests yet.
              </div>
            ) : (
              decidedRows.map((row: any) => {
                const client = relation(row, "clients");
                const invoice = relation(row, "invoices");
                const cashEntry = relation(row, "cash_ledger_entries");
                const claimedAmount =
                  row.claimed_amount != null ? Number(row.claimed_amount) : null;
                return (
                  <div key={row.id} className="mobile-data-card">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{client?.legal_name ?? "-"}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {invoice?.invoice_no ?? "-"}
                        </div>
                      </div>
                      <Badge variant="outline" className={statusTone(row.status)}>
                        {row.status}
                      </Badge>
                    </div>
                    <div className="mobile-data-row">
                      <span>Reviewed</span>
                      <span>{row.reviewed_at ? fmtDate(row.reviewed_at) : "-"}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Claimed Amount</span>
                      <span>{claimedAmount != null ? pkr(claimedAmount) : "-"}</span>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {row.status === "approved"
                        ? `Selected account credited${cashEntry ? ` (${pkr(Number(cashEntry.amount))})` : ""}`
                        : `Reason: ${row.rejection_reason ?? "-"}`}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
