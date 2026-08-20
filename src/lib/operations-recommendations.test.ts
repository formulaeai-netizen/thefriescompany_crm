import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeterministicOperationsAdvice,
  buildOperationsRecommendations,
} from "./operations-recommendations.ts";

test("recommendations are derived from deterministic facts and have no mutation action", () => {
  const recommendations = buildOperationsRecommendations([
    { key: "production", value: 25, href: "/production-planning" },
    { key: "payments", value: 0, href: "/payment-verifications" },
  ]);

  assert.deepEqual(recommendations, [
    {
      key: "production:25",
      title: "Close production shortfall",
      detail: "Production remains required against today's approved plan.",
      href: "/production-planning",
      severity: "high",
      source: { key: "production", value: 25, href: "/production-planning" },
    },
  ]);
});

test("deterministic advice is advisory and based only on recommendations", () => {
  const advice = buildDeterministicOperationsAdvice([
    {
      key: "orders:2",
      title: "Review due and overdue orders",
      detail: "Orders are due or overdue and need an operational owner.",
      href: "/orders",
      severity: "high",
      source: { key: "orders", value: 2, href: "/orders" },
    },
  ]);

  assert.equal(advice.source, "deterministic");
  assert.match(advice.summary, /high-priority/);
  assert.deepEqual(advice.priorities, ["Review due and overdue orders"]);
});
