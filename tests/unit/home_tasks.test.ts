// Home board helpers: shared task validation plus id guards on the
// task RPC mutations. Uses the existing fake double for call counting
// only - invalid ids must fail before any backend call.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approvalProgress,
  claimTask,
  completeTask,
  confirmTask,
  deleteTask,
  rejectTask,
  validateTaskInput,
} from "../../src/system/db";
import type { Task, TaskVote } from "../../src/system/obj_types";
import { Lengths, PointsBands } from "../../src/global/constants";
import { BOB } from "../fake/seed";
import { FakeClient, emptyDb } from "../fake/fake_supabase";

let fake: FakeClient;
let client: SupabaseClient;

beforeEach(() => {
  fake = new FakeClient(emptyDb());
  client = fake as unknown as SupabaseClient;
  fake.signInAs(BOB.id);
});

describe("validateTaskInput", () => {
  it("accepts every band edge", () => {
    expect(
      validateTaskInput({ title: "Dishes", difficulty: "easy", points: PointsBands.easy.min }),
    ).toBeNull();
    expect(
      validateTaskInput({ title: "Dishes", difficulty: "easy", points: PointsBands.easy.max }),
    ).toBeNull();
    expect(
      validateTaskInput({ title: "Vacuum", difficulty: "medium", points: 230 }),
    ).toBeNull();
    expect(
      validateTaskInput({ title: "Deep clean", difficulty: "hard", points: PointsBands.hard.max }),
    ).toBeNull();
  });

  it("rejects blank titles before anything else", () => {
    expect(
      validateTaskInput({ title: "   ", difficulty: "easy", points: 100 }),
    ).toBe("Type a task title.");
  });

  it("caps titles at Lengths.TASK_TITLE", () => {
    expect(
      validateTaskInput({ title: "x".repeat(Lengths.TASK_TITLE), difficulty: "easy", points: 100 }),
    ).toBeNull();
    expect(
      validateTaskInput({ title: "x".repeat(Lengths.TASK_TITLE + 1), difficulty: "easy", points: 100 }),
    ).toBe(`Keep titles under ${Lengths.TASK_TITLE} characters.`);
  });

  it("rejects unknown difficulties", () => {
    expect(
      validateTaskInput({ title: "Dishes", difficulty: "extreme" as any, points: 100 }),
    ).toBe("Pick a valid difficulty.");
  });

  it("rejects out-of-band points with the friendly band message", () => {
    expect(
      validateTaskInput({ title: "Dishes", difficulty: "easy", points: 99 }),
    ).toBe(`easy tasks pay ${PointsBands.easy.min}-${PointsBands.easy.max} points.`);
    expect(
      validateTaskInput({ title: "Dishes", difficulty: "easy", points: 131 }),
    ).toContain("easy tasks pay");
    expect(
      validateTaskInput({ title: "Dishes", difficulty: "medium", points: 199 }),
    ).toContain("medium tasks pay");
    expect(
      validateTaskInput({ title: "Dishes", difficulty: "hard", points: 401 }),
    ).toContain("hard tasks pay");
  });

  it("rejects non-integer and missing points", () => {
    expect(
      validateTaskInput({ title: "Dishes", difficulty: "easy", points: 100.5 }),
    ).toContain("easy tasks pay");
    expect(
      validateTaskInput({ title: "Dishes", difficulty: "easy", points: Number.NaN }),
    ).toContain("easy tasks pay");
  });
});

describe("task mutation id guards", () => {
  it.each([0, -3, Number.NaN, 1.5])(
    "claimTask(%s) throws before any rpc",
    async (badId) => {
      fake.resetCalls();
      await expect(claimTask(client, badId)).rejects.toThrow("Pick a task first.");
      expect(fake.calls.rpc).toBe(0);
    },
  );

  it.each([0, -1, Number.NaN])(
    "completeTask(%s) throws before any rpc",
    async (badId) => {
      fake.resetCalls();
      await expect(completeTask(client, badId)).rejects.toThrow("Pick a task first.");
      expect(fake.calls.rpc).toBe(0);
    },
  );

  it.each([0, -1, Number.NaN])(
    "deleteTask(%s) throws before any backend call",
    async (badId) => {
      fake.resetCalls();
      await expect(deleteTask(client, badId)).rejects.toThrow("Pick a task first.");
      expect(fake.calls.rpc).toBe(0);
      expect(fake.calls.select).toBe(0);
      expect(fake.calls.delete).toBe(0);
    },
  );

  it("deleteTask removes the row and proves it with the row count", async () => {
    fake.tables.tasks.push({ id: 11, household_id: 1, title: "Gone" });
    fake.resetCalls();
    await expect(deleteTask(client, 11)).resolves.toBeUndefined();
    expect(fake.calls.delete).toBe(1);
    expect(fake.tables.tasks.find((t: any) => t.id === 11)).toBeUndefined();
  });

  it("deleteTask throws a friendly error when nothing was deleted", async () => {
    fake.resetCalls();
    await expect(deleteTask(client, 4242)).rejects.toThrow(
      "Only household members can delete unclaimed tasks.",
    );
  });
});

describe("review vote id guards", () => {
  it.each([0, -1, Number.NaN, 1.5])(
    "confirmTask(%s) throws before any rpc",
    async (badId) => {
      fake.resetCalls();
      await expect(confirmTask(client, badId)).rejects.toThrow("Pick a task first.");
      expect(fake.calls.rpc).toBe(0);
    },
  );

  it.each([0, -1, Number.NaN, 1.5])(
    "rejectTask(%s) throws before any rpc",
    async (badId) => {
      fake.resetCalls();
      await expect(rejectTask(client, badId)).rejects.toThrow("Pick a task first.");
      expect(fake.calls.rpc).toBe(0);
    },
  );
});

describe("approvalProgress", () => {
  const reviewTask = {
    id: 9,
    household_id: 1,
    title: "Dishes",
    owner: "user-ana",
    status: "in_review",
  } as Task;

  function vote(profile_id: string): TaskVote {
    return { task_id: 9, profile_id, household_id: 1, created_at: "2026-09-01T00:00:00Z" };
  }

  it("needs every member except the holder", () => {
    expect(approvalProgress([], reviewTask, 3)).toEqual({ confirmed: 0, needed: 2 });
    expect(
      approvalProgress([vote("user-bob")], reviewTask, 3),
    ).toEqual({ confirmed: 1, needed: 2 });
  });

  it("dedupes double votes and caps at needed", () => {
    const votes = [vote("user-bob"), vote("user-bob"), vote("user-cid")];
    expect(approvalProgress(votes, reviewTask, 3)).toEqual({ confirmed: 2, needed: 2 });
  });

  it("ignores votes on other tasks", () => {
    const other = { ...vote("user-bob"), task_id: 10 };
    expect(approvalProgress([other], reviewTask, 2)).toEqual({ confirmed: 0, needed: 1 });
  });

  it("needs nobody when the holder is the only member", () => {
    expect(approvalProgress([], reviewTask, 1)).toEqual({ confirmed: 0, needed: 0 });
  });
});
