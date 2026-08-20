import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRightLeft } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FinancialAccountSelect } from "@/components/financial-account-select";
import {
  createAccountTransfer,
  getFinancialAccountBalances,
  listAccountTransfers,
} from "@/lib/financial-accounts.functions";
import { pkr } from "@/lib/format";

export function AccountBalancesCard() {
  const qc = useQueryClient();
  const balancesFn = useServerFn(getFinancialAccountBalances);
  const transferFn = useServerFn(createAccountTransfer);
  const transfersFn = useServerFn(listAccountTransfers);
  const balancesQ = useQuery({
    queryKey: ["financial-account-balances"],
    queryFn: () => balancesFn({}),
  });
  const transfersQ = useQuery({
    queryKey: ["account-transfers"],
    queryFn: () => transfersFn({}),
  });

  const accounts = balancesQ.data?.rows ?? [];
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [amount, setAmount] = useState("");
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const transfer = useMutation({
    mutationFn: () =>
      transferFn({
        data: {
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          amount: Number(amount),
          transfer_date: transferDate,
          reference,
          notes: notes.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Transfer recorded");
      setAmount("");
      setReference("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
      qc.invalidateQueries({ queryKey: ["account-transfers"] });
    },
    onError: (error: any) => toast.error(error?.message ?? "Transfer failed"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ArrowRightLeft className="h-4 w-4 text-primary" />
          Cash / Bank Accounts
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {balancesQ.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Could not load account balances: {(balancesQ.error as Error)?.message}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Cash in Hand" value={balancesQ.data?.cash_in_hand ?? 0} />
            <Metric label="Cash in Bank" value={balancesQ.data?.cash_in_bank ?? 0} />
            <Metric label="Total Liquid Funds" value={balancesQ.data?.total_liquid_funds ?? 0} />
          </div>
        )}

        <div className="grid gap-3 rounded-md border border-border/60 p-3 md:grid-cols-[1fr_1fr_0.8fr_0.8fr_1fr_auto]">
          <div>
            <Label className="text-xs">From</Label>
            <FinancialAccountSelect
              accounts={accounts}
              value={fromAccountId}
              onValueChange={setFromAccountId}
              placeholder="Source"
            />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <FinancialAccountSelect
              accounts={accounts}
              value={toAccountId}
              onValueChange={setToAccountId}
              placeholder="Destination"
            />
          </div>
          <div>
            <Label className="text-xs">Amount</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Date</Label>
            <Input
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button
              className="w-full"
              disabled={
                transfer.isPending ||
                !fromAccountId ||
                !toAccountId ||
                fromAccountId === toAccountId ||
                Number(amount) <= 0 ||
                !transferDate ||
                !reference.trim()
              }
              onClick={() => transfer.mutate()}
            >
              Transfer
            </Button>
          </div>
          <div className="md:col-span-6">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Recent Transfers
          </div>
          {(transfersQ.data?.rows ?? []).slice(0, 5).map((row: any) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border/50 px-3 py-2 text-xs"
            >
              <span className="truncate">{row.reference}</span>
              <span className="tabular font-medium">{pkr(Number(row.amount ?? 0))}</span>
            </div>
          ))}
          {(transfersQ.data?.rows ?? []).length === 0 && (
            <div className="text-xs text-muted-foreground">No transfers recorded yet.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="tabular mt-1 text-xl font-semibold text-primary">{pkr(value)}</div>
    </div>
  );
}
