import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapAiFailureToFields, mapScaleReadingToAiFields } from "@/lib/wastage-verifications";

type ServerContext = { supabase: SupabaseClient; userId: string };

async function hasRole(ctx: ServerContext, role: string): Promise<boolean> {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: role });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  return Boolean(data);
}

async function assertAdmin(ctx: ServerContext) {
  if (!(await hasRole(ctx, "admin"))) throw new Error("Forbidden");
}

async function assertStaffOrAdmin(ctx: ServerContext) {
  if (!((await hasRole(ctx, "staff")) || (await hasRole(ctx, "admin"))))
    throw new Error("Forbidden");
}

const submitSchema = z.object({
  daily_production_id: z.string().uuid(),
  staff_entered_weight: z.number().positive(),
  staff_entered_unit: z.enum(["kg", "g"]),
  image_storage_path: z.string().min(1),
});

export const submitWastageVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => submitSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertStaffOrAdmin(context);
    const { data: verificationId, error } = await context.supabase.rpc(
      "submit_wastage_verification",
      {
        _daily_production_id: data.daily_production_id,
        _staff_entered_weight: data.staff_entered_weight,
        _staff_entered_unit: data.staff_entered_unit,
        _image_storage_path: data.image_storage_path,
      },
    );
    if (error) throw new Error(`Wastage verification submission failed: ${error.message}`);
    return { verification_id: verificationId as string };
  });

const verificationIdSchema = z.object({ verification_id: z.string().uuid() });

async function runWastageAiProcessing(data: { verification_id: string }, context: ServerContext) {
  const { data: row, error: rowError } = await context.supabase
    .from("wastage_verifications")
    .select(
      "id, uploaded_by, staff_entered_weight, staff_entered_unit, image_storage_path, workflow_status",
    )
    .eq("id", data.verification_id)
    .maybeSingle();
  if (rowError) throw new Error(`Verification lookup failed: ${rowError.message}`);
  if (!row) throw new Error("Verification not found");

  const isOwner = row.uploaded_by === context.userId;
  if (!isOwner && !(await hasRole(context, "admin"))) {
    throw new Error("Forbidden");
  }

  // Missing configuration is a safe, retryable state - it must not
  // consume one of the two allowed AI attempts and must not be recorded
  // as a failed result.
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_VISION_MODEL) {
    return { ok: false, reason: "configuration_missing" as const };
  }

  // .server.ts modules are stripped from the client bundle; dynamic
  // import keeps that boundary explicit even though this handler itself
  // only ever runs on the server.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
    "claim_wastage_ai_processing",
    {
      _verification_id: data.verification_id,
    },
  );
  if (claimError) throw new Error(`AI claim failed: ${claimError.message}`);
  if (!claimed) {
    // Already claimed by a concurrent request, already processed, or the
    // attempt cap was reached - not an error, just nothing to do here.
    return { ok: false, reason: "not_claimable" as const };
  }

  const { analyzeWastageScaleImage, WastageAiConfigurationError, WastageAiRequestError } =
    await import("@/lib/openai-wastage-vision.server");

  try {
    const { data: fileBlob, error: downloadError } = await supabaseAdmin.storage
      .from("wastage-scale-images")
      .download(row.image_storage_path);
    if (downloadError || !fileBlob) {
      throw new WastageAiRequestError(
        "image_download_failed",
        "Could not download the scale image",
      );
    }

    const arrayBuffer = await fileBlob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.byteLength === 0) {
      throw new WastageAiRequestError("empty_image", "The scale image file is empty");
    }
    if (bytes.byteLength > 8 * 1024 * 1024) {
      throw new WastageAiRequestError("image_too_large", "The scale image exceeds the 8 MB limit");
    }

    const mimeType = fileBlob.type || "application/octet-stream";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      throw new WastageAiRequestError(
        "unsupported_mime_type",
        "The scale image is not a supported format",
      );
    }

    const base64 = Buffer.from(bytes).toString("base64");
    const base64DataUrl = `data:${mimeType};base64,${base64}`;

    const reading = await analyzeWastageScaleImage({ base64DataUrl });

    const fields = mapScaleReadingToAiFields(
      {
        readingVisible: reading.reading_visible,
        detectedWeight: reading.detected_weight,
        detectedUnit: reading.detected_unit,
        readingQuality: reading.reading_quality,
      },
      Number(row.staff_entered_weight),
      row.staff_entered_unit,
    );

    const { error: recordError } = await supabaseAdmin.rpc("record_wastage_ai_result", {
      _verification_id: data.verification_id,
      _ai_result: fields.aiResult,
      _ai_detected_weight: fields.aiDetectedWeight,
      _ai_detected_unit: fields.aiDetectedUnit,
      _ai_reading_quality: fields.aiReadingQuality,
      _ai_error_code: fields.aiErrorCode,
    });
    if (recordError) throw new Error(`Recording AI result failed: ${recordError.message}`);

    return { ok: true, ai_result: fields.aiResult };
  } catch (err) {
    // Any failure after a successful claim is recorded as a sanitized
    // "failed" result and still moves to pending_admin - raw provider
    // error text is never persisted or logged.
    const code =
      err instanceof WastageAiConfigurationError
        ? "configuration_missing"
        : err instanceof WastageAiRequestError
          ? err.code
          : "unexpected_error";

    const fields = mapAiFailureToFields(code);
    const { error: recordError } = await supabaseAdmin.rpc("record_wastage_ai_result", {
      _verification_id: data.verification_id,
      _ai_result: fields.aiResult,
      _ai_detected_weight: fields.aiDetectedWeight,
      _ai_detected_unit: fields.aiDetectedUnit,
      _ai_reading_quality: fields.aiReadingQuality,
      _ai_error_code: fields.aiErrorCode,
    });
    if (recordError) throw new Error(`Recording AI failure failed: ${recordError.message}`);

    return { ok: false, reason: "processing_failed" as const, error_code: code };
  }
}

