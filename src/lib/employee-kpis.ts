export function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : null;
}
export function health(actual: number | null, target: number | null) {
  if (actual === null || target === null) return "unclassified" as const;
  return actual >= target
    ? ("green" as const)
    : actual >= target * 0.9
      ? ("amber" as const)
      : ("red" as const);
}
export function operationsKpis(input: {
  planned: number;
  actual: number;
  deliveries: number;
  onTime: number;
  receivingDue: number;
  receivingDone: number;
  missingIncidents: number;
}) {
  return {
    productionAchievement: ratio(input.actual, input.planned),
    productionShortfall: Math.max(input.planned - input.actual, 0),
    onTimeDelivery: ratio(input.onTime, input.deliveries),
    receivingCompletion: ratio(input.receivingDone, input.receivingDue),
    missingReceiving: input.missingIncidents,
    cause: "Unclassified / Needs Review",
  };
}
export function salesKpis(input: {
  leads: number;
  contacted: number;
  replied: number;
  interested: number;
  samplesSent: number;
  samplesDue: number;
  samplesFollowed: number;
  converted: number;
  overdue: number;
}) {
  return {
    newLeads: input.leads,
    contacted: input.contacted,
    responseRate: ratio(input.replied, input.contacted),
    interested: input.interested,
    samplesSent: input.samplesSent,
    sampleFollowUpCompletion: ratio(input.samplesFollowed, input.samplesDue),
    converted: input.converted,
    conversionRate: ratio(input.converted, input.leads),
    overdueFollowUps: input.overdue,
  };
}

export function buildDailyBrief(input: {
  ordersDue: number;
  overdueOrders: number;
  productionRequired: number;
  receivingMissing: number;
  leadFollowUps: number;
  pendingPaymentVerifications: number;
}) {
  return [
    {
      key: "orders",
      label: "Orders due",
      value: input.ordersDue,
      href: "/orders",
      urgent: input.overdueOrders > 0,
    },
    {
      key: "production",
      label: "Production required",
      value: input.productionRequired,
      href: "/production-planning",
      urgent: input.productionRequired > 0,
    },
    {
      key: "receiving",
      label: "Receiving missing 3+ days",
      value: input.receivingMissing,
      href: "/orders",
      urgent: input.receivingMissing > 0,
    },
    {
      key: "leads",
      label: "Sales follow-ups due",
      value: input.leadFollowUps,
      href: "/sales-leads",
      urgent: input.leadFollowUps > 0,
    },
    {
      key: "payments",
      label: "Payment verifications",
      value: input.pendingPaymentVerifications,
      href: "/payment-verifications",
      urgent: input.pendingPaymentVerifications > 0,
    },
  ];
}
