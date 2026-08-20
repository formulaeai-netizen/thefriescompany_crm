import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getEmployeePerformance } from "@/lib/employee-performance.functions";

export const Route = createFileRoute("/_authenticated/employee-performance")({ component: Page });
const tone: Record<string, string> = {
  green: "text-emerald-600",
  amber: "text-amber-600",
  red: "text-destructive",
  unclassified: "text-muted-foreground",
};

function Page() {
  const performance = useServerFn(getEmployeePerformance);
  const [period, setPeriod] = useState<"week" | "month">("week");
  const query = useQuery({
    queryKey: ["employee-performance", period],
    queryFn: () => performance({ data: { period } }),
  });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Employee Performance</h1>
          <p className="text-sm text-muted-foreground">
            Role-profile KPI view. Targets are shown only where configured.
          </p>
        </div>
        <select
          className="rounded border bg-background px-3 py-2 text-sm"
          value={period}
          onChange={(event) => setPeriod(event.target.value as "week" | "month")}
        >
          <option value="week">This week</option>
          <option value="month">This month</option>
        </select>
      </div>
      {query.isLoading ? <p>Loading performance...</p> : null}
      {query.isError ? <p className="text-sm text-destructive">{query.error.message}</p> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {(query.data ?? []).map((employee: any) => (
          <section className="rounded border p-4" key={employee.user?.id ?? employee.profile.id}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  {employee.user?.full_name || employee.user?.email || "Unassigned user"}
                </h2>
                <p className="text-sm capitalize text-muted-foreground">
                  {employee.profile.name} · {employee.profile.category}
                </p>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {employee.metrics.map((metric: any) => (
                <div className="rounded border p-3" key={metric.key}>
                  <p className="text-xs text-muted-foreground">
                    {metric.key
                      .replaceAll(/([A-Z])/g, " $1")
                      .replace(/^./, (value: string) => value.toUpperCase())}
                  </p>
                  <p className="mt-1 font-medium">
                    {metric.actual ?? "-"}
                    {metric.target !== null ? ` / ${metric.target}` : ""}
                  </p>
                  <p className={`mt-1 text-xs capitalize ${tone[metric.health]}`}>
                    {metric.health.replaceAll("_", " ")}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {!query.isLoading && (query.data ?? []).length === 0 ? (
        <section className="rounded border p-4 text-sm text-muted-foreground">
          No active employee KPI assignments yet. Create a reusable profile and assign it to an
          employee before targets or performance can be shown.
        </section>
      ) : null}
    </div>
  );
}
