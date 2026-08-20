import assert from "node:assert/strict";
import test from "node:test";
import { deriveLeadMetrics, suggestedStatusForActivity } from "./sales-leads.ts";

test("lead metrics only count recorded work", () => {
  const metrics = deriveLeadMetrics(
    [
      { id: "a", status: "interested", next_follow_up_at: "2026-08-20T08:00:00.000Z" },
      { id: "b", status: "converted" },
    ],
    [
      { lead_id: "a", activity_type: "call" },
      { lead_id: "a", activity_type: "response_received" },
      { lead_id: "a", activity_type: "follow_up" },
    ],
    [{ lead_id: "a", status: "sent", follow_up_due_at: "2026-08-20T08:00:00.000Z" }],
    new Date("2026-08-20T09:00:00.000Z"),
  );
  assert.deepEqual(metrics, {
    leads: 2,
    contacted: 1,
    replied: 1,
    interested: 1,
    samplesSent: 1,
    samplesDue: 1,
    samplesFollowed: 1,
    converted: 1,
    overdue: 1,
  });
});

test("activity does not overwrite a terminal lead status", () => {
  assert.equal(suggestedStatusForActivity("call", "converted"), "converted");
});
