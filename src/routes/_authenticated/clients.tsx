import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchClients } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useState } from "react";
import { AlertCircle, Phone, MapPin, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import { fetchInvoices } from "@/lib/queries";

function LastOrderBadge({ clientId, invoices }: { clientId: string; invoices: any[] }) {
  const latest = invoices
    .filter((i) => i.client_id === clientId && i.delivery_date)
    .map((i) => i.delivery_date as string)
    .sort()
    .pop();
  if (!latest) return <Badge variant="outline" className="text-[10px] text-muted-foreground">No orders yet</Badge>;
  const days = Math.floor((Date.now() - new Date(latest).getTime()) / 86400000);
  const cls = days < 7
    ? "border-success/40 bg-success/10 text-success"
    : days <= 14
      ? "border-warning/40 bg-warning/10 text-warning"
      : "border-destructive/40 bg-destructive/10 text-destructive";
  return (
    <div className="flex flex-wrap gap-1">
      <Badge variant="outline" className={`text-[10px] ${cls}`}>Last order: {days}d ago</Badge>
      {days > 14 && (
        <Badge variant="outline" className="text-[10px] border-destructive/40 bg-destructive/10 text-destructive">⚠ Reorder Due</Badge>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clients & Leads — TFC CRM" }] }),
  component: ClientsPage,
});

function statusColor(s: string) {
  if (s === "Active") return "bg-success/15 text-success border-success/30";
  if (s === "Inactive") return "bg-muted text-muted-foreground border-border";
  return "bg-warning/15 text-warning border-warning/30";
}

function ClientsPage() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const { data: invoices = [] } = useQuery({ queryKey: ["invoices"], queryFn: fetchInvoices });
  const [q, setQ] = useState("");
  const [tab, setTab] = useState("paying");
  const [addOpen, setAddOpen] = useState(false);

  const deleteClient = useMutation({
    mutationFn: async (id: string) => {
      // Cascade-delete invoices + branches first (no FK cascade configured).
      const inv = await supabase.from("invoices").delete().eq("client_id", id);
      if (inv.error) throw inv.error;
      const br = await supabase.from("branches").delete().eq("client_id", id);
      if (br.error) throw br.error;
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const DeleteBtn = ({ c }: { c: any }) => {
    const invCount = c.invoices?.length ?? 0;
    return (
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:bg-destructive/10"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {c.legal_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {invCount > 0
                ? `This client has ${invCount} invoice${invCount === 1 ? "" : "s"} linked — deleting will remove them too. This cannot be undone.`
                : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteClient.mutate(c.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  const filter = (rows: any[]) =>
    rows.filter(
      (r) =>
        !q ||
        r.legal_name?.toLowerCase().includes(q.toLowerCase()) ||
        r.client_code?.toLowerCase().includes(q.toLowerCase()) ||
        r.city?.toLowerCase().includes(q.toLowerCase()),
    );

  const paying = filter(data.filter((c: any) => c.client_type === "Paying Client"));
  const leads = filter(data.filter((c: any) => c.client_type === "Prospect"));

  const nextFgCode = () => {
    const nums = data
      .map((c: any) => c.client_code?.match(/^FG-(\d+)$/i)?.[1])
      .filter(Boolean)
      .map((n: string) => parseInt(n, 10));
    const next = (nums.length ? Math.max(...nums) : 0) + 1;
    return `FG-${String(next).padStart(3, "0")}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Clients & Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paying revenue clients and the prospects pipeline, kept as separate views.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, code or city…"
            className="max-w-xs"
          />
          <Button
            onClick={() => setAddOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            {tab === "leads" ? "Add Lead" : "Add Client"}
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="paying">Paying Clients ({paying.length})</TabsTrigger>
          <TabsTrigger value="leads">Leads Pipeline ({leads.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="paying" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {paying.map((c: any) => (
              <Card key={c.id}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">{c.client_code}</div>
                      <h3 className="text-lg font-semibold">{c.legal_name}</h3>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge className={statusColor(c.status)}>{c.status}</Badge>
                      <DeleteBtn c={c} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" /> {c.city}
                  </div>
                  {c.branches?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {c.branches.map((b: any) => (
                        <Badge key={b.id} variant="outline" className="text-xs">
                          {b.branch_name}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="pt-1"><LastOrderBadge clientId={c.id} invoices={invoices as any[]} /></div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leads" className="mt-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {leads.map((c: any) => {
              const incomplete = !c.phone || !c.primary_contact;
              return (
                <Card key={c.id}>
                  <CardContent className="space-y-2 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{c.client_code}</div>
                        <h3 className="font-semibold">{c.legal_name}</h3>
                      </div>
                      <div className="flex items-center gap-1">
                        <Badge className={statusColor(c.status)} variant="outline">
                          {c.status}
                        </Badge>
                        <DeleteBtn c={c} />
                      </div>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3 w-3" /> {c.city}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Phone className="h-3 w-3" /> {c.phone ?? "missing"} · {c.primary_contact ?? "no contact"}
                      </div>
                    </div>
                    {incomplete && (
                      <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning text-[10px]">
                        <AlertCircle className="mr-1 h-3 w-3" /> Incomplete profile
                      </Badge>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      <AddClientDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode={tab === "leads" ? "lead" : "paying"}
        suggestedCode={tab === "leads" ? nextFgCode() : ""}
        onAdded={() => qc.invalidateQueries({ queryKey: ["clients"] })}
      />
    </div>
  );
}

type AddMode = "paying" | "lead";

function AddClientDialog({
  open,
  onOpenChange,
  mode,
  suggestedCode,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: AddMode;
  suggestedCode: string;
  onAdded: () => void;
}) {
  const isLead = mode === "lead";
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  // Reset form when opened or mode changes
  const initial = () =>
    isLead
      ? {
          client_code: suggestedCode,
          legal_name: "",
          dba: "",
          business_type: "",
          city: "",
          primary_contact: "",
          phone: "",
          email: "",
          sales_rep: "Mushaf",
          status: "Active",
          stage: "Lead",
          notes: "",
        }
      : {
          client_code: "",
          legal_name: "",
          city: "",
          primary_contact: "",
          phone: "",
          email: "",
          sales_rep: "Mushaf",
          status: "Active",
          notes: "",
        };

  // Re-initialize when dialog opens
  const handleOpenChange = (v: boolean) => {
    if (v) setForm(initial());
    onOpenChange(v);
  };

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.client_code?.trim() || !form.legal_name?.trim() || !form.city?.trim()) {
      toast.error("Client Code, Legal Name and City are required");
      return;
    }
    setSaving(true);
    const payload: any = {
      client_code: form.client_code.trim(),
      legal_name: form.legal_name.trim(),
      city: form.city.trim(),
      primary_contact: form.primary_contact?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      sales_rep: form.sales_rep?.trim() || "Mushaf",
      status: form.status || "Active",
      notes: form.notes?.trim() || null,
      client_type: isLead ? "Prospect" : "Paying Client",
    };
    if (isLead) {
      payload.dba = form.dba?.trim() || null;
      payload.business_type = form.business_type?.trim() || null;
      // `stage` is not a column on clients — prefix it onto notes for now.
      const stage = form.stage || "Lead";
      payload.notes = [`Stage: ${stage}`, payload.notes].filter(Boolean).join(" — ");
    }
    const { error } = await supabase.from("clients").insert(payload);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Client added successfully");
    onAdded();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isLead ? "Add Lead" : "Add Paying Client"}</DialogTitle>
          <DialogDescription>
            {isLead
              ? "Create a new prospect in the leads pipeline."
              : "Create a new paying client record."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Client Code *</Label>
            <Input
              value={form.client_code ?? ""}
              onChange={(e) => set("client_code", e.target.value)}
              placeholder={isLead ? "FG-001" : "BB-002"}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Legal Name *</Label>
            <Input
              value={form.legal_name ?? ""}
              onChange={(e) => set("legal_name", e.target.value)}
            />
          </div>
          {isLead && (
            <>
              <div className="grid gap-1.5">
                <Label>DBA / Brand Name</Label>
                <Input value={form.dba ?? ""} onChange={(e) => set("dba", e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Business Type</Label>
                <Input
                  value={form.business_type ?? ""}
                  onChange={(e) => set("business_type", e.target.value)}
                />
              </div>
            </>
          )}
          <div className="grid gap-1.5">
            <Label>City *</Label>
            <Input value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Primary Contact</Label>
            <Input
              value={form.primary_contact ?? ""}
              onChange={(e) => set("primary_contact", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone ?? ""}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="923001234567"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Sales Rep</Label>
              <Input
                value={form.sales_rep ?? ""}
                onChange={(e) => set("sales_rep", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isLead && (
            <div className="grid gap-1.5">
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={(v) => set("stage", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Lead", "Contacted", "Pitched", "Negotiating", "Active", "Inactive"].map(
                    (s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saving}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? "Saving…" : isLead ? "Add Lead" : "Add Client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}