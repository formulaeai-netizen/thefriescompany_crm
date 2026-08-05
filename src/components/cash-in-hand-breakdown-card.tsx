import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buildCashInHandDisplayRows, type CashInHandSummary } from "@/lib/cash-in-hand";
import { getCashInHandSummary } from "@/lib/cash-in-hand.functions";
import { pkr } from "@/lib/format";

/**
 * Single shared Cash in Hand breakdown, backed by the Prompt 2
 * get_cash_in_hand_summary() RPC. Used by both the dashboard and the P&L
 * page so the two can never render the formula differently. Loading and
 * error states are handled here so callers stay simple.
 */
export function CashInHandBreakdownCard() {
  const summaryFn = useServerFn(getCashInHandSummary);
  const summaryQ = useQuery({
    queryKey: ["cash-in-hand-summary"],
    queryFn: () => summaryFn({}),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Cash in Hand</CardTitle>
      </CardHeader>
      <CardContent>
        {summaryQ.isLoading ? (
          <div className="py-4 text-sm text-muted-foreground">Loading cash in hand…</div>
        ) : summaryQ.isError ? (
          <div className="py-4 text-sm text-destructive">
            Could not load Cash in Hand ({(summaryQ.error as Error)?.message ?? "unknown error"}).
          </div>
        ) : (
          <CashInHandRows summary={summaryQ.data as CashInHandSummary} />
        )}
      </CardContent>
    </Card>
  );
}

/** Exported separately so pages that already fetch the summary (e.g. via their own query key) can render the same rows without a duplicate fetch. */
export function CashInHandRows({ summary }: { summary: CashInHandSummary | undefined }) {
  if (!summary) {
    return (
      <div className="py-4 text-sm text-muted-foreground">No cash in hand data available.</div>
    );
  }

  const rows = buildCashInHandDisplayRows(summary);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      {rows.map((row) => (
        <div
          key={row.key}
          className={`rounded-lg border p-3 ${row.emphasize ? "border-primary/40 bg-primary/5" : "border-border"}`}
        >
          <div className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            {row.label}
          </div>
          <div
            className={`tabular mt-1 text-lg font-semibold ${
              row.emphasize
                ? row.value >= 0
                  ? "text-primary"
                  : "text-destructive"
                : "text-foreground"
            }`}
          >
            {pkr(row.value)}
          </div>
        </div>
      ))}
    </div>
  );
}
