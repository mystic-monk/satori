import { describe, expect, it } from "vitest";
import { dateBucket } from "./dateBucket";

const NOW = new Date(2026, 8, 15, 14, 30); // Sep 15, 2026, 2:30pm — a Tuesday

function daysBefore(n: number, hour = 14, minute = 30): Date {
  return new Date(2026, 8, 15 - n, hour, minute);
}

describe("dateBucket", () => {
  it("buckets a timestamp from earlier today as Today", () => {
    expect(dateBucket(new Date(2026, 8, 15, 0, 1).getTime(), NOW)).toBe("Today");
  });

  it("buckets exactly midnight today as Today", () => {
    expect(dateBucket(new Date(2026, 8, 15, 0, 0, 0).getTime(), NOW)).toBe("Today");
  });

  it("buckets yesterday late at night as Yesterday, not This week", () => {
    expect(dateBucket(new Date(2026, 8, 14, 23, 59).getTime(), NOW)).toBe("Yesterday");
  });

  it("buckets 2-7 days ago as This week", () => {
    expect(dateBucket(daysBefore(2).getTime(), NOW)).toBe("This week");
    expect(dateBucket(daysBefore(7).getTime(), NOW)).toBe("This week");
  });

  it("buckets 8-30 days ago as This month", () => {
    expect(dateBucket(daysBefore(8).getTime(), NOW)).toBe("This month");
    expect(dateBucket(daysBefore(30).getTime(), NOW)).toBe("This month");
  });

  it("buckets more than 30 days ago as Older", () => {
    expect(dateBucket(daysBefore(31).getTime(), NOW)).toBe("Older");
    expect(dateBucket(daysBefore(365).getTime(), NOW)).toBe("Older");
  });

  it("a future timestamp still counts as Today rather than a negative bucket", () => {
    expect(dateBucket(new Date(2026, 8, 16, 1, 0).getTime(), NOW)).toBe("Today");
  });
});
