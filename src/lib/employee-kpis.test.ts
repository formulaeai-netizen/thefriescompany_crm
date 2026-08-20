import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyBrief, health, operationsKpis, salesKpis } from "./employee-kpis.ts";
test("operations KPI truthfully calculates achievement, late delivery and receiving", () => {
  const r = operationsKpis({
    planned: 100,
    actual: 90,
    deliveries: 10,
    onTime: 8,
    receivingDue: 4,
    receivingDone: 3,
    missingIncidents: 1,
  });
  assert.equal(r.productionAchievement, 90);
  assert.equal(r.onTimeDelivery, 80);
  assert.equal(r.receivingCompletion, 75);
  assert.equal(r.cause, "Unclassified / Needs Review");
});
test("sales KPI only counts activity-backed contact and conversion", () => {
  const r = salesKpis({
    leads: 10,
    contacted: 5,
    replied: 2,
    interested: 2,
    samplesSent: 2,
    samplesDue: 2,
    samplesFollowed: 1,
    converted: 1,
    overdue: 3,
  });
  assert.equal(r.responseRate, 40);
  assert.equal(r.conversionRate, 10);
});
test("KPI presentation does not fabricate target health", () => {
  assert.equal(health(90, 100), "amber");
  assert.equal(health(90, null), "unclassified");
  const brief = buildDailyBrief({
    ordersDue: 2,
    overdueOrders: 1,
    productionRequired: 0,
    receivingMissing: 0,
    leadFollowUps: 0,
    pendingPaymentVerifications: 0,
  });
  assert.equal(brief.find((item) => item.key === "orders")?.urgent, true);
  assert.equal(brief.find((item) => item.key === "production")?.urgent, false);
});
