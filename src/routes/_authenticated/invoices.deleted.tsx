import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchDeletedInvoices } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { pkr, fmtDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Trash2, ArrowUpFromLine } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/invoices/deleted")({
  head: () => ({ meta: [{ title: "Deleted Invoices — TFC CRM" }] }),
  component: DeletedInvoicesPage,
});

function DeletedInvoicesPage() {
  const qc = useQueryClient();
  const { data: invoices = [] } = useQuery({
    queryKey: ["invoices-deleted"],
    queryFn: fetchDeletedInvoices,
  });

  const restore = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("invoices")
        .update({ is_deleted: false, deleted_at: null } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices-deleted"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const permaDelete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices-deleted"] });
      toast.success("Invoice permanently deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Deleted Invoices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Archived invoices. Restore them or delete permanently.
        </p>
      </div>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 text-center">
            <Trash2 className="h-12 w-12 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">No deleted invoices</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Deleted invoices will appear here
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
        <Card className="hidden md:block">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card text-xs uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left">Invoice</th>
                    <th className="px-4 py-3 text-left">Client / Branch</th>
                    <th className="px-4 py-3 text-left">Date</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-left">Deleted On</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i: any) => (
                    <tr key={i.id} className="border-b border-border/40 transition hover:bg-muted/40">
                      <td className="px-4 py-3 font-mono text-xs">{i.invoice_no}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{i.clients?.legal_name}</div>
                        {i.branches?.branch_name && (
                          <div className="text-xs text-muted-foreground">{i.branches.branch_name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{fmtDate(i.date)}</td>
                      <td className="tabular px-4 py-3 text-right font-semibold">{pkr(Number(i.amount))}</td>
                      <td className="px-4 py-3 text-muted-foreground">{i.deleted_at ? fmtDate(i.deleted_at) : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-success/30 text-success hover:bg-success/10"
                            onClick={() =>
                              restore.mutate(i.id, {
                                onSuccess: () =>
                                  toast.success(`Invoice ${i.invoice_no} restored`),
                              })
                            }
                          >
                            <ArrowUpFromLine className="mr-1 h-4 w-4" /> Restore
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-destructive/30 text-destructive hover:bg-destructive/10"
                              >
                                <Trash2 className="mr-1 h-4 w-4" /> Delete Permanently
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Permanently delete {i.invoice_no}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Permanently delete {i.invoice_no}? This CANNOT be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() => permaDelete.mutate(i.id)}
                                >
                                  Delete Forever
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <div className="space-y-3 md:hidden">
          {invoices.map((i: any) => (
            <div key={i.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs font-bold text-primary break-all">{i.invoice_no}</span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Deleted {i.deleted_at ? fmtDate(i.deleted_at) : "—"}</span>
              </div>
              <div className="min-w-0 text-sm font-semibold text-foreground">
                <div className="truncate">{i.clients?.legal_name}</div>
                {i.branches?.branch_name && (
                  <div className="truncate text-xs font-normal text-muted-foreground">{i.branches.branch_name}</div>
                )}
              </div>
              <div className="tabular text-xl font-bold text-primary">{pkr(Number(i.amount))}</div>
              <div className="text-xs text-muted-foreground">📅 {fmtDate(i.date)}</div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 border-success/30 text-success hover:bg-success/10"
                  onClick={() =>
                    restore.mutate(i.id, { onSuccess: () => toast.success(`Invoice ${i.invoice_no} restored`) })
                  }
                >
                  <ArrowUpFromLine className="mr-1 h-4 w-4" /> Restore
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="outline" className="flex-1 border-destructive/30 text-destructive hover:bg-destructive/10">
                      <Trash2 className="mr-1 h-4 w-4" /> Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Permanently delete {i.invoice_no}?</AlertDialogTitle>
                      <AlertDialogDescription>Permanently delete {i.invoice_no}? This CANNOT be undone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => permaDelete.mutate(i.id)}
                      >
                        Delete Forever
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
        </>
      )}
    </div>
  );
}
