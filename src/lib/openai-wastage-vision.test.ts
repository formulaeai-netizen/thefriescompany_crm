import assert from "node:assert/strict";
import test from "node:test";
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";

import {
  WastageAiConfigurationError,
  WastageAiRequestError,
  analyzeWastageScaleImage,
  createRealOpenAiClient,
  extractSafeRateLimitHeaders,
  type OpenAiResponsesClient,
} from "./openai-wastage-vision.server.ts";

const ORIGINAL_KEY = process.env.OPENAI_API_KEY;
const ORIGINAL_MODEL = process.env.OPENAI_VISION_MODEL;

async function withConfig<T>(fn: () => Promise<T>): Promise<T> {
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_VISION_MODEL = "test-model";
  try {
    // Awaiting here (not just returning the promise) matters: the finally
    // block below must not restore env vars until every await inside fn()
    // has actually settled, or a multi-call test loop would see the config
    // reset partway through its later iterations.
    return await fn();
  } finally {
    if (ORIGINAL_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = ORIGINAL_KEY;
    if (ORIGINAL_MODEL === undefined) delete process.env.OPENAI_VISION_MODEL;
    else process.env.OPENAI_VISION_MODEL = ORIGINAL_MODEL;
  }
}

function mockClient(outputText: string): OpenAiResponsesClient {
  return {
    responses: {
      create: async () => ({ output_text: outputText }),
    },
  };
}

test("missing OPENAI_API_KEY throws a configuration error before any request is made", async () => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_VISION_MODEL;
  await assert.rejects(
    () => analyzeWastageScaleImage({ base64DataUrl: "data:image/jpeg;base64,AAA" }),
    WastageAiConfigurationError,
  );
});

test("missing OPENAI_VISION_MODEL throws a configuration error", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.OPENAI_VISION_MODEL;
  await assert.rejects(
    () => analyzeWastageScaleImage({ base64DataUrl: "data:image/jpeg;base64,AAA" }),
    WastageAiConfigurationError,
  );
  delete process.env.OPENAI_API_KEY;
});

test("a clear structured reading is validated and returned (mocked client, no network)", async () => {
  await withConfig(async () => {
    const client = mockClient(
      JSON.stringify({
        reading_visible: true,
        detected_weight: 60.5,
        detected_unit: "kg",
        reading_quality: "clear",
        issue_code: null,
      }),
    );
    const result = await analyzeWastageScaleImage({
      base64DataUrl: "data:image/jpeg;base64,AAA",
      client,
    });
    assert.equal(result.reading_visible, true);
    assert.equal(result.detected_weight, 60.5);
    assert.equal(result.detected_unit, "kg");
    assert.equal(result.reading_quality, "clear");
  });
});

test("a partial reading is validated and returned", async () => {
  await withConfig(async () => {
    const client = mockClient(
      JSON.stringify({
        reading_visible: true,
        detected_weight: 58,
        detected_unit: "kg",
        reading_quality: "partial",
        issue_code: "glare",
      }),
    );
    const result = await analyzeWastageScaleImage({
      base64DataUrl: "data:image/jpeg;base64,AAA",
      client,
    });
    assert.equal(result.reading_quality, "partial");
    assert.equal(result.issue_code, "glare");
  });
});

test("an unreadable reading never carries a fabricated weight", async () => {
  await withConfig(async () => {
    const client = mockClient(
      JSON.stringify({
        reading_visible: false,
        detected_weight: null,
        detected_unit: null,
        reading_quality: "unreadable",
        issue_code: "blurred",
      }),
    );
    const result = await analyzeWastageScaleImage({
      base64DataUrl: "data:image/jpeg;base64,AAA",
      client,
    });
    assert.equal(result.reading_visible, false);
    assert.equal(result.detected_weight, null);
    assert.equal(result.detected_unit, null);
  });
});

test("a missing/unrecognizable unit is never guessed", async () => {
  await withConfig(async () => {
    const client = mockClient(
      JSON.stringify({
        reading_visible: true,
        detected_weight: 60,
        detected_unit: null,
        reading_quality: "partial",
        issue_code: "unit_not_visible",
      }),
    );
    const result = await analyzeWastageScaleImage({
      base64DataUrl: "data:image/jpeg;base64,AAA",
      client,
    });
    assert.equal(result.detected_unit, null);
    assert.equal(result.issue_code, "unit_not_visible");
  });
});

