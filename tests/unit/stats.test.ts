import {
  bucketStats,
  buildStatsCsv,
  type StatsSummary,
} from "../../src/components/stats_board";
import type { Task } from "../../src/system/obj_types";

const ME = "user-me";
const OTHER = "user-other";

// Wednesday noon local time: this week starts Mon 2026-09-14,
// last week Mon 2026-09-07. Local wall clock keeps the test green in
// any timezone.
const WED = new Date(2026, 8, 16, 12, 0, 0);
const at = (month: number, day: number, hour: number) =>
  new Date(2026, month, day, hour, 0, 0).toISOString();

function task(id: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    household_id: 1,
    title: `Task ${id}`,
    description: null,
    difficulty: "easy",
    points: 100,
    status: "completed",
    owner: ME,
    created_by: ME,
    created_at: "2026-09-01T00:00:00Z",
    completed_at: "2026-09-14T10:00:00Z",
    ...extra,
  } as Task;
}

describe("bucketStats", () => {
  it("splits this week per-day and last week totals", () => {
    const summary = bucketStats(
      [
        task(1, { completed_at: at(8, 14, 10), points: 100 }),
        task(2, { completed_at: at(8, 15, 18), points: 200 }),
        task(3, { completed_at: at(8, 7, 9), points: 150 }),
        task(4, { completed_at: at(7, 30, 9), points: 500 }),
        task(5, { completed_at: at(8, 14, 10), owner: OTHER }),
        task(6, { completed_at: null, status: "taken", owner: ME }),
        task(7, { completed_at: null }),
      ],
      ME,
      WED,
    );
    expect(summary.thisWeek).toEqual({ count: 2, points: 300 });
    expect(summary.lastWeek).toEqual({ count: 1, points: 150 });
    expect(summary.deltaCount).toBe(1);
    expect(summary.deltaPoints).toBe(150);
    expect(summary.days[0]).toMatchObject({ label: "Mon", count: 1, points: 100 });
    expect(summary.days[1]).toMatchObject({ label: "Tue", count: 1, points: 200 });
    expect(summary.days.slice(2).every((d) => d.count === 0)).toBe(true);
    expect(summary.lastDays[0]).toMatchObject({ label: "Mon", count: 1, points: 150 });
    expect(summary.lastDays.slice(1).every((d) => d.count === 0)).toBe(true);
  });

  it("treats Monday 00:00 as this week and Sunday night as last week", () => {
    // Local wall-clock boundaries: robust in any test timezone.
    const mondayNoon = new Date(2026, 8, 14, 12, 0, 0);
    const mondayMidnight = new Date(2026, 8, 14, 0, 0, 0).toISOString();
    const sundayNight = new Date(2026, 8, 13, 23, 59, 0).toISOString();
    const summary = bucketStats(
      [
        task(1, { completed_at: mondayMidnight }),
        task(2, { completed_at: sundayNight }),
      ],
      ME,
      mondayNoon,
    );
    expect(summary.days[0].count).toBe(1);
    expect(summary.lastDays[6].count).toBe(1);
  });

  it("returns zeros with no user or no tasks", () => {
    const empty = bucketStats([], null, WED);
    expect(empty.thisWeek).toEqual({ count: 0, points: 0 });
    expect(empty.lastWeek).toEqual({ count: 0, points: 0 });
    expect(empty.days).toHaveLength(7);
    expect(empty.lastDays).toHaveLength(7);
    expect(empty.days.map((d) => d.label)).toEqual(
      ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    );
  });

  it("skips rows with bad timestamps", () => {
    const summary = bucketStats(
      [task(1, { completed_at: "not-a-date" })],
      ME,
      WED,
    );
    expect(summary.thisWeek).toEqual({ count: 0, points: 0 });
  });
});

describe("buildStatsCsv", () => {
  it("renders header, daily rows and summaries", () => {
    const summary: StatsSummary = {
      days: [
        { date: "2026-09-14", label: "Mon", count: 2, points: 240 },
        { date: "2026-09-15", label: "Tue", count: 0, points: 0 },
        { date: "2026-09-16", label: "Wed", count: 1, points: 100 },
        { date: "2026-09-17", label: "Thu", count: 0, points: 0 },
        { date: "2026-09-18", label: "Fri", count: 0, points: 0 },
        { date: "2026-09-19", label: "Sat", count: 0, points: 0 },
        { date: "2026-09-20", label: "Sun", count: 0, points: 0 },
      ],
      lastDays: [
        { date: "2026-09-07", label: "Mon", count: 1, points: 300 },
        { date: "2026-09-08", label: "Tue", count: 0, points: 0 },
        { date: "2026-09-09", label: "Wed", count: 0, points: 0 },
        { date: "2026-09-10", label: "Thu", count: 0, points: 0 },
        { date: "2026-09-11", label: "Fri", count: 0, points: 0 },
        { date: "2026-09-12", label: "Sat", count: 0, points: 0 },
        { date: "2026-09-13", label: "Sun", count: 0, points: 0 },
      ],
      thisWeek: { count: 3, points: 340 },
      lastWeek: { count: 1, points: 300 },
      deltaCount: 2,
      deltaPoints: 40,
    };
    const csv = buildStatsCsv(summary);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("week,day,date,completed,points");
    expect(lines).toContain("this week,Mon,2026-09-14,2,240");
    expect(lines).toContain("last week,Mon,2026-09-07,1,300");
    expect(lines).toContain("summary,this week,,3,340");
    expect(lines).toContain("summary,last week,,1,300");
    // 1 header + 14 days + 2 summaries.
    expect(lines).toHaveLength(17);
  });
});
