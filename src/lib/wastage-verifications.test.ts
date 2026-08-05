import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_PROCESSING_STALE_MINUTES,
  MAX_AI_PROCESSING_ATTEMPTS,
  WEIGHT_PRECISION_KG,
  assertValidAiResultFields,
  assertValidWastageSubmission,
  calculateActualWastagePercent,
  calculateExpectedWastageKg,
  calculateWastageVarianceKg,
  calculateWeightDifferenceKg,
  determineWastageAiResult,
  evaluateWastageThreshold,
  isActiveWastageWorkflowStatus,
  isVarianceOutsideTolerance,
  isWastageAiClaimEligible,
  mapAiFailureToFields,
  mapScaleReadingToAiFields,
  normalizeWeightToKg,
  roundToWeightPrecision,
  weightsMatchWithinPrecision,
} from "./wastage-verifications.ts";

test("expected wastage weight uses the existing (untouched) wastage percent as reference data", () => {
  assert.equal(calculateExpectedWastageKg(100, 60), 60);
  assert.equal(calculateExpectedWastageKg(250, 60), 150);
  assert.equal(calculateExpectedWastageKg(80, 25), 20);
});

test("expected wastage rejects invalid production inputs", () => {
  assert.throws(() => calculateExpectedWastageKg(0, 60));
  assert.throws(() => calculateExpectedWastageKg(-5, 60));
  assert.throws(() => calculateExpectedWastageKg(100, -1));
  assert.throws(() => calculateExpectedWastageKg(100, 100));
});

test("kg and g normalize to the same kg value", () => {
  assert.equal(normalizeWeightToKg(60, "kg"), 60);
  assert.equal(normalizeWeightToKg(60000, "g"), 60);
  assert.equal(normalizeWeightToKg(1500, "g"), 1.5);
});

test("normalizeWeightToKg rejects negative weight and unknown unit", () => {
  assert.throws(() => normalizeWeightToKg(-1, "kg"));
  assert.throws(() => normalizeWeightToKg(1, "lb" as never));
});

test("matching readings within 0.01 kg precision are treated as a match", () => {
  assert.equal(weightsMatchWithinPrecision(60, "kg", 60, "kg"), true);
  assert.equal(weightsMatchWithinPrecision(60, "kg", 60000, "g"), true);
  assert.equal(weightsMatchWithinPrecision(60, "kg", 60.01, "kg"), true);
});

test("mismatching readings beyond 0.01 kg precision are not a match", () => {
  assert.equal(weightsMatchWithinPrecision(60, "kg", 60.02, "kg"), false);
  assert.equal(weightsMatchWithinPrecision(60, "kg", 58, "kg"), false);
  assert.equal(weightsMatchWithinPrecision(60, "kg", 61500, "g"), false);
});

test("weight difference is AI-detected minus staff-entered, in kg", () => {
  assert.equal(calculateWeightDifferenceKg(60, "kg", 62, "kg"), 2);
  assert.equal(calculateWeightDifferenceKg(60, "kg", 58, "kg"), -2);
  assert.equal(calculateWeightDifferenceKg(60, "kg", 60500, "g"), 0.5);
});

test("determineWastageAiResult never guesses on an unreadable image", () => {
  assert.equal(
    determineWastageAiResult({
      readable: false,
      staffEnteredWeight: 60,
      staffEnteredUnit: "kg",
      aiDetectedWeight: 60,
      aiDetectedUnit: "kg",
    }),
    "unreadable",
  );
  assert.equal(
    determineWastageAiResult({
      readable: true,
      staffEnteredWeight: 60,
      staffEnteredUnit: "kg",
      aiDetectedWeight: null,
      aiDetectedUnit: null,
    }),
    "unreadable",
  );
});

test("determineWastageAiResult resolves match/mismatch when readable", () => {
  assert.equal(
    determineWastageAiResult({
      readable: true,
      staffEnteredWeight: 60,
      staffEnteredUnit: "kg",
      aiDetectedWeight: 60,
      aiDetectedUnit: "kg",
    }),
    "match",
  );
  assert.equal(
    determineWastageAiResult({
      readable: true,
      staffEnteredWeight: 60,
      staffEnteredUnit: "kg",
      aiDetectedWeight: 55,
      aiDetectedUnit: "kg",
    }),
    "mismatch",
  );
});