test("invalid structured output (schema violation) is treated as a request error, never parsed as prose", async () => {
  await withConfig(async () => {
    const client = mockClient(JSON.stringify({ reading_visible: "yes", detected_weight: "sixty" }));
    await assert.rejects(
      () => analyzeWastageScaleImage({ base64DataUrl: "data:image/jpeg;base64,AAA", client }),
      WastageAiRequestError,
    );
  });
});

test("non-JSON output is treated as a request error", async () => {
  await withConfig(async () => {
    const client = mockClient("not json at all");
    await assert.rejects(
      () => analyzeWastageScaleImage({ base64DataUrl: "data:image/jpeg;base64,AAA", client }),
      WastageAiRequestError,
    );
  });
});

test("a provider/network failure is sanitized and never leaks the raw error text", async () => {
  await withConfig(async () => {
    const client: OpenAiResponsesClient = {
      responses: {
        create: async () => {
          throw new Error("super secret internal provider stack trace with an API key abc123");
        },
      },
    };
    try {
      await analyzeWastageScaleImage({ base64DataUrl: "data:image/jpeg;base64,AAA", client });
      assert.fail("expected rejection");
    } catch (err) {
      assert.ok(err instanceof WastageAiRequestError);
      assert.equal(err.code, "openai_request_failed");
      assert.doesNotMatch(err.message, /abc123/);
      assert.doesNotMatch(err.message, /stack trace/);
    }
  });
});

test("only one API call is made per analyzeWastageScaleImage invocation", async () => {
  await withConfig(async () => {
    let calls = 0;
    const client: OpenAiResponsesClient = {
      responses: {
        create: async () => {
          calls += 1;
          return {
            output_text: JSON.stringify({
              reading_visible: true,
              detected_weight: 60,
              detected_unit: "kg",
              reading_quality: "clear",
              issue_code: null,
            }),
          };
        },
      },
    };
    await analyzeWastageScaleImage({ base64DataUrl: "data:image/jpeg;base64,AAA", client });
    assert.equal(calls, 1);
  });
});

function clientThatThrows(err: unknown): OpenAiResponsesClient {
  return {
    responses: {
      create: async () => {
        throw err;
      },
    },
  };
}

async function expectErrorCode(client: OpenAiResponsesClient, expectedCode: string) {
  try {
    await analyzeWastageScaleImage({
      base64DataUrl: "data:image/jpeg;base64,AAA",
      client,
      retryDelayMs: 0,
    });
    assert.fail(`expected a WastageAiRequestError with code ${expectedCode}`);
  } catch (err) {
    assert.ok(err instanceof WastageAiRequestError);
    assert.equal(err.code, expectedCode);
  }
}

test("a 401 is classified as openai_auth_failed", async () => {
  await withConfig(async () => {
    const err = new AuthenticationError(
      401,
      { code: "invalid_api_key", message: "secret detail" },
      "msg",
      new Headers(),
    );
    await expectErrorCode(clientThatThrows(err), "openai_auth_failed");
  });
});

test("a 403 is classified as openai_access_denied", async () => {
  await withConfig(async () => {
    const err = new PermissionDeniedError(403, { message: "secret detail" }, "msg", new Headers());
    await expectErrorCode(clientThatThrows(err), "openai_access_denied");
  });
});

test("a 404 is classified as openai_model_not_found", async () => {
  await withConfig(async () => {
    const err = new NotFoundError(404, { message: "secret detail" }, "msg", new Headers());
    await expectErrorCode(clientThatThrows(err), "openai_model_not_found");
  });
});

test("a 400 is classified as openai_invalid_request", async () => {
  await withConfig(async () => {
    const err = new BadRequestError(400, { message: "secret detail" }, "msg", new Headers());
    await expectErrorCode(clientThatThrows(err), "openai_invalid_request");
  });
});

test("a 429 with an insufficient_quota code is classified as openai_quota_exceeded", async () => {
  await withConfig(async () => {
    const err = new RateLimitError(
      429,
      { code: "insufficient_quota", message: "secret detail" },
      "msg",
      new Headers(),
    );
    await expectErrorCode(clientThatThrows(err), "openai_quota_exceeded");
  });
});

