import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCashOpeningBalanceInfo, setCashOpeningBalance } from "@/lib/cash-in-hand.functions";
import { pkr } from "@/lib/format";

export function OpeningBalanceSettings() {
  const qc = useQueryClient();
  const infoFn = useServerFn(getCashOpeningBalanceInfo);
  const setFn = useServerFn(setCashOpeningBalance);
  const [amount, setAmount] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const infoQ = useQuery({
    queryKey: ["cash-opening-balance-info"],
    queryFn: () => infoFn({}),
  });

  const mut = useMutation({
    mutationFn: () =>
      setFn({
        data: {
          opening_balance: Number(amount),
          effective_at: effectiveAt ? new Date(effectiveAt).toISOString() : undefined,
          reason: reason.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success("Opening balance updated");
      setAmount("");
      setEffectiveAt("");
      setReason("");
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["cash-opening-balance-info"] });
      qc.invalidateQueries({ queryKey: ["cash-in-hand-summary"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update opening balance"),
  });

  const parsedAmount = Number(amount);
  const isValidAmount = amount.trim() !== "" && Number.isFinite(parsedAmount);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cash in Hand — Opening Balance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {infoQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : infoQ.isError ? (
          <div className="text-sm text-destructive">Could not load current opening balance.</div>
        ) : (
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Current Opening Balance
            </div>
            <div className="mt-1 text-xl font-semibold">
              {pkr(infoQ.data?.opening_balance ?? 0)}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Last updated:{" "}
              {infoQ.data?.updated_at ? new Date(infoQ.data.updated_at).toLocaleString() : "never"}
              {infoQ.data?.updated_by_name ? ` by ${infoQ.data.updated_by_name}` : ""}
            </div>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">New Opening Balance</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 50000"
            />
          </div>
          <div>
            <Label className="text-xs">Effective Date/Time (optional)</Label>
            <Input
              type="datetime-local"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea
              rows={1}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this changing?"
            />
          </div>
        </div>

        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button disabled={!isValidAmount || mut.isPending}>Set Opening Balance</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm opening balance change</AlertDialogTitle>
              <AlertDialogDescription>
                This will set the Cash in Hand opening balance to{" "}
                {isValidAmount ? pkr(parsedAmount) : "-"}. The previous value is kept in history,
                not deleted. Cash in Hand across the dashboard and P&L will update immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction data-financial-action onClick={() => mut.mutate()}>
                Confirm
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