/**
 * Orchestrates one AI-processing attempt for a verification: confirms the
 * caller is the uploader or an Admin, claims processing atomically via the
 * service-role-only RPC (so a duplicate concurrent call never charges the
 * API twice), downloads the image server-side, calls OpenAI, and records
 * the result through the service-role-only RPC. AI never approves - every
 * outcome still moves the row to pending_admin for mandatory Admin review.
 */
export const processWastageVerificationAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => verificationIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    return runWastageAiProcessing(data, context);
  });

export const retryWastageVerificationAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => verificationIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { data: row, error: rowError } = await context.supabase
      .from("wastage_verifications")
      .select("ai_error_code")
      .eq("id", data.verification_id)
      .maybeSingle();
    if (rowError) throw new Error(`Verification lookup failed: ${rowError.message}`);
    if (!row) throw new Error("Verification not found");
    if (["openai_rate_limited", "openai_quota_exceeded"].includes(row.ai_error_code ?? "")) {
      return { ok: false, reason: "manual_review_required" as const };
    }

    const { data: reset, error: retryError } = await context.supabase.rpc(
      "retry_wastage_ai_verification",
      {
        _verification_id: data.verification_id,
      },
    );
    if (retryError) throw new Error(`AI retry reset failed: ${retryError.message}`);
    if (!reset) return { ok: false, reason: "not_retryable" as const };

    return runWastageAiProcessing(data, context);
  });

export const getWastageVerificationImageUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => verificationIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { data: row, error: rowError } = await context.supabase
      .from("wastage_verifications")
      .select("image_storage_path")
      .eq("id", data.verification_id)
      .maybeSingle();
    if (rowError) throw new Error(`Verification lookup failed: ${rowError.message}`);
    if (!row) throw new Error("Verification not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from("wastage-scale-images")
      .createSignedUrl(row.image_storage_path, 60);
    if (signError || !signed) throw new Error("Could not create a signed image URL");

    return { url: signed.signedUrl, expires_in_seconds: 60 };
  });

export const listWastageVerificationsForReview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isAdmin = await hasRole(context, "admin");
    const isModerator = !isAdmin && (await hasRole(context, "moderator"));
    if (!isAdmin && !isModerator) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("wastage_verifications")
      .select(
        "id, daily_production_id, staff_entered_weight, staff_entered_unit, uploaded_by, uploaded_at, raw_input_kg_snapshot, wastage_percent_snapshot, expected_wastage_kg_snapshot, ai_result, ai_detected_weight, ai_detected_unit, ai_reading_quality, ai_error_code, ai_attempt_count, workflow_status, admin_decision_by, admin_decision_at, admin_decision_reason, created_at, updated_at, daily_production(date)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(`Wastage verification list failed: ${error.message}`);
    return { rows: data ?? [], is_admin: isAdmin };
  });

export const listWastageVerificationEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => verificationIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("wastage_verification_events")
      .select("id, event_type, previous_status, new_status, reason, created_at, actor_id")
      .eq("verification_id", data.verification_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(`Verification history load failed: ${error.message}`);
    return { rows: rows ?? [] };
  });

const decideSchema = z
  .object({
    verification_id: z.string().uuid(),
    action: z.enum(["approve", "reject", "resubmission"]),
    reason: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.action === "approve" || (v.reason && v.reason.length > 0), {
    message: "A reason is required to reject or request resubmission",
    path: ["reason"],
  });

export const decideWastageVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => decideSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    if (data.action === "approve") {
      const { error } = await context.supabase.rpc("approve_wastage_verification", {
        _verification_id: data.verification_id,
      });
      if (error) throw new Error(`Approval failed: ${error.message}`);
    } else if (data.action === "reject") {
      if (!data.reason) throw new Error("A reason is required to reject");
      const { error } = await context.supabase.rpc("reject_wastage_verification", {
        _verification_id: data.verification_id,
        _reason: data.reason,
      });
      if (error) throw new Error(`Rejection failed: ${error.message}`);
    } else {
      if (!data.reason) throw new Error("A reason is required to request resubmission");
      const { error } = await context.supabase.rpc("request_resubmission_wastage_verification", {
        _verification_id: data.verification_id,
        _reason: data.reason,
      });
      if (error) throw new Error(`Resubmission request failed: ${error.message}`);
    }
    return { ok: true };
  });