test("a plain 429 without a quota code is classified as openai_rate_limited", async () => {
  await withConfig(async () => {
    const err = new RateLimitError(
      429,
      { code: "rate_limit_exceeded", message: "secret detail" },
      "msg",
      new Headers(),
    );
    await expectErrorCode(clientThatThrows(err), "openai_rate_limited");
  });
});

test("a request timeout is classified as openai_timeout", async () => {
  await withConfig(async () => {
    const err = new APIConnectionTimeoutError({ message: "secret detail" });
    await expectErrorCode(clientThatThrows(err), "openai_timeout");
  });
});

test("a connection/network failure is classified as openai_network_error", async () => {
  await withConfig(async () => {
    const err = new APIConnectionError({ message: "secret detail" });
    await expectErrorCode(clientThatThrows(err), "openai_network_error");
  });
});

test("a 5xx is classified as openai_server_error", async () => {
  await withConfig(async () => {
    const err = new InternalServerError(500, { message: "secret detail" }, "msg", new Headers());
    await expectErrorCode(clientThatThrows(err), "openai_server_error");
  });
});

test("an unrecognized error falls back to openai_request_failed", async () => {
  await withConfig(async () => {
    await expectErrorCode(
      clientThatThrows(new Error("some other unexpected failure with secret detail")),
      "openai_request_failed",
    );
  });
});

test("none of the controlled error codes ever leak the raw provider message", async () => {
  await withConfig(async () => {
    const cases = [
      new AuthenticationError(
        401,
        { message: "super secret internal detail" },
        "msg",
        new Headers(),
      ),
      new RateLimitError(
        429,
        { code: "insufficient_quota", message: "super secret internal detail" },
        "msg",
        new Headers(),
      ),
      new InternalServerError(
        500,
        { message: "super secret internal detail" },
        "msg",
        new Headers(),
      ),
    ];
    for (const err of cases) {
      try {
        await analyzeWastageScaleImage({
          base64DataUrl: "data:image/jpeg;base64,AAA",
          client: clientThatThrows(err),
        });
        assert.fail("expected rejection");
      } catch (thrown) {
        assert.ok(thrown instanceof WastageAiRequestError);
        assert.doesNotMatch(thrown.message, /super secret internal detail/);
      }
    }
  });
});

test("the real production client is constructed with maxRetries: 0 (no network call - construction only)", () => {
  const client = createRealOpenAiClient("test-key");
  assert.equal(client.maxRetries, 0);
});

test("the production image request uses low detail to reduce vision token spikes", async () => {
  await withConfig(async () => {
    let capturedParams: Record<string, unknown> | null = null;
    const client: OpenAiResponsesClient = {
      responses: {
        create: async (params) => {
          capturedParams = params;
          return {
            output_text: JSON.stringify({
              reading_visible: true,
              detected_weight: 1,
              detected_unit: "kg",
              reading_quality: "clear",
              issue_code: null,
            }),
          };
        },
      },
    };
    await analyzeWastageScaleImage({ base64DataUrl: "data:image/jpeg;base64,AAA", client });
    assert.ok(capturedParams);
    // Cast rather than rely on control-flow narrowing: capturedParams is
    // reassigned inside a nested closure, which TS's narrowing does not
    // track back out to this scope - the assert.ok above already proves
    // it is non-null at runtime.
    const params = capturedParams as Record<string, unknown>;
    const input = params.input as Array<{ content: Array<Record<string, unknown>> }>;
    const imageContent = input[0].content[1];
    assert.equal(imageContent.type, "input_image");
    assert.equal(imageContent.detail, "low");
  });
});

test("non-rate-limit failures are never retried", async () => {
  await withConfig(async () => {
    let calls = 0;
    const err = new BadRequestError(400, { message: "bad request" }, "msg", new Headers());
    const client: OpenAiResponsesClient = {
      responses: {
        create: async () => {
          calls += 1;
          throw err;
        },
      },
    };
    try {
      await analyzeWastageScaleImage({ base64DataUrl: "data:image/jpeg;base64,AAA", client });
      assert.fail("expected rejection");
    } catch {
      // expected
    }
    assert.equal(calls, 1);
  });
});

