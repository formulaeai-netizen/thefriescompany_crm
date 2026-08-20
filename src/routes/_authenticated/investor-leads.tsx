import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  addInvestorLeadActivity,
  listInvestorLeads,
  updateInvestorLead,
} from "@/lib/investor-leads.functions";

export const Route = createFileRoute("/_authenticated/investor-leads")({
  component: InvestorLeadsPage,
});

const statuses = [
  "new",
  "contacted",
  "meeting",
  "due_diligence",
  "negotiation",
  "invested",
  "declined",
] as const;

const activityTypes = ["note", "call", "meeting", "follow_up", "document_shared"] as const;

function InvestorLeadsPage() {
  const list = useServerFn(listInvestorLeads);
  const update = useServerFn(updateInvestorLead);
  const addActivity = useServerFn(addInvestorLeadActivity);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["investor-leads"], queryFn: () => list({}) });
  const [activityDrafts, setActivityDrafts] = useState<
    Record<
      string,
      { notes: string; activity_type: (typeof activityTypes)[number]; next_follow_up_at: string }
    >
  >({});

  const refresh = () => client.invalidateQueries({ queryKey: ["investor-leads"] });
  const statusMutation = useMutation({
    mutationFn: (data: any) => update({ data }),
    onSuccess: refresh,
  });
  const activity = useMutation({
    mutationFn: (data: any) => addActivity({ data }),
    onSuccess: (_, variables) => {
      setActivityDrafts((current) => ({
        ...current,
        [variables.investor_lead_id]: { notes: "", activity_type: "note", next_follow_up_at: "" },
      }));
      refresh();
    },
  });

  if (query.isLoading) return <p>Loading investor leads...</p>;
  if (query.isError) return <p className="text-sm text-destructive">{query.error.message}</p>;

  const leads = query.data ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Investor Interest Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Public investment enquiries. This is separate from customer Sales Leads and investor
          accounts.
        </p>
      </div>
      <div className="space-y-3">
        {leads.map((lead: any) => {
          const draft = activityDrafts[lead.id] ?? {
            notes: "",
            activity_type: "note",
            next_follow_up_at: "",
          };
          const activities = [...(lead.investor_lead_activities ?? [])].sort(
            (a: any, b: any) =>
              new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime(),
          );

          return (
            <section className="rounded border p-4" key={lead.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{lead.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {lead.city} - {lead.contact} - Rs.{" "}
                    {Number(lead.interest_amount).toLocaleString()}
                  </p>
                  {lead.message ? <p className="mt-2 text-sm">{lead.message}</p> : null}
                  {lead.next_follow_up_at ? (
                    <p className="mt-2 text-xs text-amber-600">
                      Next follow-up: {new Date(lead.next_follow_up_at).toLocaleString()}
                    </p>
                  ) : null}
                </div>
                <select
                  className="rounded border bg-background px-3 py-2 text-sm capitalize"
                  value={lead.status}
                  onChange={(event) =>
                    statusMutation.mutate({
                      id: lead.id,
                      status: event.target.value,
                      owner_user_id: lead.owner_user_id,
                      notes: lead.notes,
                      next_follow_up_at: lead.next_follow_up_at,
                    })
                  }
                >
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-[160px_1fr_220px_auto]">
                <select
                  className="rounded border bg-background px-3 py-2 text-sm"
                  value={draft.activity_type}
                  onChange={(event) =>
                    setActivityDrafts((current) => ({
                      ...current,
                      [lead.id]: { ...draft, activity_type: event.target.value as any },
                    }))
                  }
                >
                  {activityTypes.map((type) => (
                    <option key={type} value={type}>
                      {type.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded border bg-background px-3 py-2 text-sm"
                  value={draft.notes}
                  onChange={(event) =>
                    setActivityDrafts((current) => ({
                      ...current,
                      [lead.id]: { ...draft, notes: event.target.value },
                    }))
                  }
                  placeholder="Add internal note"
                />
                <input
                  className="rounded border bg-background px-3 py-2 text-sm"
                  type="datetime-local"
                  value={draft.next_follow_up_at}
                  onChange={(event) =>
                    setActivityDrafts((current) => ({
                      ...current,
                      [lead.id]: { ...draft, next_follow_up_at: event.target.value },
                    }))
                  }
                />
                <button
                  className="rounded border px-3 py-2 text-sm disabled:opacity-50"
                  disabled={activity.isPending || !draft.notes.trim()}
                  onClick={() =>
                    activity.mutate({
                      investor_lead_id: lead.id,
                      activity_type: draft.activity_type,
                      notes: draft.notes.trim(),
                      next_follow_up_at: draft.next_follow_up_at
                        ? new Date(draft.next_follow_up_at).toISOString()
                        : null,
                    })
                  }
                >
                  Save
                </button>
              </div>
              {activities.length ? (
                <div className="mt-3 space-y-2">
                  {activities.slice(0, 3).map((item: any) => (
                    <div key={item.id} className="rounded border bg-muted/30 p-2 text-sm">
                      <p className="font-medium capitalize">
                        {item.activity_type.replaceAll("_", " ")}
                      </p>
                      {item.notes ? <p className="text-muted-foreground">{item.notes}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      {leads.length === 0 ? (
        <p className="rounded border p-4 text-sm text-muted-foreground">
          No investor interest submissions yet.
        </p>
      ) : null}
    </div>
  );
}
