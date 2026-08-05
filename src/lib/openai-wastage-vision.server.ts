import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import { z } from "zod";

// Server-only. This module must never be imported from a route file, a
// *.functions.ts file, or any other module that ships to the client
// bundle - only from other .server.ts modules, which Vite strips from the
// client build (see src/lib/config.server.ts for the same convention).

const structuredReadingSchema = z.object({
  reading_visible: z.boolean(),
  detected_weight: z.number().positive().nullable(),
  detected_unit: z.enum(["kg", "g"]).nullable(),
  reading_quality: z.enum(["clear", "partial", "unreadable"]),
  issue_code: z
    .enum([
      "blurred",
      "glare",
      "obstructed",
      "cropped_display",
      "multiple_readings",
      "unit_not_visible",
      "display_not_visible",
      "other",
    ])
    .nullable(),
});

export type WastageScaleReading = z.infer<typeof structuredReadingSchema>;

export class WastageAiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WastageAiConfigurationError";
  }
}

export class WastageAiRequestError extends Error {
  /** A short, non-sensitive code safe to persist in ai_error_code. Never the raw provider error text. */
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "WastageAiRequestError";
    this.code = code;
  }
}

const PROMPT = [
  "You are transcribing a digital or analog weighing-scale display from a photo.",
  "Report only what is visibly displayed on the scale. Do not guess or infer a weight from anything else in the image.",
  "Do not use any externally-provided weight as evidence - rely only on the pixels in this image.",
  "If the numeric display is not clearly readable, set reading_visible to false, detected_weight and detected_unit to null, and choose the closest issue_code.",
  "If the unit (kg or g) is not visibly printed or displayed and cannot be safely read, set detected_unit to null - never guess a unit.",
  "reading_quality must be 'clear' only when the full numeric value and unit are unambiguous; use 'partial' when a reading is visible but degraded (e.g. mild blur/glare); use 'unreadable' when no reliable reading can be made.",
].join(" ");

function getConfig(): { apiKey: string; model: string } {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_VISION_MODEL;
  if (!apiKey || !model) {
    const missing = [
      !apiKey ? "OPENAI_API_KEY" : null,
      !model ? "OPENAI_VISION_MODEL" : null,
    ].filter(Boolean);
    throw new WastageAiConfigurationError(`Missing configuration: ${missing.join(", ")}`);
  }
  return { apiKey, model };
}

export type OpenAiResponsesClient = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<{ output_text?: string }>;
  };
};

export const WASTAGE_AI_RATE_LIMIT_RETRY_DELAYS_MS = [15_000, 45_000] as const;
const MAX_PROVIDER_RETRY_DELAY_MS = 120_000;

/**
 * Constructs the real production OpenAI client. Exported (rather than
 * inlined) so tests can verify `maxRetries: 0` was actually applied by
 * inspecting the constructed instance - constructing the client performs
 * no network I/O. maxRetries: 0 disables the SDK's default 2 hidden
 * automatic retries: one CRM AI attempt must equal exactly one provider
 * HTTP attempt.
 */
export function createRealOpenAiClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, maxRetries: 0 });
}

/**
 * Rate-limit response headers that are safe to log: they carry only
 * provider-assigned request/rate-limit bookkeeping (numbers, timestamps,
 * an opaque request id), never account/customer text. Everything else on
 * the response (message, body, headers not in this list) is intentionally
 * never read here.
 */
const SAFE_RATE_LIMIT_HEADER_NAMES = [
  "x-request-id",
  "x-ratelimit-limit-requests",
  "x-ratelimit-remaining-requests",
  "x-ratelimit-reset-requests",
  "x-ratelimit-limit-tokens",
  "x-ratelimit-remaining-tokens",
  "x-ratelimit-reset-tokens",
  "retry-after",
] as const;

export type SafeRateLimitHeaders = Record<
  (typeof SAFE_RATE_LIMIT_HEADER_NAMES)[number],
  string | null
>;

/** Extracts only the named safe headers from a 429 response - never the provider message/body. */
export function extractSafeRateLimitHeaders(
  headers: Headers | undefined | null,
): SafeRateLimitHeaders {
  const result = {} as SafeRateLimitHeaders;
  for (const name of SAFE_RATE_LIMIT_HEADER_NAMES) {
    result[name] = headers?.get(name) ?? null;
  }
  return result;
}

/**
 * Maps a thrown exception from client.responses.create() to a controlled,
 * sanitized error code safe for database storage and Admin troubleshooting.
 * Never inspects/stores the raw provider message, response body, or
 * headers - only the SDK's typed error class and (for the 429 quota-vs-
 * rate-limit distinction) the provider's own short machine-readable error
 * code field, never free-text.
 */
function classifyOpenAiError(err: unknown): string {
  if (err instanceof APIConnectionTimeoutError) return "openai_timeout";
  if (err instanceof APIConnectionError) return "openai_network_error";
  if (err instanceof AuthenticationError) return "openai_auth_failed";
  if (err instanceof PermissionDeniedError) return "openai_access_denied";
  if (err instanceof NotFoundError) return "openai_model_not_found";
  if (err instanceof BadRequestError) return "openai_invalid_request";
  if (err instanceof RateLimitError) {
    const providerCode = typeof err.code === "string" ? err.code : "";
    return providerCode.includes("quota") ? "openai_quota_exceeded" : "openai_rate_limited";
  }
  if (err instanceof InternalServerError) return "openai_server_error";
  return "openai_request_failed";
}

