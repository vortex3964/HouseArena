import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addLog,
  createHousehold,
  fetchHouseholdLogs,
  fetchHouseholdMembers,
  fetchHouseholdTasks,
  fetchMyHouseholds,
  fetchMyProfile,
  joinHouseholdByCode,
  leaveHousehold,
  signInWithEmail,
  signUpWithEmail,
  submitForReview,
} from "../../src/system/db";
import { ANA, BOB, CHARLIE, createSeed } from "../fake/seed";
import { FakeClient } from "../fake/fake_supabase";

let fake: FakeClient;
let client: SupabaseClient;

beforeEach(() => {
  fake = new FakeClient(createSeed());
  client = fake as unknown as SupabaseClient;
});

describe("signUpWithEmail", () => {
  it("creates auth user, profile, and session", async () => {
    const data = await signUpWithEmail(client, "dave@mail.com", "dave", "secret99");
    expect(data.session?.user.id).toBeTruthy();
    expect(fake.tables.profiles.find((p) => p.username === "dave")).toMatchObject({
      email: "dave@mail.com",
      points: 0,
    });
  });

  it("validates before touching the backend", async () => {
    await expect(signUpWithEmail(client, "bad", "dave", "secret99")).rejects.toThrow();
    await expect(signUpWithEmail(client, "d@mail.com", "dave", "short")).rejects.toThrow();
    expect(fake.calls.auth.signUp ?? 0).toBe(0);
  });

  it("maps duplicate emails to the friendly taken message", async () => {
    await expect(signUpWithEmail(client, ANA.email, "someone", "secret99")).rejects.toThrow(
      "That email is taken",
    );
  });

  it("allows a duplicate display name for a new email", async () => {
    const data = await signUpWithEmail(client, "new@mail.com", "ana", "secret99");
    const created = fake.tables.profiles.find((p) => p.id === data.session!.user.id)!;
    expect(created.username).toBe("ana");
  });
});

describe("signInWithEmail", () => {
  it("signs in with email + password and returns uid, no rpc", async () => {
    fake.resetCalls();
    const uid = await signInWithEmail(client, ANA.email, "secret12");
    expect(uid).toBe(ANA.id);
    expect(fake.calls.rpc).toBe(0);
    expect(fake.calls.select).toBe(0);
  });

  it("reports unknown users and wrong passwords generically", async () => {
    await expect(signInWithEmail(client, "nobody@mail.com", "whatever1")).rejects.toThrow(
      "No account matches that email + password.",
    );
    await expect(signInWithEmail(client, ANA.email, "wrongpass")).rejects.toThrow(
      "No account matches that email + password.",
    );
  });

  it("validates before any backend call", async () => {
    fake.resetCalls();
    await expect(signInWithEmail(client, "bad", "secret12")).rejects.toThrow();
    await expect(signInWithEmail(client, ANA.email, "")).rejects.toThrow("Type your password.");
    expect(fake.calls.rpc).toBe(0);
  });
});

describe("fetchMyProfile", () => {
  it("returns the row, null for strangers", async () => {
    await expect(fetchMyProfile(client, ANA.id)).resolves.toMatchObject({
      username: "ana",
      points: 250,
      gems: 3,
    });
    await expect(fetchMyProfile(client, "user-ghost")).resolves.toBeNull();
  });
});

describe("fetchMyHouseholds", () => {
  it("returns memberships oldest first with nested households", async () => {
    const homes = await fetchMyHouseholds(client, ANA.id);
    expect(homes.map((h) => h.household.id)).toEqual([1, 2]);
    expect(homes[0]).toMatchObject({ role: "owner" });
    expect(homes[0].household).toMatchObject({ name: "Sunset Flat" });
    await expect(fetchMyHouseholds(client, "user-ghost")).resolves.toEqual([]);
  });
});

describe("household CRUD", () => {
  it("validates names locally before any rpc", async () => {
    fake.signInAs(CHARLIE.id);
    await expect(createHousehold(client, " ")).rejects.toThrow("too short");
    expect(fake.calls.rpc).toBe(0);
  });

  it("creates with caller as owner", async () => {
    fake.signInAs(CHARLIE.id);
    const home = await createHousehold(client, "Cabin Crew");
    expect(home.name).toBe("Cabin Crew");
    expect(home.invite_code).toHaveLength(12);
    expect(
      fake.tables.household_members.find(
        (m) => m.household_id === home.id && m.profile_id === CHARLIE.id,
      )?.role,
    ).toBe("owner");
  });

  it("joins case-insensitively, rejects bad codes, rejoins idempotently", async () => {
    fake.signInAs(CHARLIE.id);
    const home = await joinHouseholdByCode(client, "sunset000001");
    expect(home.id).toBe(1);
    await expect(joinHouseholdByCode(client, "NOPE00000000")).rejects.toThrow(
      "No household uses that code",
    );
    const before = fake.tables.household_members.length;
    await joinHouseholdByCode(client, "SUNSET000001");
    expect(fake.tables.household_members.length).toBe(before);
  });

  it("leave drops membership and frees the leaver's taken cards", async () => {
    fake.signInAs(BOB.id);
    await leaveHousehold(client, 1);
    expect(
      fake.tables.household_members.some(
        (m) => m.household_id === 1 && m.profile_id === BOB.id,
      ),
    ).toBe(false);
    expect(fake.tables.tasks.find((t) => t.id === 56)).toMatchObject({
      status: "free",
      owner: null,
    });
  });

  it("last member out deletes the household", async () => {
    fake.signInAs(BOB.id);
    await leaveHousehold(client, 1); // bob leaves, ana remains
    expect(fake.tables.households.some((h) => h.id === 1)).toBe(true);
    fake.signInAs(ANA.id);
    await leaveHousehold(client, 1); // ana leaves, empty now
    expect(fake.tables.households.some((h) => h.id === 1)).toBe(false);
    expect(fake.tables.tasks.some((t) => t.household_id === 1)).toBe(false);
  });
});

