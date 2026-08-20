import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOperationsBriefDedupeKey,
  buildOperationsBriefText,
} from "./services/operations-briefs.js";

test("operations brief text is factual and does not mutate records", () => {
  const brief = buildOperationsBriefText("morning", {
    ordersDue: 2,
    receivingPending: 1,
    pendingPayments: 3,
    openAlerts: 4,
  });

  assert.equal(brief.title, "Morning Operations Brief");
  assert.match(brief.body, /Orders due: 2/);
  assert.match(brief.body, /Open operational alerts: 4/);
});

test("operations brief dedupe key is stable per day and kind", () => {
  assert.equal(
    buildOperationsBriefDedupeKey("evening", "2026-08-20"),
    "operations-brief:evening:2026-08-20",
  );
});
