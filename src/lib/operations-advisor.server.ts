import OpenAI from "openai";
import { z } from "zod";
import {
  buildDeterministicOperationsAdvice,
  type OperationsAdvice,
  type Recommendation,
} from "./operations-recommendations";

const adviceSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  priorities: z.array(z.string().trim().min(1).max(180)).min(1).max(4),
});

export function operationsAiEnabled() {
  return process.env.AI_RECOMMENDATIONS_ENABLED === "true";
}

export async function getOperationsAdvice(
  recommendations: Recommendation[],
): Promise<OperationsAdvice> {
  const fallback = buildDeterministicOperationsAdvice(recommendations);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model =
    process.env.AI_RECOMMENDATIONS_OPENAI_MODEL?.trim() ||
    process.env.OPENAI_TEXT_MODEL?.trim() ||
    "gpt-5-mini";

  if (!operationsAiEnabled() || !apiKey) return fallback;

  try {
    const client = new OpenAI({ apiKey, maxRetries: 0 });
    const response = await client.responses.create({
      model,
      store: false,
      input: [
        {
          role: "system",
          content:
            "You write short operational CRM advice. You are advisory only. Never instruct the system to mutate records automatically.",
        },
        {
          role: "user",
          content: JSON.stringify({
            recommendations: recommendations.map((item) => ({
              title: item.title,
              detail: item.detail,
              severity: item.severity,
              source_key: item.source.key,
              source_value: item.source.value,
            })),
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "operations_advice",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              priorities: {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 4,
              },
            },
            required: ["summary", "priorities"],
          },
        },
      },
    });

    const parsed = adviceSchema.parse(JSON.parse(response.output_text ?? "{}"));
    return { source: "ai", summary: parsed.summary, priorities: parsed.priorities };
  } catch {
    return fallback;
  }
}
