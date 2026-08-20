import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCustomerPortal } from "@/lib/customer-portal.functions";

export const Route = createFileRoute("/portal/")({ component: PortalHome });
function PortalHome() {
  const get = useServerFn(getCustomerPortal);
  const q = useQuery({ queryKey: ["customer-portal"], queryFn: () => get({}) });
  if (q.isLoading) return <p>Loading portal...</p>;
  if (q.isError || !q.data) return <p>Portal access is unavailable.</p>;
  const d: any = q.data;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Customer Portal</h1>
        <p className="text-sm text-muted-foreground">Orders, deliveries and account status.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Current Orders</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl">{d.orders.length}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Outstanding Balance</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl">Rs. {d.summary.outstanding}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Payable Invoices</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl">{d.summary.payable_invoices}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent Payments</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl">{d.summary.verified_payments}</CardContent>
        </Card>
      </div>
      <Link
        to="/portal/orders"
        className="block rounded bg-primary p-3 text-center font-medium text-primary-foreground"
      >
        Place Order
      </Link>
    </div>
  );
}
