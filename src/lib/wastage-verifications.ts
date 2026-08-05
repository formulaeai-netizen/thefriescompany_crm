import Decimal from "decimal.js-light";

// Pure business logic for the wastage scale-image verification feature.
// This file does not read/write public.daily_production and does not
// change the existing Wastage % field, its default, or its formula
// (src/routes/_authenticated/production.tsx). It only reasons about the
// separate wastage-verification workflow layered on top of a production
// record referenced by daily_production.id.

export type WeightUnit = "kg" | "g";

export type WastageAiResult = "match" | "mismatch" | "unreadable" | "failed";

export type WastageWorkflowStatus =
  | "pending_ai"
  | "ai_processing"
  | "pending_admin"
  | "approved"
  | "rejected"
  | "resubmission_required";

/** Precision, in kg, used for all weight/variance equality comparisons. */
export const WEIGHT_PRECISION_KG = 0.01;

function toDecimal(value: number): Decimal {
  if (!Number.isFinite(value)) {
    throw new Error("Value must be a finite number");
  }
  return new Decimal(value);
}

/** Converts a weight of any supported unit to kilograms. */
export function normalizeWeightToKg(weight: number, unit: WeightUnit): number {
  if (weight < 0) {
    throw new Error("Weight cannot be negative");
  }
  const value = toDecimal(weight);
  if (unit === "g") {
    return value.dividedBy(1000).toNumber();
  }
  if (unit === "kg") {
    return value.toNumber();
  }
  throw new Error(`Unsupported unit: ${unit}`);
}

/**
 * Expected wastage weight for a production record, using the existing
 * (untouched) Wastage % value: raw input x wastage percent / 100.
 */
export function calculateExpectedWastageKg(rawInputKg: number, wastagePercent: number): number {
  if (rawInputKg <= 0) {
    throw new Error("Raw input must be a positive number");
  }
  if (wastagePercent < 0 || wastagePercent > 99) {
    throw new Error("Wastage percent must be between 0 and 99");
  }
  return toDecimal(rawInputKg).times(wastagePercent).dividedBy(100).toNumber();
}

/** Rounds a kg value to the comparison precision for display/storage. */
export function roundToWeightPrecision(valueKg: number): number {
  return new Decimal(valueKg).toDecimalPlaces(2).toNumber();
}

/**
 * Difference (AI-detected minus staff-entered), in kg, after normalizing
 * both readings to the same unit.
 */
export function calculateWeightDifferenceKg(
  staffEnteredWeight: number,
  staffEnteredUnit: WeightUnit,
  aiDetectedWeight: number,
  aiDetectedUnit: WeightUnit,
): number {
  const staffKg = normalizeWeightToKg(staffEnteredWeight, staffEnteredUnit);
  const aiKg = normalizeWeightToKg(aiDetectedWeight, aiDetectedUnit);
  return new Decimal(aiKg).minus(staffKg).toNumber();
}

/**
 * Whether two weights (each with their own unit) match within the
 * 0.01 kg comparison precision.
 */
export function weightsMatchWithinPrecision(
  weightA: number,
  unitA: WeightUnit,
  weightB: number,
  unitB: WeightUnit,
): boolean {
  const diff = calculateWeightDifferenceKg(weightA, unitA, weightB, unitB);
  return new Decimal(diff).abs().lessThanOrEqualTo(WEIGHT_PRECISION_KG);
}

/**
 * Variance (actual minus expected), in kg. Positive means more wastage than
 * expected/reference; negative means less.
 */
export function calculateWastageVarianceKg(
  expectedWastageKg: number,
  actualWeight: number,
  actualUnit: WeightUnit,
): number {
  const actualKg = normalizeWeightToKg(actualWeight, actualUnit);
  return new Decimal(actualKg).minus(expectedWastageKg).toNumber();
}

/** Whether a variance (in kg) is outside the accepted comparison precision. */
export function isVarianceOutsideTolerance(varianceKg: number): boolean {
  return new Decimal(varianceKg).abs().greaterThan(WEIGHT_PRECISION_KG);
}

export type WastageAiComparisonInput = {
  readable: boolean;
  staffEnteredWeight: number;
  staffEnteredUnit: WeightUnit;
  aiDetectedWeight: number | null;
  aiDetectedUnit: WeightUnit | null;
};

/**
 * Determines the controlled ai_result value from a raw AI reading. The AI
 * must never guess: an unreadable image or a missing detected weight always
 * resolves to "unreadable", never to a fabricated match/mismatch.
 */
export function determineWastageAiResult(
  input: WastageAiComparisonInput,
): Extract<WastageAiResult, "match" | "mismatch" | "unreadable"> {
  if (!input.readable || input.aiDetectedWeight === null || input.aiDetectedUnit === null) {
    return "unreadable";
  }
  const matches = weightsMatchWithinPrecision(
    input.staffEnteredWeight,
    input.staffEnteredUnit,
    input.aiDetectedWeight,
    input.aiDetectedUnit,
  );
  return matches ? "match" : "mismatch";
}

