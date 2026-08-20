import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTodayOperations } from "@/lib/employee-performance.functions";

export const Route = createFileRoute("/_authenticated/today")({ component: Page });

function Page() {
  const getToday = useServerFn(getTodayOperations);
  const query = useQuery({ queryKey: ["today-operations"], queryFn: () => getToday({}) });
  if (query.isLoading) return <p>Loading today...</p>;
  if (query.isError)
    return (
      <p className="text-sm text-destructive">
        Could not load the operations brief: {query.error.message}
      </p>
    );
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="text-sm text-muted-foreground">
          A deterministic operational brief from live CRM records. No action is taken automatically
          here.
        </p>
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(query.data?.brief ?? []).map((item: any) => (
          <a
            key={item.key}
            href={item.href}
            className={`rounded border p-4 transition-colors hover:border-primary ${item.urgent ? "border-amber-500/60" : ""}`}
          >
            <p className="text-sm text-muted-foreground">{item.label}</p>
            <p className="mt-2 text-3xl font-semibold">{item.value}</p>
            <p
              className={`mt-2 text-xs ${item.urgent ? "text-amber-600" : "text-muted-foreground"}`}
            >
              {item.urgent ? "Needs review" : "No immediate exception"}
            </p>
          </a>
        ))}
      </section>
      <section className="rounded border p-4">
        <h2 className="font-semibold">Recommended Priorities</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Advisory only. Source facts remain the system of record.
        </p>
        {query.data?.advice ? (
          <div className="mt-3 rounded border bg-muted/30 p-3">
            <p className="text-sm font-medium">{query.data.advice.summary}</p>
            <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
              Source: {query.data.advice.source === "ai" ? "AI advisory" : "deterministic rules"}
            </p>
          </div>
        ) : null}
        <div className="mt-3 space-y-2">
          {(query.data?.recommendations ?? []).map((item: any, index: number) => (
            <a
              key={item.key}
              href={item.href}
              className="block rounded border p-3 hover:border-primary"
            >
              <b>
                {index + 1}. {item.title}
              </b>
              <p className="mt-1 text-sm text-muted-foreground">
                {item.detail} Source: {item.source.label ?? item.source.key} = {item.source.value}.
              </p>
            </a>
          ))}
          {(query.data?.recommendations ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No deterministic priority currently needs escalation.
            </p>
          ) : null}
        </div>
      </section>
      <section className="rounded border p-4">
        <h2 className="font-semibold">Start here</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <a className="rounded border px-3 py-2 text-sm" href="/orders">
            Review orders and receiving
          </a>
          <a className="rounded border px-3 py-2 text-sm" href="/production-planning">
            Review production plan
          </a>
          <a className="rounded border px-3 py-2 text-sm" href="/sales-leads">
            Complete sales follow-ups
          </a>
          <a className="rounded border px-3 py-2 text-sm" href="/employee-performance">
            Review performance
          </a>
        </div>
      </section>
    </div>
  );
}
