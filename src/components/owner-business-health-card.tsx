import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Activity, AlertTriangle, Landmark, ReceiptText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOwnerBusinessHealth } from "@/lib/financial-accounts.functions";
import { pkr } from "@/lib/format";

function periodBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  return {
    start: key(start),
    end: key(end),
    prevStart: key(prevStart),
    prevEnd: key(prevEnd),
  };
}

export function OwnerBusinessHealthCard() {
  const healthFn = useServerFn(getOwnerBusinessHealth);
  const bounds = periodBounds();
  const healthQ = useQuery({
    queryKey: ["owner-business-health", bounds.start, bounds.end],
    queryFn: () =>
      healthFn({
        data: {
          start_date: bounds.start,
          end_date: bounds.end,
          prev_start_date: bounds.prevStart,
          prev_end_date: bounds.prevEnd,
        },
      }),
  });

  const position = healthQ.data?.financial_position ?? {};
  const performance = healthQ.data?.performance ?? {};
  const operations = healthQ.data?.operations ?? {};
  const direction = healthQ.data?.direction ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" />
          Owner Business Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        {healthQ.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Could not load owner dashboard: {(healthQ.error as Error)?.message}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-4">
            <Metric
              icon={Landmark}
              label="Cash in Hand"
              value={pkr(Number(position.cash_in_hand ?? 0))}
            />
            <Metric
              icon={Landmark}
              label="Cash in Bank"
              value={pkr(Number(position.cash_in_bank ?? 0))}
            />
            <Metric
              icon={Landmark}
              label="Liquid Funds"
              value={pkr(Number(position.total_liquid_funds ?? 0))}
            />
            <Metric
              icon={ReceiptText}
              label="Receivables"
              value={pkr(Number(position.accounts_receivable ?? 0))}
              sub={`${pkr(Number(position.overdue_receivables ?? 0))} overdue`}
            />
            <Metric
              icon={ReceiptText}
              label="Supplier Payables"
              value={pkr(Number(position.supplier_credit_payables ?? 0))}
              sub={`${pkr(Number(position.supplier_overdue ?? 0))} overdue`}
            />
            <Metric
              icon={ReceiptText}
              label="Payroll Payable"
              value={pkr(Number(position.payroll_payable ?? 0))}
            />
            <Metric
              icon={Activity}
              label="Net Profit"
              value={pkr(Number(performance.net_profit ?? 0))}
              sub={direction.net_profit_positive ? "positive" : "negative"}
            />
            <Metric
              icon={AlertTriangle}
              label="Open Alerts"
              value={String(Number(operations.unresolved_operational_alerts ?? 0))}
              sub={`${Number(operations.low_stock_count ?? 0)} low stock`}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <div className="tabular mt-1 text-lg font-semibold text-primary">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