/** Validates a staff-entered weight submission before it reaches the server function. */
export function assertValidWastageSubmission(
  weight: number,
  unit: string,
  imageStoragePath: string,
): void {
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error("Weight must be a positive number");
  }
  if (unit !== "kg" && unit !== "g") {
    throw new Error("Unit must be kg or g");
  }
  if (!imageStoragePath || imageStoragePath.trim().length === 0) {
    throw new Error("Image path is required");
  }
}

const ACTIVE_WORKFLOW_STATUSES: readonly WastageWorkflowStatus[] = [
  "pending_ai",
  "ai_processing",
  "pending_admin",
  "approved",
];

/** Mirrors the DB partial-unique-index rule for detecting an active submission. */
export function isActiveWastageWorkflowStatus(status: WastageWorkflowStatus): boolean {
  return ACTIVE_WORKFLOW_STATUSES.includes(status);
}

export type AiReadingQuality = "clear" | "partial" | "unreadable";

export type WastageAiResultFields = {
  aiResult: WastageAiResult;
  aiDetectedWeight: number | null;
  aiDetectedUnit: WeightUnit | null;
  aiReadingQuality: AiReadingQuality | null;
  aiErrorCode: string | null;
};

/**
 * Mirrors the wastage_verifications_ai_state_check DB constraint (static
 * TypeScript mirror only - this does not run against a database) so an
 * invalid combination is rejected before it ever reaches
 * record_wastage_ai_result (Chunk 3).
 *
 * - match/mismatch: a positive detected weight, a valid unit, a clear/partial
 *   reading quality, and no error code.
 * - unreadable: reading quality must be "unreadable"; no detected weight/unit
 *   is allowed (the AI must never fabricate a reading for an unreadable image).
 * - failed: a non-empty error code is required; no detected weight, unit, or
 *   reading quality is allowed (the image was never assessed).
 */
export function assertValidAiResultFields(input: WastageAiResultFields): void {
  const { aiResult, aiDetectedWeight, aiDetectedUnit, aiReadingQuality, aiErrorCode } = input;

  if (aiResult === "match" || aiResult === "mismatch") {
    if (aiDetectedWeight === null || aiDetectedWeight <= 0) {
      throw new Error(`A ${aiResult} result requires a positive detected weight`);
    }
    if (aiDetectedUnit === null || (aiDetectedUnit !== "kg" && aiDetectedUnit !== "g")) {
      throw new Error(`A ${aiResult} result requires a valid detected unit (kg or g)`);
    }
    if (aiReadingQuality !== "clear" && aiReadingQuality !== "partial") {
      throw new Error(`A ${aiResult} result requires a clear or partial reading quality`);
    }
    if (aiErrorCode !== null) {
      throw new Error(`A ${aiResult} result must not carry an error code`);
    }
    return;
  }

  if (aiResult === "unreadable") {
    if (aiReadingQuality !== "unreadable") {
      throw new Error("An unreadable result requires ai_reading_quality = unreadable");
    }
    if (aiDetectedWeight !== null || aiDetectedUnit !== null) {
      throw new Error("An unreadable result must not include a fabricated detected weight/unit");
    }
    return;
  }

  if (aiResult === "failed") {
    if (aiErrorCode === null || aiErrorCode.trim().length === 0) {
      throw new Error("A failed result requires a non-empty error code");
    }
    if (aiDetectedWeight !== null || aiDetectedUnit !== null || aiReadingQuality !== null) {
      throw new Error(
        "A failed result must not include a detected weight, unit or reading quality",
      );
    }
    return;
  }

  throw new Error(`Unsupported ai_result: ${aiResult}`);
}

/** Maximum number of AI-processing attempts ever allowed for one verification. */
export const MAX_AI_PROCESSING_ATTEMPTS = 2;

/** Minutes after which a held ai_processing claim is considered stuck/abandoned and retry-eligible. */
export const AI_PROCESSING_STALE_MINUTES = 10;

export type WastageAiClaimState = {
  workflowStatus: WastageWorkflowStatus;
  aiAttemptCount: number;
  aiProcessingStartedAt: string | Date | null;
};

/**
 * Mirrors the eligibility check performed atomically by
 * claim_wastage_ai_processing() (static TypeScript mirror only - this does
 * not run against a database and does not itself claim anything; the
 * actual atomic claim only ever happens in the service-role-only SQL
 * function via SELECT ... FOR UPDATE). Useful for UI/status display and
 * for tests, not as a substitute for the real DB-level claim.
 *
 * - pending_ai is always claimable (first attempt).
 * - ai_processing is claimable again only once its claim is older than
 *   AI_PROCESSING_STALE_MINUTES (a stuck/abandoned attempt).
 * - Never claimable once ai_attempt_count has reached MAX_AI_PROCESSING_ATTEMPTS.
 * - Any other status (pending_admin, approved, rejected, resubmission_required)
 *   is never claimable.
 */
export type ScaleReadingInput = {
  readingVisible: boolean;
  detectedWeight: number | null;
  detectedUnit: WeightUnit | null;
  readingQuality: AiReadingQuality;
};

