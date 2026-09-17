// Task editing: shared edit validation, id guards on updateTask, and
// the favourite snapshot refresh after an edit. Uses the existing fake
// double for call counting only.
import type { SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { unclaimTask, updateTask, validateTaskEdit } from "../../src/system/db";
import { Lengths } from "../../src/global/constants";
import {
  toggleFavourite,
  updateFavouriteSnapshot,
} from "../../src/system/favourites";
import type { Task } from "../../src/system/obj_types";
import { BOB } from "../fake/seed";
import { FakeClient, emptyDb } from "../fake/fake_supabase";

let fake: FakeClient;
let client: SupabaseClient;

beforeEach(() => {
  fake = new FakeClient(emptyDb());
  client = fake as unknown as SupabaseClient;
  fake.signInAs(BOB.id);
  return AsyncStorage.clear();
});

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 3,
    household_id: 7,
    title: "Dishes",
    description: "Wash **everything**.",
    difficulty: "easy",
    points: 100,
    status: "free",
    owner: null,
    created_by: BOB.id,
    created_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  } as Task;
}

describe("validateTaskEdit", () => {
  it("accepts a normal title", () => {
    expect(validateTaskEdit({ title: "Dishes" })).toBeNull();
  });

  it("rejects blank titles", () => {
    expect(validateTaskEdit({ title: "   " })).toBe("Type a task title.");
  });

  it("caps titles at Lengths.TASK_TITLE", () => {
    expect(validateTaskEdit({ title: "x".repeat(Lengths.TASK_TITLE) })).toBeNull();
    expect(validateTaskEdit({ title: "x".repeat(Lengths.TASK_TITLE + 1) })).toBe(
      `Keep titles under ${Lengths.TASK_TITLE} characters.`,
    );
  });
});

describe("updateTask guards", () => {
  it.each([0, -1, Number.NaN, 1.5])(
    "updateTask(%s) throws before any backend call",
    async (badId) => {
      fake.resetCalls();
      await expect(
        updateTask(client, badId, { title: "Dishes" }),
      ).rejects.toThrow("Pick a task first.");
      expect(fake.calls.rpc).toBe(0);
      expect(fake.calls.update).toBe(0);
    },
  );

  it("rejects a blank title before any backend call", async () => {
    fake.resetCalls();
    await expect(updateTask(client, 3, { title: "  " })).rejects.toThrow(
      "Type a task title.",
    );
    expect(fake.calls.rpc).toBe(0);
    expect(fake.calls.update).toBe(0);
  });

  it("updates title and description through a direct update", async () => {
    fake.tables.tasks.push({ ...makeTask(), title: "Old", description: "old body" });
    fake.resetCalls();
    const saved = await updateTask(client, 3, {
      title: "  New title  ",
      description: "new body",
    });
    expect(saved.title).toBe("New title");
    expect(saved.description).toBe("new body");
    expect(fake.calls.update).toBe(1);
    expect(fake.calls.rpc).toBe(0);
  });

  it("throws a friendly error when no row comes back (policy refused)", async () => {
    fake.resetCalls();
    await expect(updateTask(client, 4242, { title: "Dishes" })).rejects.toThrow(
      "Only household members can edit open tasks.",
    );
  });
});

describe("unclaimTask", () => {
  it.each([0, -1, Number.NaN, 1.5])(
    "unclaimTask(%s) throws before any backend call",
    async (badId) => {
      fake.resetCalls();
      await expect(unclaimTask(client, badId)).rejects.toThrow("Pick a task first.");
      expect(fake.calls.rpc).toBe(0);
      expect(fake.calls.update).toBe(0);
    },
  );

  it("releases a taken card back to free with no owner", async () => {
    fake.tables.tasks.push(makeTask({ id: 9, status: "taken", owner: BOB.id }));
    fake.resetCalls();
    const saved = await unclaimTask(client, 9);
    expect(saved.status).toBe("free");
    expect(saved.owner).toBeNull();
    expect(fake.calls.update).toBe(1);
    expect(fake.calls.rpc).toBe(0);
  });

  it("throws a friendly error when no row comes back", async () => {
    fake.resetCalls();
    await expect(unclaimTask(client, 4242)).rejects.toThrow(
      "Only the holder can unclaim a taken card.",
    );
  });
});

describe("updateFavouriteSnapshot", () => {
  it("rewrites only the snapshot copy, board row untouched", async () => {
    await toggleFavourite(BOB.id, makeTask());
    const list = await updateFavouriteSnapshot(BOB.id, 3, {
      title: "Dishes (edited)",
      description: "edited body",
    });
    expect(list).toHaveLength(1);
    expect(list[0].task.title).toBe("Dishes (edited)");
    expect(list[0].task.description).toBe("edited body");
    // Points and id ride along unchanged, timestamp kept.
    expect(list[0].task.points).toBe(100);
    expect(list[0].favouritedAt).toBeTruthy();
    // No board table exists in this store: nothing else could change,
    // and the board path was never touched.
    expect(fake.calls.update).toBe(0);
    expect(fake.calls.rpc).toBe(0);
  });

  it("rejects blank and overlong titles", async () => {
    await toggleFavourite(BOB.id, makeTask());
    await expect(
      updateFavouriteSnapshot(BOB.id, 3, { title: "  ", description: "x" }),
    ).rejects.toThrow("Type a task title.");
    await expect(
      updateFavouriteSnapshot(BOB.id, 3, { title: "x".repeat(61), description: "x" }),
    ).rejects.toThrow("Keep titles under 60 characters.");
  });

  it("rejects an edit that duplicates another favourite", async () => {
    await toggleFavourite(BOB.id, makeTask({ id: 3, title: "Dishes", description: "Wash" }));
    await toggleFavourite(BOB.id, makeTask({ id: 4, title: "Vacuum", description: "Suck" }));
    await expect(
      updateFavouriteSnapshot(BOB.id, 4, { title: "dishes", description: "Wash" }),
    ).rejects.toThrow("Already saved");
  });

  it("throws when the favourite is gone", async () => {
    await expect(
      updateFavouriteSnapshot(BOB.id, 999, { title: "Dishes", description: "x" }),
    ).rejects.toThrow("That favourite is gone.");
  });
});
