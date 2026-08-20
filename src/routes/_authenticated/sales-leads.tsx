import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  convertSalesLead,
  createSalesLead,
  getSalesLeadBootstrap,
  listSalesLeads,
  logLeadActivity,
  saveLeadSample,
  updateSalesLead,
} from "@/lib/sales-leads.functions";
import { leadStatuses } from "@/lib/sales-leads";

export const Route = createFileRoute("/_authenticated/sales-leads")({ component: Page });
const control = "w-full rounded border bg-background px-3 py-2 text-sm";
const toIso = (value: string) => (value ? new Date(value).toISOString() : null);

function Page() {
  const list = useServerFn(listSalesLeads),
    bootstrap = useServerFn(getSalesLeadBootstrap),
    create = useServerFn(createSalesLead);
  const activity = useServerFn(logLeadActivity),
    sample = useServerFn(saveLeadSample),
    update = useServerFn(updateSalesLead),
    convert = useServerFn(convertSalesLead);
  const queryClient = useQueryClient();
  const leadsQuery = useQuery({ queryKey: ["sales-leads"], queryFn: () => list({}) });
  const bootstrapQuery = useQuery({
    queryKey: ["sales-lead-bootstrap"],
    queryFn: () => bootstrap({}),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [company, setCompany] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [activityType, setActivityType] = useState("call");
  const [activityNote, setActivityNote] = useState("");
  const [sampleName, setSampleName] = useState("");
  const [sampleQuantity, setSampleQuantity] = useState("");
  const [sampleStatus, setSampleStatus] = useState("planned");
  const [clientId, setClientId] = useState("");
  const [branchId, setBranchId] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sales-leads"] });
  const selected = (leadsQuery.data ?? []).find((lead: any) => lead.id === selectedId) as any;
  const branches = useMemo(
    () =>
      (bootstrapQuery.data?.branches ?? []).filter((branch: any) => branch.client_id === clientId),
    [bootstrapQuery.data?.branches, clientId],
  );
  const createMutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          company_name: company,
          contact_person: contact || undefined,
          phone: phone || undefined,
          next_follow_up_at: toIso(followUp),
        },
      }),
    onSuccess: () => {
      setCompany("");
      setContact("");
      setPhone("");
      setFollowUp("");
      refresh();
    },
  });
  const actionMutation = useMutation({
    mutationFn: async () => {
      if (selected)
        await activity({
          data: {
            lead_id: selected.id,
            activity_type: activityType as any,
            notes: activityNote || undefined,
            next_follow_up_at: toIso(followUp),
          },
        });
    },
    onSuccess: () => {
      setActivityNote("");
      refresh();
    },
  });
  const sampleMutation = useMutation({
    mutationFn: async () => {
      if (selected)
        await sample({
          data: {
            lead_id: selected.id,
            product_name_snapshot: sampleName || undefined,
            quantity: sampleQuantity ? Number(sampleQuantity) : undefined,
            status: sampleStatus as any,
            follow_up_due_at: toIso(followUp),
          },
        });
    },
    onSuccess: refresh,
  });
  const conversionMutation = useMutation({
    mutationFn: async () => {
      if (selected && clientId)
        await convert({
          data: { lead_id: selected.id, client_id: clientId, branch_id: branchId || undefined },
        });
    },
    onSuccess: refresh,
  });
  if (leadsQuery.isLoading) return <p>Loading sales leads...</p>;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Sales Leads</h1>
        <p className="text-sm text-muted-foreground">
          Record outreach, sample follow-up and conversion against real client records.
        </p>
      </div>
      <section className="grid gap-3 rounded border p-4 md:grid-cols-5">
        <input
          className={control}
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          placeholder="Business name"
        />
        <input
          className={control}
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder="Contact person"
        />
        <input
          className={control}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Phone"
        />
        <input
          className={control}
          type="datetime-local"
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
        />
        <button
          className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          disabled={!company || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          Add lead
        </button>
      </section>
      {createMutation.error ? (
        <p className="text-sm text-destructive">{createMutation.error.message}</p>
      ) : null}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
        <div className="space-y-2">
          {(leadsQuery.data ?? []).map((lead: any) => (
            <button
              key={lead.id}
              onClick={() => setSelectedId(lead.id)}
              className={`w-full rounded border p-3 text-left ${selectedId === lead.id ? "border-primary" : ""}`}
            >
              <div className="flex items-center justify-between gap-3">
                <b>{lead.company_name}</b>
                <span className="text-xs capitalize text-muted-foreground">
                  {lead.status.replaceAll("_", " ")}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {lead.contact_person || "No contact"}
                {lead.next_follow_up_at
                  ? ` · Follow up ${new Date(lead.next_follow_up_at).toLocaleString()}`
                  : ""}
              </p>
            </button>
          ))}
        </div>
        <div className="space-y-4 rounded border p-4">
          {selected ? (
            <>
              <div>
                <h2 className="font-semibold">{selected.company_name}</h2>
                <p className="text-sm text-muted-foreground">
                  {selected.phone || "No phone"} {selected.email ? `· ${selected.email}` : ""}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  className={control}
                  value={selected.status}
                  onChange={(event) =>
                    update({
                      data: {
                        lead_id: selected.id,
                        status: event.target.value as any,
                        next_follow_up_at: selected.next_follow_up_at,
                        notes: selected.notes || undefined,
                      },
                    }).then(refresh)
                  }
                >
                  {leadStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
                <input
                  className={control}
                  type="datetime-local"
                  value={followUp}
                  onChange={(event) => setFollowUp(event.target.value)}
                />
              </div>
              <div className="border-t pt-3">
                <h3 className="mb-2 text-sm font-medium">Log activity</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    className={control}
                    value={activityType}
                    onChange={(event) => setActivityType(event.target.value)}
                  >
                    {[
                      "call",
                      "whatsapp",
                      "visit",
                      "email",
                      "note",
                      "follow_up",
                      "response_received",
                    ].map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                  <input
                    className={control}
                    value={activityNote}
                    onChange={(event) => setActivityNote(event.target.value)}
                    placeholder="Outcome or note"
                  />
                </div>
                <button
                  className="mt-2 rounded border px-3 py-2 text-sm"
                  disabled={actionMutation.isPending}
                  onClick={() => actionMutation.mutate()}
                >
                  Save activity
                </button>
              </div>
              <div className="border-t pt-3">
                <h3 className="mb-2 text-sm font-medium">Sample</h3>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input
                    className={control}
                    value={sampleName}
                    onChange={(event) => setSampleName(event.target.value)}
                    placeholder="Product"
                  />
                  <input
                    className={control}
                    type="number"
                    min="0"
                    value={sampleQuantity}
                    onChange={(event) => setSampleQuantity(event.target.value)}
                    placeholder="Quantity"
                  />
                  <select
                    className={control}
                    value={sampleStatus}
                    onChange={(event) => setSampleStatus(event.target.value)}
                  >
                    {["planned", "sent", "delivered", "follow_up_due", "no_conversion"].map(
                      (status) => (
                        <option key={status}>{status}</option>
                      ),
                    )}
                  </select>
                </div>
                <button
                  className="mt-2 rounded border px-3 py-2 text-sm"
                  disabled={sampleMutation.isPending}
                  onClick={() => sampleMutation.mutate()}
                >
                  Save sample
                </button>
              </div>
              <div className="border-t pt-3">
                <h3 className="mb-2 text-sm font-medium">Convert to existing client</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    className={control}
                    value={clientId}
                    onChange={(event) => {
                      setClientId(event.target.value);
                      setBranchId("");
                    }}
                  >
                    <option value="">Select client</option>
                    {(bootstrapQuery.data?.clients ?? []).map((client: any) => (
                      <option key={client.id} value={client.id}>
                        {client.legal_name}
                      </option>
                    ))}
                  </select>
                  <select
                    className={control}
                    value={branchId}
                    onChange={(event) => setBranchId(event.target.value)}
                    disabled={!clientId}
                  >
                    <option value="">No branch</option>
                    {branches.map((branch: any) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.branch_name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  className="mt-2 rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  disabled={!clientId || conversionMutation.isPending}
                  onClick={() => conversionMutation.mutate()}
                >
                  Mark converted
                </button>
              </div>
              <div className="border-t pt-3 text-sm">
                <b>Activity history</b>
                {(selected.lead_activities ?? [])
                  .slice()
                  .reverse()
                  .map((item: any) => (
                    <p key={item.id} className="mt-1 text-muted-foreground">
                      {item.activity_type}: {item.outcome || item.notes || "Recorded"}
                    </p>
                  ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Select a lead to manage its follow-up.</p>
          )}
        </div>
      </section>
    </div>
  );
}
