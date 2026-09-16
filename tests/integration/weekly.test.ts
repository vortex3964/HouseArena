import type { SupabaseClient } from "@supabase/supabase-js";
import { createHousehold, setCheckTime } from "../../src/system/db";
import { emptyDb, mondayOf, upcomingSunday, type FakeDb } from "../fake/fake_supabase";
import { FakeClient } from "../fake/fake_supabase";
import { ANA, createSeed } from "../fake/seed";

const DAY = 86400_000;

function member(
  db: FakeDb,
  id: string,
  username: string,
  points: number,
  householdId = 1,
  role = "member",
) {
  db.profiles.push({
    id,
    username,
    email: `${username}@mail.com`,
    avatar_url: null,
    points,
    gems: 0,
    strikes: 0,
    wins: 0,
    created_at: new Date().toISOString(),
  });
  db.household_members.push({
    household_id: householdId,
    profile_id: id,
    role,
    joined_at: new Date().toISOString(),
  });
}

function task(
  db: FakeDb,
  id: number,
  householdId: number,
  status: string,
  completedDaysAgo: number | null,
  owner: string | null = null,
) {
  db.tasks.push({
    id,
    title: `Task ${id}`,
    description: null,
    difficulty: "easy",
    points: 100,
    status,
    household_id: householdId,
    owner,
    created_by: "u-ann",
    created_at: new Date().toISOString(),
    completed_at:
      completedDaysAgo == null
        ? null
        : new Date(Date.now() - completedDaysAgo * DAY).toISOString(),
  });
}

// Household 1: ann 100, ben 85 (boundary, safe), cat 84 (struck),
// dan 0 (struck). Plus tasks across the prune cutoff.
function scoringDb(): FakeDb {
  const db = emptyDb();
  db.households.push({
    id: 1,
    name: "Flat",
    invite_code: "FLAT00000001",
    created_by: "u-ann",
    created_at: new Date().toISOString(),
    check_at: new Date(upcomingSunday(20, 0).getTime() - 7 * DAY).toISOString(),
  });
  member(db, "u-ann", "ann", 100, 1, "owner");
  member(db, "u-ben", "ben", 85);
  member(db, "u-cat", "cat", 84);
  member(db, "u-dan", "dan", 0);
  task(db, 1, 1, "completed", 30); // week-1 or older: pruned
  task(db, 2, 1, "completed", 20); // older than any cutoff: pruned
  task(db, 3, 1, "completed", 5); // recent: kept
  task(db, 4, 1, "free", null); // open work is never pruned
  task(db, 5, 1, "taken", null, "u-ann");
  task(db, 6, 1, "in_review", null, "u-ben");
  task(db, 7, 1, "completed", null); // no timestamp: kept
  return db;
}

let fake: FakeClient;
let client: SupabaseClient;

beforeEach(() => {
  fake = new FakeClient(createSeed());
  client = fake as unknown as SupabaseClient;
});

describe("Sunday pinning", () => {
  // Jan 2026: Mon 5, Tue 6, Sat 10, Sun 11. Every creation day must
  // land on the coming Sunday 20:00, never Monday or any other day.
  const cases: Array<[string, string]> = [
    ["2026-01-05T10:00:00Z", "2026-01-11T20:00:00.000Z"], // Monday
    ["2026-01-06T10:00:00Z", "2026-01-11T20:00:00.000Z"], // Tuesday
    ["2026-01-10T10:00:00Z", "2026-01-11T20:00:00.000Z"], // Saturday
    ["2026-01-11T19:00:00Z", "2026-01-11T20:00:00.000Z"], // Sunday evening, still ahead
    ["2026-01-11T20:00:00Z", "2026-01-18T20:00:00.000Z"], // Sunday exactly on time = next week
    ["2026-01-11T21:00:00Z", "2026-01-18T20:00:00.000Z"], // Sunday past time = next week
  ];

  it.each(cases)("created %s checks %s", (from, expected) => {
    expect(upcomingSunday(20, 0, new Date(from)).toISOString()).toBe(expected);
  });

  it("keeps a custom time on the Sunday slot", () => {
    expect(upcomingSunday(8, 30, new Date("2026-01-06T10:00:00Z")).toISOString()).toBe(
      "2026-01-11T08:30:00.000Z",
    );
  });

  it("new households land on a Sunday no matter the creation day", async () => {
    fake.signInAs(ANA.id);
    const home = await createHousehold(client, "Weekday Home");
    expect(new Date(home.check_at!).getUTCDay()).toBe(0);
  });
});

