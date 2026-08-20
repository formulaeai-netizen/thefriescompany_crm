export const leadStatuses = [
  "new",
  "contacted",
  "replied",
  "interested",
  "sample_planned",
  "sample_sent",
  "follow_up",
  "converted",
  "not_interested",
  "no_response",
  "lost",
] as const;
export type LeadStatus = (typeof leadStatuses)[number];
type LeadLike = { id: string; status: string; next_follow_up_at?: string | null };
type ActivityLike = { lead_id: string; activity_type: string };
type SampleLike = { lead_id: string; status: string; follow_up_due_at?: string | null };

export function isFollowUpDue(value: string | null | undefined, now = new Date()) {
  return Boolean(value) && new Date(value!).getTime() <= now.getTime();
}

export function deriveLeadMetrics(
  leads: LeadLike[],
  activities: ActivityLike[],
  samples: SampleLike[],
  now = new Date(),
) {
  const contacted = new Set(
    activities
      .filter((item) =>
        ["call", "whatsapp", "visit", "email", "follow_up"].includes(item.activity_type),
      )
      .map((item) => item.lead_id),
  );
  const replied = new Set(
    activities
      .filter((item) => item.activity_type === "response_received")
      .map((item) => item.lead_id),
  );
  const samplesDue = samples.filter((item) => isFollowUpDue(item.follow_up_due_at, now));
  const samplesFollowed = new Set(
    activities.filter((item) => item.activity_type === "follow_up").map((item) => item.lead_id),
  );
  return {
    leads: leads.length,
    contacted: contacted.size,
    replied: replied.size,
    interested: leads.filter((lead) => lead.status === "interested").length,
    samplesSent: samples.filter((sample) => ["sent", "delivered"].includes(sample.status)).length,
    samplesDue: samplesDue.length,
    samplesFollowed: samplesDue.filter((sample) => samplesFollowed.has(sample.lead_id)).length,
    converted: leads.filter((lead) => lead.status === "converted").length,
    overdue: leads.filter(
      (lead) =>
        !["converted", "lost", "not_interested"].includes(lead.status) &&
        isFollowUpDue(lead.next_follow_up_at, now),
    ).length,
  };
}

export function suggestedStatusForActivity(
  activityType: string,
  currentStatus: string,
): LeadStatus {
  if (["converted", "lost", "not_interested"].includes(currentStatus))
    return currentStatus as LeadStatus;
  if (activityType === "response_received") return "replied";
  if (activityType === "sample_planned") return "sample_planned";
  if (activityType === "sample_sent") return "sample_sent";
  if (["call", "whatsapp", "visit", "email", "follow_up"].includes(activityType))
    return "contacted";
  return currentStatus as LeadStatus;
}
