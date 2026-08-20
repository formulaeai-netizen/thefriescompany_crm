import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  approveAllocationPlan,
  cancelAllocationPlan,
  createAllocationPlan,
  getAllocationDeliveryPlanner,
} from "@/lib/allocation-delivery.functions";
import { buildDeliveryPlan } from "@/lib/allocation-delivery";

export const Route = createFileRoute("/_authenticated/allocation-delivery-plan")({
  component: Page,
});
function Page() {
  const [approvedQuantities, setApprovedQuantities] = useState<Record<string, string>>({});
  const qc = useQueryClient(),
    get = useServerFn(getAllocationDeliveryPlanner),
    create = useServerFn(createAllocationPlan),
    approve = useServerFn(approveAllocationPlan),
    cancel = useServerFn(cancelAllocationPlan);
  const q = useQuery({ queryKey: ["allocation-delivery"], queryFn: () => get({}) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["allocation-delivery"] });
  const c = useMutation({ mutationFn: (data: any) => create({ data }), onSuccess: refresh }),
    a = useMutation({
      mutationFn: (data: { plan_id: string; items: unknown[] }) => approve({ data }),
      onSuccess: refresh,
    }),
    x = useMutation({
      mutationFn: (id: string) => cancel({ data: { plan_id: id } }),
      onSuccess: refresh,
    });
  if (q.isLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading allocation plan...</div>;
  if (q.isError)
    return <div className="p-6 text-sm text-destructive">Could not load allocation plan.</div>;
  const data = q.data;
  if (!data) return null;
  const deliveryPlan = buildDeliveryPlan(
    data.proposals.flatMap((proposal: any) => proposal.suggestions),
    data.today,
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Allocation &amp; Delivery Plan</h1>
        <p className="text-sm text-muted-foreground">
          Advisory only. Approval records an operational plan; it never creates invoices,
          receivables, Cash or Bank entries.
        </p>
      </div>
      {data.proposals.map((p: any) => (
        <Card key={p.suggestions[0]?.product_id}>
          <CardHeader>
            <CardTitle className="text-base">
              {p.suggestions[0]?.product_name}{" "}
              <span className="text-muted-foreground">
                Available {p.available_quantity} / Demand {p.total_demand} / Allocated{" "}
                {p.allocated_quantity} / Additional production required {p.remaining_shortage}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge>Allocated {p.allocated_quantity}</Badge>
              <Badge variant="outline">
                Receiving {p.customers_receiving_something}/{p.customers_waiting}
              </Badge>
              {p.minimum_viable_warning && (
                <Badge variant="destructive">Minimum viable shortage</Badge>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th>Customer / Branch</th>
                    <th>Order</th>
                    <th>Demand</th>
                    <th>Suggested</th>
                    <th>Priority / Delivery</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {p.suggestions.map((r: any) => (
                    <tr className="border-t" key={r.sales_order_item_id}>
                      <td>
                        {r.client_name}
                        <div className="text-xs text-muted-foreground">{r.branch_name}</div>
                      </td>
                      <td>{r.order_number}</td>
                      <td>{r.remaining_quantity}</td>
                      <td className="font-medium">{r.suggested_quantity}</td>
                      <td>
                        <Badge variant="outline">{r.priority}</Badge>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {r.planned_delivery_date}
                        </div>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              data-financial-action
              disabled={c.isPending || p.allocated_quantity <= 0}
              onClick={() =>
                c.mutate({
                  strategy: p.strategy,
                  items: p.suggestions.map((r: any) => ({
                    ...r,
                    waiting_days: Math.max(
                      0,
                      Math.floor(
                        (new Date(data.today).getTime() - new Date(r.ordered_at).getTime()) /
                          86400000,
                      ),
                    ),
                  })),
                })
              }
            >
              Create Draft Allocation
            </Button>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Delivery Outlook</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {[
            ["Today", deliveryPlan.today],
            ["Tomorrow", deliveryPlan.tomorrow],
            ["Upcoming", deliveryPlan.upcoming],
          ].map(([label, entries]: any) => (
            <div className="space-y-2" key={label}>
              <div className="font-medium">{label}</div>
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No proposed deliveries.</p>
              ) : (
                entries.map((entry: any) => (
                  <div className="border-b pb-2 text-sm" key={entry.sales_order_item_id}>
                    <div>{entry.client_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.branch_name} - {entry.order_number} - {entry.suggested_quantity}{" "}
                      {entry.unit}
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
          {deliveryPlan.consolidation.length > 0 && (
            <div className="md:col-span-3 text-sm text-muted-foreground">
              {deliveryPlan.consolidation.map((group) => (
                <div key={group.date}>
                  {group.deliveries} compatible deliveries can be completed on {group.date}.
                </div>
              ))}
              <div className="mt-1">Full route optimization requires branch location data.</div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Saved Allocation Plans</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {data.plans.map((p: any) => (
            <div className="space-y-3 border-b pb-3" key={p.id}>
              <div>
                <b>{p.strategy}</b> <Badge variant="outline">{p.status}</Badge>
                <div className="text-xs text-muted-foreground">
                  {(p.stock_allocation_plan_items ?? []).length} allocation lines
                </div>
              </div>
              {p.status === "draft" && (p.stock_allocation_plan_items ?? []).length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th>Order</th>
                        <th>Suggested</th>
                        <th>Approved quantity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(p.stock_allocation_plan_items ?? []).map((line: any) => (
                        <tr className="border-t" key={line.id}>
                          <td>{line.order_number_snapshot}</td>
                          <td>{line.original_suggested_quantity}</td>
                          <td>
                            <input
                              className="h-8 w-24 rounded border bg-background px-2"
                              max={line.remaining_quantity}
                              min="0"
                              type="number"
                              value={
                                approvedQuantities[line.id] ?? line.original_suggested_quantity
                              }
                              onChange={(event) =>
                                setApprovedQuantities((current) => ({
                                  ...current,
                                  [line.id]: event.target.value,
                                }))
                              }
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="flex gap-2">
                {p.status === "draft" && (
                  <Button
                    size="sm"
                    data-financial-action
                    onClick={() =>
                      a.mutate({
                        plan_id: p.id,
                        items: (p.stock_allocation_plan_items ?? []).map((line: any) => ({
                          id: line.id,
                          approved_quantity: Number(
                            approvedQuantities[line.id] ?? line.original_suggested_quantity,
                          ),
                          planned_delivery_date: line.planned_delivery_date,
                        })),
                      })
                    }
                  >
                    Approve
                  </Button>
                )}
                {["draft", "approved"].includes(p.status) && (
                  <Button size="sm" variant="outline" onClick={() => x.mutate(p.id)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