test("expected versus actual wastage variance", () => {
  assert.equal(calculateWastageVarianceKg(60, 65, "kg"), 5);
  assert.equal(calculateWastageVarianceKg(60, 55, "kg"), -5);
  assert.equal(calculateWastageVarianceKg(60, 60, "kg"), 0);
  assert.equal(calculateWastageVarianceKg(60, 60000, "g"), 0);
});

test("variance tolerance uses the 0.01 kg precision", () => {
  assert.equal(WEIGHT_PRECISION_KG, 0.01);
  assert.equal(isVarianceOutsideTolerance(0), false);
  assert.equal(isVarianceOutsideTolerance(0.01), false);
  assert.equal(isVarianceOutsideTolerance(0.011), true);
  assert.equal(isVarianceOutsideTolerance(-5), true);
});

test("rounding formats a weight to the comparison precision", () => {
  assert.equal(roundToWeightPrecision(60.004), 60);
  assert.equal(roundToWeightPrecision(60.006), 60.01);
});

test("submission validation rejects invalid or negative input", () => {
  assert.throws(() => assertValidWastageSubmission(0, "kg", "user/img.jpg"));
  assert.throws(() => assertValidWastageSubmission(-1, "kg", "user/img.jpg"));
  assert.throws(() => assertValidWastageSubmission(60, "lb", "user/img.jpg"));
  assert.throws(() => assertValidWastageSubmission(60, "kg", ""));
  assert.doesNotThrow(() =>
    assertValidWastageSubmission(60, "kg", "user-id/verification-id/photo.jpg"),
  );
});

test("active workflow statuses block a second simultaneous submission", () => {
  assert.equal(isActiveWastageWorkflowStatus("pending_ai"), true);
  assert.equal(isActiveWastageWorkflowStatus("pending_admin"), true);
  assert.equal(isActiveWastageWorkflowStatus("approved"), true);
  assert.equal(isActiveWastageWorkflowStatus("rejected"), false);
  assert.equal(isActiveWastageWorkflowStatus("resubmission_required"), false);
});

test("AI match/mismatch requires a positive detected reading", () => {
  assert.doesNotThrow(() =>
    assertValidAiResultFields({
      aiResult: "match",
      aiDetectedWeight: 60,
      aiDetectedUnit: "kg",
      aiReadingQuality: "clear",
      aiErrorCode: null,
    }),
  );
  assert.throws(() =>
    assertValidAiResultFields({
      aiResult: "match",
      aiDetectedWeight: null,
      aiDetectedUnit: null,
      aiReadingQuality: "clear",
      aiErrorCode: null,
    }),
  );
  assert.throws(() =>
    assertValidAiResultFields({
      aiResult: "mismatch",
      aiDetectedWeight: -1,
      aiDetectedUnit: "kg",
      aiReadingQuality: "clear",
      aiErrorCode: null,
    }),
  );
  assert.throws(() =>
    assertValidAiResultFields({
      aiResult: "match",
      aiDetectedWeight: 60,
      aiDetectedUnit: "kg",
      aiReadingQuality: "unreadable",
      aiErrorCode: null,
    }),
  );
  assert.throws(() =>
    assertValidAiResultFields({
      aiResult: "match",
      aiDetectedWeight: 60,
      aiDetectedUnit: "kg",
      aiReadingQuality: "clear",
      aiErrorCode: "some_code",
    }),
  );
});

test("an unreadable AI result never carries a fabricated weight", () => {
  assert.doesNotThrow(() =>
    assertValidAiResultFields({
      aiResult: "unreadable",
      aiDetectedWeight: null,
      aiDetectedUnit: null,
      aiReadingQuality: "unreadable",
      aiErrorCode: null,
    }),
  );
  assert.throws(() =>
    assertValidAiResultFields({
      aiResult: "unreadable",
      aiDetectedWeight: 60,
      aiDetectedUnit: "kg",
      aiReadingQuality: "unreadable",
      aiErrorCode: null,
    }),
  );
  assert.throws(() =>
    assertValidAiResultFields({
      aiResult: "unreadable",
      aiDetectedWeight: null,
      aiDetectedUnit: null,
      aiReadingQuality: "clear",
      aiErrorCode: null,
    }),
  );
});