function isRetryableRateLimit(err: unknown): err is RateLimitError {
  if (!(err instanceof RateLimitError)) return false;
  const providerCode = typeof err.code === "string" ? err.code : "";
  return !providerCode.includes("quota");
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseProviderRetryDelayMs(headers: Headers | undefined | null): number | null {
  const retryAfter = headers?.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.ceil(seconds * 1_000), MAX_PROVIDER_RETRY_DELAY_MS);
    }
  }

  for (const headerName of ["x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"]) {
    const value = headers?.get(headerName);
    if (!value) continue;

    const secondsMatch = value.match(/^(\d+(?:\.\d+)?)s$/i);
    if (secondsMatch) {
      return Math.min(Math.ceil(Number(secondsMatch[1]) * 1_000), MAX_PROVIDER_RETRY_DELAY_MS);
    }
  }

  return null;
}

async function createResponseWithRateLimitRetry(
  client: OpenAiResponsesClient,
  params: Record<string, unknown>,
  retryDelayMs?: number,
): Promise<{ output_text?: string }> {
  let attempt = 0;
  for (;;) {
    try {
      return await client.responses.create(params);
    } catch (err) {
      if (!isRetryableRateLimit(err) || attempt >= WASTAGE_AI_RATE_LIMIT_RETRY_DELAYS_MS.length) {
        throw err;
      }
      const safeHeaders = extractSafeRateLimitHeaders(err.headers);
      const providerDelayMs = parseProviderRetryDelayMs(err.headers);
      const delayMs =
        retryDelayMs ?? providerDelayMs ?? WASTAGE_AI_RATE_LIMIT_RETRY_DELAYS_MS[attempt];
      attempt += 1;
      console.warn("OpenAI rate limit while reading wastage image; retrying with backoff", {
        attempt,
        max_attempts: WASTAGE_AI_RATE_LIMIT_RETRY_DELAYS_MS.length + 1,
        delay_ms: delayMs,
        headers: safeHeaders,
      });
      await wait(delayMs);
    }
  }
}

/**
 * Sends a single wastage scale-reading image to the OpenAI Responses API and
 * returns only the validated structured fields - never the raw response, and
 * never a fabricated reading. `client` may be injected for testing; in
 * production it is lazily constructed from server-only env vars.
 */
export async function analyzeWastageScaleImage(params: {
  base64DataUrl: string;
  client?: OpenAiResponsesClient;
  retryDelayMs?: number;
}): Promise<WastageScaleReading> {
  const { apiKey, model } = getConfig();
  const client: OpenAiResponsesClient = params.client ?? createRealOpenAiClient(apiKey);

  let raw: { output_text?: string };
  try {
    raw = await createResponseWithRateLimitRetry(
      client,
      {
        model,
        store: false,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: PROMPT },
              { type: "input_image", image_url: params.base64DataUrl, detail: "low" },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "wastage_scale_reading",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                reading_visible: { type: "boolean" },
                detected_weight: { type: ["number", "null"] },
                detected_unit: { type: ["string", "null"], enum: ["kg", "g", null] },
                reading_quality: { type: "string", enum: ["clear", "partial", "unreadable"] },
                issue_code: {
                  type: ["string", "null"],
                  enum: [
                    "blurred",
                    "glare",
                    "obstructed",
                    "cropped_display",
                    "multiple_readings",
                    "unit_not_visible",
                    "display_not_visible",
                    "other",
                    null,
                  ],
                },
              },
              required: [
                "reading_visible",
                "detected_weight",
                "detected_unit",
                "reading_quality",
                "issue_code",
              ],
            },
          },
        },
      },
      params.retryDelayMs,
    );
  } catch (err) {
    // Never persist the raw provider error text, response body, or headers -
    // only a controlled, sanitized code derived from the SDK's typed error
    // class (see classifyOpenAiError). On a 429 specifically, log only the
    // provider's rate-limit bookkeeping headers server-side (never the
    // response body/message, never the API key) - this is server-only
    // console output, not stored in any browser-accessible table.
    if (err instanceof RateLimitError) {
      console.error(
        "OpenAI rate limit (429) - safe headers only:",
        extractSafeRateLimitHeaders(err.headers),
      );
    }
    const code = classifyOpenAiError(err);
    throw new WastageAiRequestError(code, `The OpenAI request failed (${code})`);
  }

  const outputText = raw.output_text;
  if (!outputText) {
    throw new WastageAiRequestError(
      "openai_empty_response",
      "The OpenAI response contained no output",
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(outputText);
  } catch {
    throw new WastageAiRequestError(
      "openai_invalid_json",
      "The OpenAI response was not valid JSON",
    );
  }

  const parsed = structuredReadingSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new WastageAiRequestError(
      "openai_invalid_schema",
      "The OpenAI response did not match the required schema",
    );
  }

  return parsed.data;
}