describe("setCheckTime", () => {
  it("pins the slot to the upcoming Sunday at the chosen time", async () => {
    fake.signInAs(ANA.id);
    const home = await setCheckTime(client, 1, 20, 30);
    const slot = new Date(home.check_at!);
    expect(slot.getUTCDay()).toBe(0);
    expect(slot.getUTCHours()).toBe(20);
    expect(slot.getUTCMinutes()).toBe(30);
    expect(slot.getTime()).toBeGreaterThan(Date.now());
    expect(slot.getTime() - Date.now()).toBeLessThanOrEqual(7 * DAY + 60_000);
  });

  it("rejects bad times client-side without an rpc", async () => {
    fake.signInAs("user-ana");
    fake.resetCalls();
    await expect(setCheckTime(client, 1, 24, 0)).rejects.toThrow("Pick a valid time.");
    await expect(setCheckTime(client, 1, 10, 60)).rejects.toThrow("Pick a valid time.");
    await expect(setCheckTime(client, 1, 10.5, 0)).rejects.toThrow("Pick a valid time.");
    expect(fake.calls.rpc).toBe(0);
  });

  it("rejects non-members and unknown households", async () => {
    fake.signInAs("user-charlie");
    await expect(setCheckTime(client, 1, 20, 0)).rejects.toThrow(
      "Not a member of this household",
    );
    fake.signInAs(ANA.id);
    await expect(setCheckTime(client, 999, 20, 0)).rejects.toThrow("does not exist");
  });
});

describe("run_weekly_check scoring", () => {
  function scored() {
    fake = new FakeClient(scoringDb());
    client = fake as unknown as SupabaseClient;
    return fake.rpc("run_weekly_check", { p_household_id: 1 });
  }

  it("crowns the top, strikes below 85%, spares the boundary", async () => {
    await scored();
    const byId = Object.fromEntries(fake.tables.profiles.map((p) => [p.id, p]));
    expect(byId["u-ann"]).toMatchObject({ gems: 1, wins: 1, strikes: 0 });
    expect(byId["u-ben"]).toMatchObject({ gems: 0, wins: 0, strikes: 0 });
    expect(byId["u-cat"].strikes).toBe(1);
    expect(byId["u-dan"].strikes).toBe(1);
  });

  it("crowns ties even at zero with no strikes", async () => {
    const db = emptyDb();
    db.households.push({
      id: 1,
      name: "Flat",
      invite_code: "FLAT00000001",
      created_by: "u-ann",
      created_at: new Date().toISOString(),
      check_at: new Date(upcomingSunday(20, 0).getTime() - 7 * DAY).toISOString(),
    });
    member(db, "u-ann", "ann", 0, 1, "owner");
    member(db, "u-ben", "ben", 0);
    fake = new FakeClient(db);
    await fake.rpc("run_weekly_check", { p_household_id: 1 });
    for (const p of fake.tables.profiles) {
      expect(p).toMatchObject({ gems: 1, wins: 1, strikes: 0 });
    }
  });

  it("announces the winner in the feed", async () => {
    await scored();
    const entry = fake.tables.activity_logs.find((l) =>
      String(l.details).startsWith("Weekly check:"),
    );
    expect(entry).toBeDefined();
    expect(entry.details).toContain("ann");
    expect(entry.owner).toBeNull();
  });

  it("ignores unknown households silently", async () => {
    await expect(
      fake.rpc("run_weekly_check", { p_household_id: 999 }),
    ).resolves.toEqual({ data: null, error: null });
  });
});