test("a failed AI result requires an error code and no fabricated reading", () => {
  assert.doesNotThrow(() =>
    assertValidAiResultFields({
      aiResult: "failed",
      aiDetectedWeight: null,
      aiDetectedUnit: null,
      aiReadingQuality: null,
      aiErrorCode: "timeout",
    }),
  );
  assert.throws(() =>
    assertValidAiResultFields({
      aiResult: "failed",
      aiDetectedWeight: null,
      aiDetectedUnit: null,
      aiReadingQuality: null,
      aiErrorCode: "",
    }),
  );
  assert.throws(() =>
    assertValidAiResultFields({
      aiResult: "failed",
      aiDetectedWeight: 60,
      aiDetectedUnit: "kg",
      aiReadingQuality: null,
      aiErrorCode: "timeout",
    }),
  );
});

test("a pending_ai record is always claim-eligible (first attempt)", () => {
  assert.equal(
    isWastageAiClaimEligible({
      workflowStatus: "pending_ai",
      aiAttemptCount: 0,
      aiProcessingStartedAt: null,
    }),
    true,
  );
});

test("duplicate AI-processing requests are prevented while a claim is fresh", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  const startedFiveMinutesAgo = new Date("2026-07-31T11:55:00.000Z");
  assert.equal(
    isWastageAiClaimEligible(
      {
        workflowStatus: "ai_processing",
        aiAttemptCount: 1,
        aiProcessingStartedAt: startedFiveMinutesAgo,
      },
      now,
    ),
    false,
  );
});

test("retry timeout rule: a claim older than 10 minutes becomes retry-eligible", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  assert.equal(AI_PROCESSING_STALE_MINUTES, 10);
  const startedElevenMinutesAgo = new Date("2026-07-31T11:49:00.000Z");
  assert.equal(
    isWastageAiClaimEligible(
      {
        workflowStatus: "ai_processing",
        aiAttemptCount: 1,
        aiProcessingStartedAt: startedElevenMinutesAgo,
      },
      now,
    ),
    true,
  );
  const startedNineMinutesAgo = new Date("2026-07-31T11:51:00.000Z");
  assert.equal(
    isWastageAiClaimEligible(
      {
        workflowStatus: "ai_processing",
        aiAttemptCount: 1,
        aiProcessingStartedAt: startedNineMinutesAgo,
      },
      now,
    ),
    false,
  );
});

test("maximum attempt rule: a record at the attempt cap is never claim-eligible", () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  assert.equal(MAX_AI_PROCESSING_ATTEMPTS, 2);
  const startedLongAgo = new Date("2026-07-31T00:00:00.000Z");
  assert.equal(
    isWastageAiClaimEligible(
      { workflowStatus: "ai_processing", aiAttemptCount: 2, aiProcessingStartedAt: startedLongAgo },
      now,
    ),
    false,
  );
  assert.equal(
    isWastageAiClaimEligible(
      { workflowStatus: "pending_ai", aiAttemptCount: 2, aiProcessingStartedAt: null },
      now,
    ),
    false,
  );
});

test("terminal/pending-admin statuses are never claim-eligible", () => {
  for (const workflowStatus of [
    "pending_admin",
    "approved",
    "rejected",
    "resubmission_required",
  ] as const) {
    assert.equal(
      isWastageAiClaimEligible({ workflowStatus, aiAttemptCount: 0, aiProcessingStartedAt: null }),
      false,
    );
  }
});

test("ai_processing is an active status that blocks a second simultaneous submission", () => {
  assert.equal(isActiveWastageWorkflowStatus("ai_processing"), true);
});