test("a retryable 429 is retried with bounded backoff and can recover", async () => {
  await withConfig(async () => {
    let calls = 0;
    const err = new RateLimitError(429, { code: "rate_limit_exceeded" }, "msg", new Headers());
    const client: OpenAiResponsesClient = {
      responses: {
        create: async () => {
          calls += 1;
          if (calls === 1) throw err;
          return {
            output_text: JSON.stringify({
              reading_visible: true,
              detected_weight: 1,
              detected_unit: "kg",
              reading_quality: "clear",
              issue_code: null,
            }),
          };
        },
      },
    };

    const result = await analyzeWastageScaleImage({
      base64DataUrl: "data:image/jpeg;base64,AAA",
      client,
      retryDelayMs: 0,
    });

    assert.equal(calls, 2);
    assert.equal(result.detected_weight, 1);
  });
});

test("quota-exceeded 429 is not retried", async () => {
  await withConfig(async () => {
    let calls = 0;
    const err = new RateLimitError(429, { code: "insufficient_quota" }, "msg", new Headers());
    const client: OpenAiResponsesClient = {
      responses: {
        create: async () => {
          calls += 1;
          throw err;
        },
      },
    };
    await assert.rejects(
      () =>
        analyzeWastageScaleImage({
          base64DataUrl: "data:image/jpeg;base64,AAA",
          client,
          retryDelayMs: 0,
        }),
      WastageAiRequestError,
    );
    assert.equal(calls, 1);
  });
});

test("extractSafeRateLimitHeaders extracts only the named safe headers, nothing else", () => {
  const headers = new Headers();
  headers.set("x-request-id", "req_123");
  headers.set("x-ratelimit-limit-requests", "500");
  headers.set("x-ratelimit-remaining-requests", "0");
  headers.set("x-ratelimit-reset-requests", "12s");
  headers.set("x-ratelimit-limit-tokens", "500000");
  headers.set("x-ratelimit-remaining-tokens", "499000");
  headers.set("x-ratelimit-reset-tokens", "1s");
  headers.set("retry-after", "5");
  headers.set("set-cookie", "should-never-be-read");
  headers.set("authorization", "Bearer super-secret-should-never-be-read");

  const safe = extractSafeRateLimitHeaders(headers);

  assert.equal(safe["x-request-id"], "req_123");
  assert.equal(safe["x-ratelimit-limit-requests"], "500");
  assert.equal(safe["x-ratelimit-remaining-requests"], "0");
  assert.equal(safe["x-ratelimit-reset-requests"], "12s");
  assert.equal(safe["x-ratelimit-limit-tokens"], "500000");
  assert.equal(safe["x-ratelimit-remaining-tokens"], "499000");
  assert.equal(safe["x-ratelimit-reset-tokens"], "1s");
  assert.equal(safe["retry-after"], "5");
  assert.deepEqual(Object.keys(safe).sort(), [
    "retry-after",
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "x-request-id",
  ]);
  assert.doesNotMatch(JSON.stringify(safe), /super-secret|should-never-be-read/);
});

test("extractSafeRateLimitHeaders handles missing headers safely", () => {
  const safe = extractSafeRateLimitHeaders(undefined);
  assert.equal(safe["x-request-id"], null);
  assert.equal(safe["retry-after"], null);
});

test("a 429 during analyzeWastageScaleImage never leaks header values through the thrown error", async () => {
  await withConfig(async () => {
    const headers = new Headers();
    headers.set("x-request-id", "req_secret_456");
    headers.set("retry-after", "30");
    const err = new RateLimitError(
      429,
      { code: "rate_limit_exceeded", message: "raw provider text" },
      "msg",
      headers,
    );
    const client: OpenAiResponsesClient = {
      responses: {
        create: async () => {
          throw err;
        },
      },
    };
    try {
      await analyzeWastageScaleImage({
        base64DataUrl: "data:image/jpeg;base64,AAA",
        client,
        retryDelayMs: 0,
      });
      assert.fail("expected rejection");
    } catch (thrown) {
      assert.ok(thrown instanceof WastageAiRequestError);
      assert.equal(thrown.code, "openai_rate_limited");
      assert.doesNotMatch(thrown.message, /req_secret_456/);
      assert.doesNotMatch(thrown.message, /raw provider text/);
    }
  });
});