describe("run_weekly_check pruning", () => {
  it("deletes only old completed tasks, keeps two weeks plus open work", async () => {
    fake = new FakeClient(scoringDb());
    await fake.rpc("run_weekly_check", { p_household_id: 1 });
    const ids = fake.tables.tasks.map((t) => t.id).sort((a, b) => a - b);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
    expect(ids).toEqual(expect.arrayContaining([3, 4, 5, 6, 7]));
    // Cutoff sanity: nothing newer than last week's Monday is gone.
    const cutoff = mondayOf(new Date(Date.now() - 7 * DAY)).getTime();
    for (const t of fake.tables.tasks) {
      if (t.status === "completed" && t.completed_at) {
        expect(new Date(t.completed_at).getTime()).toBeGreaterThanOrEqual(cutoff);
      }
    }
  });
});

describe("run_weekly_check scheduling", () => {
  it("advances exactly 7 days keeping Sunday and time", async () => {
    fake = new FakeClient(scoringDb());
    const before = new Date(
      fake.tables.households.find((h) => h.id === 1)!.check_at,
    ).getTime();
    await fake.rpc("run_weekly_check", { p_household_id: 1 });
    const after = new Date(
      fake.tables.households.find((h) => h.id === 1)!.check_at,
    ).getTime();
    expect(new Date(after).getUTCDay()).toBe(0);
    expect(after - before).toBe(7 * DAY);
    expect(after).toBeGreaterThan(Date.now());
  });

  it("catches up overdue slots without rapid-fire repeats", async () => {
    fake = new FakeClient(scoringDb());
    const home = fake.tables.households.find((h) => h.id === 1)!;
    const overdue = new Date(upcomingSunday(20, 0).getTime() - 21 * DAY);
    home.check_at = overdue.toISOString();
    await fake.rpc("run_weekly_check", { p_household_id: 1 });
    const after = new Date(
      fake.tables.households.find((h) => h.id === 1)!.check_at,
    ).getTime();
    expect(new Date(after).getUTCDay()).toBe(0);
    expect(after).toBeGreaterThan(Date.now());
    expect((after - overdue.getTime()) % (7 * DAY)).toBe(0);
  });

  it("defaults a missing slot to upcoming Sunday 20:00", async () => {
    fake = new FakeClient(scoringDb());
    fake.tables.households.find((h) => h.id === 1)!.check_at = null;
    await fake.rpc("run_weekly_check", { p_household_id: 1 });
    const after = new Date(
      fake.tables.households.find((h) => h.id === 1)!.check_at,
    );
    expect(after.getUTCDay()).toBe(0);
    expect(after.getUTCHours()).toBe(20);
    expect(after.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("run_due_checks", () => {
  it("processes only due households", async () => {
    fake = new FakeClient(scoringDb());
    const homes = fake.tables.households;
    homes.push({
      id: 2,
      name: "Future",
      invite_code: "FUTURE000002",
      created_by: "u-ann",
      created_at: new Date().toISOString(),
      check_at: new Date(Date.now() + 3 * DAY).toISOString(),
    });
    for (const pid of ["u-ann", "u-ben"]) {
      fake.tables.household_members.push({
        household_id: 2,
        profile_id: pid,
        role: "member",
        joined_at: new Date().toISOString(),
      });
    }
    homes.find((h) => h.id === 1)!.check_at = new Date(
      Date.now() - 60_000,
    ).toISOString();
    const futureBefore = homes.find((h) => h.id === 2)!.check_at;
    await fake.rpc("run_due_checks", {});
    // Due household advanced a full week out...
    expect(
      new Date(homes.find((h) => h.id === 1)!.check_at).getTime(),
    ).toBeGreaterThan(Date.now());
    // ...future household byte-identical.
    expect(homes.find((h) => h.id === 2)!.check_at).toBe(futureBefore);
    const ann = fake.tables.profiles.find((p) => p.id === "u-ann")!;
    expect(ann.gems).toBe(1);
  });
});