test("a clear, matching scale reading maps to a match result", () => {
  const fields = mapScaleReadingToAiFields(
    { readingVisible: true, detectedWeight: 60, detectedUnit: "kg", readingQuality: "clear" },
    60,
    "kg",
  );
  assert.deepEqual(fields, {
    aiResult: "match",
    aiDetectedWeight: 60,
    aiDetectedUnit: "kg",
    aiReadingQuality: "clear",
    aiErrorCode: null,
  });
});

test("a partial reading that disagrees with the staff weight maps to mismatch", () => {
  const fields = mapScaleReadingToAiFields(
    { readingVisible: true, detectedWeight: 55, detectedUnit: "kg", readingQuality: "partial" },
    60,
    "kg",
  );
  assert.equal(fields.aiResult, "mismatch");
  assert.equal(fields.aiDetectedWeight, 55);
});

test("an unreadable scale reading never fabricates a weight", () => {
  const fields = mapScaleReadingToAiFields(
    {
      readingVisible: false,
      detectedWeight: null,
      detectedUnit: null,
      readingQuality: "unreadable",
    },
    60,
    "kg",
  );
  assert.deepEqual(fields, {
    aiResult: "unreadable",
    aiDetectedWeight: null,
    aiDetectedUnit: null,
    aiReadingQuality: "unreadable",
    aiErrorCode: null,
  });
});

test("a missing unit is treated as unreadable rather than guessed", () => {
  const fields = mapScaleReadingToAiFields(
    { readingVisible: true, detectedWeight: 60, detectedUnit: null, readingQuality: "partial" },
    60,
    "kg",
  );
  assert.equal(fields.aiResult, "unreadable");
  assert.equal(fields.aiDetectedUnit, null);
});

test("a sanitized AI failure never carries raw provider error text", () => {
  const fields = mapAiFailureToFields("openai_request_failed");
  assert.deepEqual(fields, {
    aiResult: "failed",
    aiDetectedWeight: null,
    aiDetectedUnit: null,
    aiReadingQuality: null,
    aiErrorCode: "openai_request_failed",
  });
  assert.throws(() => mapAiFailureToFields(""));
});

const DEFAULT_ALERT_SETTINGS = {
  expectedWastagePercent: 60,
  wastageTolerancePoints: 5,
  lowWastageAlertEnabled: false,
  lowWastageTolerancePoints: 10,
};

test("actual wastage percent uses raw input as the denominator", () => {
  assert.equal(calculateActualWastagePercent(100, 60), 60);
  assert.equal(calculateActualWastagePercent(100, 65), 65);
  assert.throws(() => calculateActualWastagePercent(0, 10));
  assert.throws(() => calculateActualWastagePercent(100, -1));
});

test("wastage at or below the default 65% threshold (60 + 5) is not over-threshold", () => {
  const atThreshold = evaluateWastageThreshold(100, 65, DEFAULT_ALERT_SETTINGS);
  assert.equal(atThreshold.overThresholdPercent, 65);
  assert.equal(atThreshold.isOverThreshold, false);

  const belowThreshold = evaluateWastageThreshold(100, 62, DEFAULT_ALERT_SETTINGS);
  assert.equal(belowThreshold.isOverThreshold, false);
});

test("wastage above the default 65% threshold is flagged over-threshold", () => {
  const result = evaluateWastageThreshold(100, 66, DEFAULT_ALERT_SETTINGS);
  assert.equal(result.actualWastagePercent, 66);
  assert.equal(result.isOverThreshold, true);
});

test("low-wastage flag stays off by default even for suspiciously low wastage", () => {
  const result = evaluateWastageThreshold(100, 10, DEFAULT_ALERT_SETTINGS);
  assert.equal(result.isUnderThreshold, false);
});

test("low-wastage flag fires only when explicitly enabled and below the low threshold", () => {
  const enabled = {
    ...DEFAULT_ALERT_SETTINGS,
    lowWastageAlertEnabled: true,
    lowWastageTolerancePoints: 10,
  };
  const belowLow = evaluateWastageThreshold(100, 45, enabled);
  assert.equal(belowLow.underThresholdPercent, 50);
  assert.equal(belowLow.isUnderThreshold, true);

  const atLow = evaluateWastageThreshold(100, 50, enabled);
  assert.equal(atLow.isUnderThreshold, false);
});
