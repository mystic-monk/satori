// Shared date-grouping used by both All Notes' and History's "Group by:
// Date" option — a real shared utility (not a premature one) since both
// need the exact same buckets for the same reason: "when" is more useful
// as a handful of human buckets than as one row per calendar day.
//
// Buckets are computed from local calendar days, not a rolling 24h/7d/30d
// window — "Yesterday" means the previous calendar day even if it was
// only 3 hours ago at 11pm, matching how every calendar app already
// defines it, not a raw millisecond difference.
const DAY_MS = 24 * 60 * 60 * 1000;

export type DateBucketLabel = "Today" | "Yesterday" | "This week" | "This month" | "Older";

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dateBucket(timestamp: number, now: Date = new Date()): DateBucketLabel {
  const today = startOfDay(now);
  const day = startOfDay(new Date(timestamp));
  const daysAgo = Math.round((today - day) / DAY_MS);

  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo <= 7) return "This week";
  if (daysAgo <= 30) return "This month";
  return "Older";
}

// Fixed order for rendering group sections — Object.keys/a plain sort
// would put them in whatever order they were first encountered or
// alphabetically ("Older" before "Today"), neither of which reads as
// "most recent first" the way this list always should.
export const DATE_BUCKET_ORDER: DateBucketLabel[] = ["Today", "Yesterday", "This week", "This month", "Older"];
