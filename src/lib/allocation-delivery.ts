import type { AppRole } from "./roles.ts";

export const ALLOCATION_STRATEGIES = ["fair_share", "oldest_first", "priority_weighted"] as const;
export type AllocationStrategy = (typeof ALLOCATION_STRATEGIES)[number];
export type AllocationPlanStatus =
  "draft" | "approved" | "partially_executed" | "completed" | "cancelled";

export type AllocationDemand = {
  sales_order_item_id: string;
  sales_order_id: string;
  order_number: string;
  product_id: string;
  product_name: string;
  unit: string;
  client_name: string;
  branch_name: string;
  priority: "normal" | "high" | "urgent";
  ordered_at: string;
  requested_delivery_date: string;
  promised_delivery_date?: string | null;
  status?: string;
  remaining_quantity: number;
  delivered_quantity?: number;
  minimum_viable_quantity?: number | null;
};

export type AllocationSuggestion = AllocationDemand & {
  score: number;
  suggested_quantity: number;
  planned_delivery_date: string;
  reason: string;
};

const dayMs = 86_400_000;
const numeric = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const dateOnly = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00Z`);
const dayDiff = (left: string, right: string) =>
  Math.floor((dateOnly(left).getTime() - dateOnly(right).getTime()) / dayMs);
const rounded = (value: number) => Math.round(Math.max(value, 0) * 100) / 100;

export function canRoleManageAllocation(role: AppRole) {
  return role === "admin" || role === "moderator";
}

export function canTransitionAllocationPlan(from: AllocationPlanStatus, to: AllocationPlanStatus) {
  return (
    (from === "draft" && ["approved", "cancelled"].includes(to)) ||
    (from === "approved" && ["partially_executed", "cancelled"].includes(to)) ||
    (from === "partially_executed" && ["completed", "cancelled"].includes(to))
  );
}

export function isAllocationApprovalIdempotent(status: AllocationPlanStatus) {
  return status === "approved";
}

export function allocationCreatesFinancialMovement() {
  return false;
}

function score(demand: AllocationDemand, today: string, strategy: AllocationStrategy) {
  const deadline = demand.promised_delivery_date || demand.requested_delivery_date;
  const daysWaiting = Math.max(0, dayDiff(today, demand.ordered_at));
  const late = Math.max(0, -dayDiff(deadline, today));
  const dueSoon = Math.max(0, 2 - Math.max(dayDiff(deadline, today), 0));
  const priority = demand.priority === "urgent" ? 3 : demand.priority === "high" ? 2 : 1;
  const partial = numeric(demand.delivered_quantity) > 0 ? 0.5 : 0;
  if (strategy === "oldest_first") return 100 + daysWaiting * 4 + late * 6 + priority + partial;
  if (strategy === "priority_weighted")
    return priority * 8 + late * 5 + dueSoon * 2 + daysWaiting / 30 + partial;
  return 1 + priority * 0.8 + late * 1.5 + dueSoon * 0.6 + Math.min(daysWaiting, 30) / 30 + partial;
}

function reason(
  demand: AllocationDemand,
  today: string,
  value: number,
  strategy: AllocationStrategy,
) {
  const deadline = demand.promised_delivery_date || demand.requested_delivery_date;
  const late = Math.max(0, -dayDiff(deadline, today));
  const waiting = Math.max(0, dayDiff(today, demand.ordered_at));
  const traits = [
    strategy.replace("_", "-"),
    demand.priority === "urgent"
      ? "urgent priority"
      : demand.priority === "high"
        ? "high priority"
        : "normal priority",
    late > 0 ? `${late} day${late === 1 ? "" : "s"} late` : `due ${deadline}`,
    `${waiting} waiting days`,
    numeric(demand.delivered_quantity) > 0
      ? "previous partial delivery considered"
      : "no prior delivery",
  ];
  return `${traits.join("; ")}. Suggested ${rounded(value)} ${demand.unit}.`;
}

export function allocateFinishedStock(input: {
  available_quantity: number;
  demands: AllocationDemand[];
  today: string;
  strategy?: AllocationStrategy;
}) {
  const strategy = input.strategy ?? "fair_share";
  const available = Math.max(0, numeric(input.available_quantity));
  const candidates = input.demands
    .filter(
      (row) =>
        numeric(row.remaining_quantity) > 0 &&
        !["cancelled", "completed"].includes(String(row.status ?? "").toLowerCase()),
    )
    .map((row) => ({ ...row, score: score(row, input.today, strategy), allocated: 0 }));
  const totalDemand = candidates.reduce((sum, row) => sum + numeric(row.remaining_quantity), 0);
  let remainingStock = Math.min(available, totalDemand);
  const ranked = [...candidates].sort(
    (a, b) =>
      b.score - a.score ||
      a.requested_delivery_date.localeCompare(b.requested_delivery_date) ||
      a.sales_order_item_id.localeCompare(b.sales_order_item_id),
  );

  if (remainingStock >= totalDemand) {
    for (const row of ranked) row.allocated = numeric(row.remaining_quantity);
    remainingStock -= totalDemand;
  } else if (strategy === "oldest_first") {
    for (const row of ranked) {
      const grant = Math.min(numeric(row.remaining_quantity), remainingStock);
      row.allocated = grant;
      remainingStock -= grant;
    }
  } else {
    let active = ranked.filter((row) => numeric(row.remaining_quantity) > 0);
    while (remainingStock > 0.0001 && active.length) {
      const totalScore = active.reduce((sum, row) => sum + row.score, 0);
      let granted = 0;
      for (const row of active) {
        const capacity = numeric(row.remaining_quantity) - row.allocated;
        const grant = Math.min(capacity, remainingStock * (row.score / totalScore));
        row.allocated += grant;
        granted += grant;
      }
      remainingStock -= granted;
      active = active.filter((row) => numeric(row.remaining_quantity) - row.allocated > 0.0001);
      if (granted <= 0.0001) break;
    }
  }

  let minimumWarning = false;
  for (const row of ranked) {
    const minimum = Math.max(0, numeric(row.minimum_viable_quantity));
    if (minimum && row.allocated > 0 && row.allocated < minimum) {
      const needed = minimum - row.allocated;
      const donors = ranked.filter(
        (other) =>
          other !== row && other.allocated > Math.max(0, numeric(other.minimum_viable_quantity)),
      );
      const surplus = donors.reduce(
        (sum, donor) => sum + donor.allocated - Math.max(0, numeric(donor.minimum_viable_quantity)),
        0,
      );
      if (surplus >= needed) {
        let stillNeeded = needed;
        for (const donor of donors) {
          const take = Math.min(
            donor.allocated - Math.max(0, numeric(donor.minimum_viable_quantity)),
            stillNeeded,
          );
          if (take > 0) {
            donor.allocated -= take;
            row.allocated += take;
            stillNeeded -= take;
          }
          if (stillNeeded <= 0.0001) break;
        }
      } else {
        minimumWarning = true;
        row.allocated = 0;
      }
    }
  }

  const suggestions: AllocationSuggestion[] = ranked.map((row) => ({
    ...row,
    suggested_quantity: rounded(Math.min(row.allocated, numeric(row.remaining_quantity))),
    planned_delivery_date: row.promised_delivery_date || row.requested_delivery_date,
    reason: reason(row, input.today, row.allocated, strategy),
  }));
  const allocated = suggestions.reduce((sum, row) => sum + row.suggested_quantity, 0);
  return {
    strategy,
    available_quantity: available,
    total_demand: totalDemand,
    allocated_quantity: rounded(allocated),
    remaining_shortage: rounded(Math.max(totalDemand - allocated, 0)),
    minimum_viable_warning: minimumWarning,
    customers_waiting: suggestions.length,
    customers_receiving_something: suggestions.filter((row) => row.suggested_quantity > 0).length,
    customers_receiving_full: suggestions.filter(
      (row) => row.suggested_quantity >= row.remaining_quantity,
    ).length,
    customers_receiving_partial: suggestions.filter(
      (row) => row.suggested_quantity > 0 && row.suggested_quantity < row.remaining_quantity,
    ).length,
    customers_deferred: suggestions.filter((row) => row.suggested_quantity === 0).length,
    suggestions,
  };
}

export function buildDeliveryPlan(items: AllocationSuggestion[], today: string) {
  const buckets = {
    today: [] as AllocationSuggestion[],
    tomorrow: [] as AllocationSuggestion[],
    upcoming: [] as AllocationSuggestion[],
  };
  for (const item of items.filter((row) => row.suggested_quantity > 0)) {
    const delta = dayDiff(item.planned_delivery_date, today);
    if (delta <= 0) buckets.today.push(item);
    else if (delta === 1) buckets.tomorrow.push(item);
    else buckets.upcoming.push(item);
  }
  const grouped = new Map<string, AllocationSuggestion[]>();
  for (const item of items.filter((row) => row.suggested_quantity > 0)) {
    const key = item.planned_delivery_date;
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return {
    ...buckets,
    consolidation: [...grouped.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([date, rows]) => ({ date, deliveries: rows.length })),
  };
}
