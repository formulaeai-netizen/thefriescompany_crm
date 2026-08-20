export type RecommendationFact = {
  key: string;
  label?: string;
  value: number;
  href: string;
};

export type Recommendation = {
  key: string;
  title: string;
  detail: string;
  href: string;
  severity: "high" | "normal";
  source: RecommendationFact;
};

export type OperationsAdvice = {
  source: "deterministic" | "ai";
  summary: string;
  priorities: string[];
};

export function buildOperationsRecommendations(facts: RecommendationFact[]): Recommendation[] {
  const byKey = new Map(facts.map((fact) => [fact.key, fact]));
  const templates: Array<[string, string, string, "high" | "normal"]> = [
    [
      "production",
      "Close production shortfall",
      "Production remains required against today's approved plan.",
      "high",
    ],
    [
      "receiving",
      "Confirm overdue receiving",
      "Deliveries have been pending receiving confirmation for at least three days.",
      "high",
    ],
    [
      "orders",
      "Review due and overdue orders",
      "Orders are due or overdue and need an operational owner.",
      "high",
    ],
    [
      "leads",
      "Complete sales follow-ups",
      "Sales follow-ups are due from the canonical lead pipeline.",
      "normal",
    ],
    [
      "payments",
      "Review payment verifications",
      "Pending payment claims still require an Admin decision.",
      "normal",
    ],
  ];
  return templates.flatMap(([key, title, detail, severity]) => {
    const source = byKey.get(key);
    return source && source.value > 0
      ? [{ key: `${key}:${source.value}`, title, detail, href: source.href, severity, source }]
      : [];
  });
}

export function buildDeterministicOperationsAdvice(
  recommendations: Recommendation[],
): OperationsAdvice {
  if (recommendations.length === 0) {
    return {
      source: "deterministic",
      summary: "No operational exception currently needs escalation.",
      priorities: ["Keep normal review cadence and avoid creating manual adjustments."],
    };
  }

  const highCount = recommendations.filter((item) => item.severity === "high").length;
  return {
    source: "deterministic",
    summary:
      highCount > 0
        ? `${highCount} high-priority operational item${highCount === 1 ? "" : "s"} need review.`
        : "Operational follow-ups are present, with no high-priority exception.",
    priorities: recommendations.slice(0, 4).map((item) => item.title),
  };
}