/**
 * Maps a validated OpenAI structured scale reading (Chunk 3) to the exact
 * fields record_wastage_ai_result expects, using the already-tested
 * determineWastageAiResult/precision logic. The model's role stops at
 * transcribing what is visible; match/mismatch is always decided here in
 * application code, never by the model itself.
 */
export function mapScaleReadingToAiFields(
  reading: ScaleReadingInput,
  staffEnteredWeight: number,
  staffEnteredUnit: WeightUnit,
): WastageAiResultFields {
  const readable =
    reading.readingVisible &&
    reading.readingQuality !== "unreadable" &&
    reading.detectedWeight !== null &&
    reading.detectedUnit !== null;

  const result = determineWastageAiResult({
    readable,
    staffEnteredWeight,
    staffEnteredUnit,
    aiDetectedWeight: readable ? reading.detectedWeight : null,
    aiDetectedUnit: readable ? reading.detectedUnit : null,
  });

  if (result === "unreadable") {
    return {
      aiResult: "unreadable",
      aiDetectedWeight: null,
      aiDetectedUnit: null,
      aiReadingQuality: "unreadable",
      aiErrorCode: null,
    };
  }

  return {
    aiResult: result,
    aiDetectedWeight: reading.detectedWeight,
    aiDetectedUnit: reading.detectedUnit,
    aiReadingQuality: reading.readingQuality,
    aiErrorCode: null,
  };
}

/** Maps a sanitized processing failure (network/config/invalid-output) to the record_wastage_ai_result fields. Never carries raw provider error text. */
export function mapAiFailureToFields(sanitizedErrorCode: string): WastageAiResultFields {
  if (!sanitizedErrorCode || sanitizedErrorCode.trim().length === 0) {
    throw new Error("A sanitized error code is required");
  }
  return {
    aiResult: "failed",
    aiDetectedWeight: null,
    aiDetectedUnit: null,
    aiReadingQuality: null,
    aiErrorCode: sanitizedErrorCode,
  };
}

export function isWastageAiClaimEligible(
  state: WastageAiClaimState,
  now: Date = new Date(),
): boolean {
  if (state.aiAttemptCount >= MAX_AI_PROCESSING_ATTEMPTS) {
    return false;
  }

  if (state.workflowStatus === "pending_ai") {
    return true;
  }

  if (state.workflowStatus === "ai_processing") {
    if (state.aiProcessingStartedAt === null) {
      return false;
    }
    const startedAt = new Date(state.aiProcessingStartedAt);
    const staleCutoffMs = AI_PROCESSING_STALE_MINUTES * 60 * 1000;
    return now.getTime() - startedAt.getTime() > staleCutoffMs;
  }

  return false;
}

/**
 * Business-rule settings for the wastage over/under-threshold alert (Chunk 4,
 * item A). These are editable values stored in `public.wastage_alert_settings`
 * - distinct from `WEIGHT_PRECISION_KG`/`operational_comparison_precision_kg()`,
 * which is a fixed technical comparison precision, not a business rule.
 */
export type WastageAlertSettings = {
  expectedWastagePercent: number;
  wastageTolerancePoints: number;
  lowWastageAlertEnabled: boolean;
  lowWastageTolerancePoints: number;
};

export type WastageThresholdEvaluation = {
  actualWastagePercent: number;
  overThresholdPercent: number;
  isOverThreshold: boolean;
  underThresholdPercent: number;
  isUnderThreshold: boolean;
};

/**
 * Actual wastage as a percentage of raw input, mirroring the same
 * kg-based reasoning as calculateExpectedWastageKg but inverted (actual
 * weight -> percent instead of percent -> expected weight).
 */
export function calculateActualWastagePercent(rawInputKg: number, actualWastageKg: number): number {
  if (rawInputKg <= 0) {
    throw new Error("Raw input must be a positive number");
  }
  if (actualWastageKg < 0) {
    throw new Error("Actual wastage cannot be negative");
  }
  return new Decimal(actualWastageKg).dividedBy(rawInputKg).times(100).toNumber();
}

/**
 * Mirrors the over/under-threshold decision made inside
 * approve_wastage_verification() (Chunk 4, item A). Over-threshold is
 * always evaluated; under-threshold is only ever flagged when the
 * (default-off) low_wastage_alert_enabled setting is true. The 60%
 * expected/5-point tolerance defaults live in DB settings, not here -
 * this function only implements the comparison itself.
 */
export function evaluateWastageThreshold(
  rawInputKg: number,
  actualWastageKg: number,
  settings: WastageAlertSettings,
): WastageThresholdEvaluation {
  const actualWastagePercent = calculateActualWastagePercent(rawInputKg, actualWastageKg);
  const overThresholdPercent = settings.expectedWastagePercent + settings.wastageTolerancePoints;
  const underThresholdPercent =
    settings.expectedWastagePercent - settings.lowWastageTolerancePoints;

  return {
    actualWastagePercent,
    overThresholdPercent,
    isOverThreshold: actualWastagePercent > overThresholdPercent,
    underThresholdPercent,
    isUnderThreshold:
      settings.lowWastageAlertEnabled && actualWastagePercent < underThresholdPercent,
  };
}
