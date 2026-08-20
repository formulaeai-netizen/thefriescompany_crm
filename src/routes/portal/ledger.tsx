import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCustomerPortal } from "@/lib/customer-portal.functions";
export const Route = createFileRoute("/portal/ledger")({ component: Ledger });
function Ledger() {
  const get = useServerFn(getCustomerPortal);
  const q = useQuery({ queryKey: ["customer-portal"], queryFn: () => get({}) });
  if (!q.data) return <p>Loading ledger...</p>;
  const d: any = q.data;
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Ledger</h1>
      <p className="text-sm text-muted-foreground">
        Current payable invoices and verified payments. Deliveries awaiting receiving are not
        collectible.
      </p>
      {d.invoices.map((i: any) => (
        <div className="rounded border p-3" key={i.id}>
          <b>{i.invoice_no}</b>
          <div className="text-sm">
            Rs. {i.amount} - {i.payment_status}
          </div>
          <div className="text-xs text-muted-foreground">Due {i.due_date ?? "-"}</div>
        </div>
      ))}
    </div>
  );
}
