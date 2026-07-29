import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemo, useState } from "react";
import { fmtDate } from "@/lib/format";
import { MessageSquare } from "lucide-react";

export const Route = createFileRoute("/_authenticated/whatsapp-logs")({
  head: () => ({ meta: [{ title: "WhatsApp Logs — TFC CRM" }] }),
  component: WhatsAppLogsPage,
});

function statusBadge(s: string) {
  if (s === "sent") return "bg-success/15 text-success border-success/30";
  if (s === "failed") return "bg-destructive/15 text-destructive border-destructive/30";
  return "bg-warning/15 text-warning border-warning/30";
}

function WhatsAppLogsPage() {
  const { data: logs = [] } = useQuery({
    queryKey: ["whatsapp_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_logs")
        .select("*, clients(legal_name), invoices(invoice_no)")
        .order("sent_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const filtered = useMemo(() => {
    return (logs as any[]).filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (from && l.sent_at < from) return false;
      if (to && l.sent_at > `${to}T23:59:59`) return false;
      if (search) {
        const hay = `${l.clients?.legal_name ?? ""} ${l.invoices?.invoice_no ?? ""}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [logs, statusFilter, search, from, to]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">WhatsApp Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every WhatsApp message sent by the autonomous agents and the payment webhook.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Search client / invoice</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="w-64" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Status</label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">From</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">To</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <MessageSquare className="h-10 w-10 opacity-40" />
              <p className="text-sm">No WhatsApp messages logged yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Sent At</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Invoice</th>
                    <th className="px-4 py-3">Message</th>
                    <th className="px-4 py-3">Channel</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l: any) => (
                    <tr key={l.id} className="border-t border-border align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {l.sent_at ? fmtDate(l.sent_at) : "—"}
                        <div className="opacity-60">
                          {l.sent_at ? new Date(l.sent_at).toLocaleTimeString() : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">{l.clients?.legal_name ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{l.invoices?.invoice_no ?? "—"}</td>
                      <td className="max-w-md px-4 py-3 text-xs text-muted-foreground">
                        <div className="line-clamp-3 whitespace-pre-wrap">{l.message}</div>
                      </td>
                      <td className="px-4 py-3 capitalize">{l.channel}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={statusBadge(l.status)}>{l.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}