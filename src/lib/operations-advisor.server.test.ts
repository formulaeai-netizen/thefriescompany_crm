import assert from "node:assert/strict";
import test from "node:test";
import { getOperationsAdvice } from "./operations-advisor.server.ts";

test("operations AI advice falls back deterministically when disabled", async () => {
  const previous = process.env.AI_RECOMMENDATIONS_ENABLED;
  process.env.AI_RECOMMENDATIONS_ENABLED = "false";
  try {
    const advice = await getOperationsAdvice([
      {
        key: "payments:1",
        title: "Review payment verifications",
        detail: "Pending payment claims still require an Admin decision.",
        href: "/payment-verifications",
        severity: "normal",
        source: { key: "payments", value: 1, href: "/payment-verifications" },
      },
    ]);

    assert.equal(advice.source, "deterministic");
    assert.deepEqual(advice.priorities, ["Review payment verifications"]);
  } finally {
    if (previous === undefined) delete process.env.AI_RECOMMENDATIONS_ENABLED;
    else process.env.AI_RECOMMENDATIONS_ENABLED = previous;
  }
});
