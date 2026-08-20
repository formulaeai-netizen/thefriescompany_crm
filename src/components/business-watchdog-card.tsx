import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BrainCircuit, ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAiWatchdogDashboardSummary } from "@/lib/ai-watchdog.functions";

export function BusinessWatchdogCard() {
  const summaryFn = useServerFn(getAiWatchdogDashboardSummary);
  const summaryQ = useQuery({
    queryKey: ["ai-watchdog-dashboard-summary"],
    queryFn: () => summaryFn({}),
    retry: 1,
  });

  const latest = summaryQ.data?.latest ?? [];
  const migrationRequired = summaryQ.data?.migration_required;

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <BrainCircuit className="h-4 w-4 text-primary" />
          Business Watchdog
        </CardTitle>
        <Link
          to="/ai-watchdog"
          search={{ alert_id: undefined }}
          className="inline-flex items-center text-xs text-primary hover:underline"
        >
          View
          <ChevronRight className="ml-1 h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        {summaryQ.isError ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            Could not load watchdog summary.
          </div>
        ) : migrationRequired ? (
          <div className="rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">
            Watchdog migration is pending.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Critical
                </div>
                <div className="tabular mt-1 text-2xl font-semibold text-destructive">
                  {summaryQ.data?.critical ?? 0}
                </div>
              </div>
              <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  High
                </div>
                <div className="tabular mt-1 text-2xl font-semibold text-warning">
                  {summaryQ.data?.high ?? 0}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {latest.length === 0 ? (
                <p className="text-sm text-muted-foreground">No important anomalies open.</p>
              ) : (
                latest.map((row: any) => (
                  <Link
                    key={row.id}
                    to="/ai-watchdog"
                    search={{ alert_id: row.id } as any}
                    className="block rounded-md border border-border/70 bg-muted/20 p-3 transition-colors hover:bg-muted/40"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{row.anomaly_type}</span>
                      <Badge variant="outline">{row.severity}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {row.deterministic_reason}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
