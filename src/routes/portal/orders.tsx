import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { createCustomerPortalOrder, getCustomerPortal } from "@/lib/customer-portal.functions";
export const Route = createFileRoute("/portal/orders")({ component: PortalOrders });
function PortalOrders() {
  const get = useServerFn(getCustomerPortal),
    create = useServerFn(createCustomerPortalOrder),
    qc = useQueryClient();
  const q = useQuery({ queryKey: ["customer-portal"], queryFn: () => get({}) });
  const [branch, setBranch] = useState("");
  const [date, setDate] = useState("");
  const [items, setItems] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: (data: any) => create({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["customer-portal"] }),
  });
  if (!q.data) return <p>Loading orders...</p>;
  const d: any = q.data;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <div className="space-y-3 rounded border p-3">
        <select
          className="w-full rounded border p-2"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        >
          <option value="">Choose branch</option>
          {d.branches.map((b: any) => (
            <option key={b.id} value={b.id}>
              {b.branch_name}
            </option>
          ))}
        </select>
        <input
          className="w-full rounded border p-2"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {d.products.map((p: any) => (
          <label key={p.id} className="flex justify-between gap-3 text-sm">
            {p.name}
            <input
              className="w-24 rounded border p-1"
              min="0"
              type="number"
              value={items[p.id] ?? ""}
              onChange={(e) => setItems({ ...items, [p.id]: e.target.value })}
            />
          </label>
        ))}
        <button
          className="w-full rounded bg-primary p-2 text-primary-foreground"
          disabled={m.isPending}
          onClick={() =>
            m.mutate({
              branch_id: branch,
              requested_delivery_date: date,
              items: d.products
                .filter((p: any) => Number(items[p.id]) > 0)
                .map((p: any) => ({
                  product_id: p.id,
                  quantity: Number(items[p.id]),
                  unit: "packs",
                })),
            })
          }
        >
          Submit for review
        </button>
      </div>
      {d.orders.map((o: any) => (
        <div key={o.id} className="rounded border p-3">
          <b>{o.order_number}</b>
          <div className="text-sm text-muted-foreground">
            {o.customer_status} - {o.requested_delivery_date}
          </div>
          <button
            className="mt-2 text-sm underline"
            onClick={() => {
              setBranch(o.branch_id);
              setItems(
                Object.fromEntries(o.items.map((i: any) => [i.product_id, String(i.quantity)])),
              );
            }}
          >
            Order Again
          </button>
        </div>
      ))}
    </div>
  );
}