describe("board fetches", () => {
  it("pages tasks oldest-first, scoped to the household", async () => {
    const tasks = await fetchHouseholdTasks(client, 1);
    expect(tasks).toHaveLength(50);
    expect(tasks[0].id).toBe(1);
    expect(tasks.every((t) => t.household_id === 1)).toBe(true);
    for (let i = 1; i < tasks.length; i++) {
      expect(tasks[i].created_at >= tasks[i - 1].created_at).toBe(true);
    }
  });

  it("returns completed_at (stats bucketing depends on it)", async () => {
    fake.tables.tasks.push({
      id: 900,
      household_id: 1,
      title: "Done thing",
      description: null,
      difficulty: "easy",
      points: 100,
      status: "completed",
      owner: ANA.id,
      created_by: ANA.id,
      // Oldest date: the page limit is 50 over 55+ seed rows.
      created_at: "2026-01-01T00:00:05Z",
      completed_at: "2026-09-15T10:00:00Z",
    });
    const tasks = await fetchHouseholdTasks(client, 1);
    expect(tasks.find((t) => t.id === 900)?.completed_at).toBe("2026-09-15T10:00:00Z");
  });

  it("caps logs newest-first at 30", async () => {
    const logs = await fetchHouseholdLogs(client, 1);
    expect(logs).toHaveLength(30);
    expect(logs[0].id).toBe(35);
    for (let i = 1; i < logs.length; i++) {
      expect(logs[i].created_at <= logs[i - 1].created_at).toBe(true);
    }
  });

  it("embeds public member profiles without emails", async () => {
    const members = await fetchHouseholdMembers(client, 1);
    expect(members.map((m) => m.profile_id).sort()).toEqual([ANA.id, BOB.id].sort());
    expect(members[0]).toMatchObject({ role: "owner" });
    for (const m of members) {
      expect(m.profile).toBeDefined();
      expect(m.profile).not.toHaveProperty("email");
      expect(m.profile).toHaveProperty("username");
    }
  });
});

describe("addLog", () => {
  it("writes through the RPC with the caller stamped as owner", async () => {
    fake.signInAs(ANA.id);
    const entry = await addLog(client, 1, "  Ana did the dishes  ");
    expect(entry).toMatchObject({
      household_id: 1,
      owner: "ana",
      details: "Ana did the dishes",
    });
    expect(entry.id).toBeGreaterThan(0);
  });

  it("rejects empty text client-side without an rpc", async () => {
    fake.signInAs(ANA.id);
    fake.resetCalls();
    await expect(addLog(client, 1, "   ")).rejects.toThrow(
      "Type what happened first.",
    );
    expect(fake.calls.rpc).toBe(0);
  });

  it("trims over-long text to the server cap", async () => {
    fake.signInAs(BOB.id);
    const entry = await addLog(client, 1, "x".repeat(600));
    expect(entry.details).toHaveLength(500);
  });

  it("refuses writes from non-members", async () => {
    fake.signInAs(CHARLIE.id);
    await expect(addLog(client, 2, "Sneaky")).rejects.toThrow(
      "Not a member of this household",
    );
  });
});

describe("submitForReview", () => {
  it("moves the holder's taken task into review", async () => {
    fake.signInAs(BOB.id);
    const task = await submitForReview(client, 56);
    expect(task).toMatchObject({ id: 56, status: "in_review", owner: BOB.id });
  });

  it("rejects holders that do not own the task", async () => {
    fake.signInAs(ANA.id);
    await expect(submitForReview(client, 56)).rejects.toThrow(
      "not owned or not taken",
    );
  });

  it("rejects tasks that are not taken", async () => {
    fake.signInAs(ANA.id);
    await expect(submitForReview(client, 1)).rejects.toThrow(
      "not owned or not taken",
    );
  });

  it("rejects unknown tasks", async () => {
    fake.signInAs(ANA.id);
    await expect(submitForReview(client, 9999)).rejects.toThrow(
      "does not exist",
    );
  });
});
