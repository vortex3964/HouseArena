import AsyncStorage from "@react-native-async-storage/async-storage";
import { Messages } from "../../src/global/constants";
import type { Task } from "../../src/system/obj_types";
import {
  MAX_FAVOURITES,
  getFavouriteIds,
  getFavourites,
  removeFavourite,
  starTask,
  toggleFavourite,
} from "../../src/system/favourites";

function task(id: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    description: `Do task ${id}`,
    difficulty: "easy",
    points: 100 + id,
    status: "free",
    household_id: 1,
    owner: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
    ...extra,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("toggleFavourite", () => {
  it("stars and unstars a card", async () => {
    const first = await toggleFavourite("user-1", task(7));
    expect(first.favourited).toBe(true);
    expect(first.ids).toEqual(new Set([7]));
    const second = await toggleFavourite("user-1", task(7));
    expect(second.favourited).toBe(false);
    expect(second.ids).toEqual(new Set());
  });

  it("snapshots the card exactly as it was", async () => {
    const t = task(3, { points: 120, status: "taken" });
    await toggleFavourite("user-1", t);
    t.points = 999;
    t.status = "completed";
    const [entry] = await getFavourites("user-1");
    expect(entry.task.points).toBe(120);
    expect(entry.task.status).toBe("taken");
    expect(typeof entry.favouritedAt).toBe("string");
  });

  it("caps at 15 per user with a friendly error", async () => {
    for (let id = 1; id <= MAX_FAVOURITES; id++) {
      await toggleFavourite("user-1", task(id));
    }
    await expect(toggleFavourite("user-1", task(999))).rejects.toThrow(
      Messages.FAVOURITES_FULL,
    );
    expect((await getFavouriteIds("user-1")).size).toBe(MAX_FAVOURITES);
  });

  it("re-starring a known card toggles off even at cap", async () => {
    for (let id = 1; id <= MAX_FAVOURITES; id++) {
      await toggleFavourite("user-1", task(id));
    }
    const res = await toggleFavourite("user-1", task(1));
    expect(res.favourited).toBe(false);
    expect(res.ids.size).toBe(MAX_FAVOURITES - 1);
  });

  it("isolates users from each other", async () => {
    await toggleFavourite("user-1", task(1));
    expect(await getFavouriteIds("user-2")).toEqual(new Set());
  });

  it("rejects a different card with the same title and body", async () => {
    await toggleFavourite("user-1", task(1, { title: "Dishes", description: "Wash all" }));
    await expect(
      toggleFavourite("user-1", task(2, { title: "Dishes", description: "Wash all" })),
    ).rejects.toThrow(Messages.FAVOURITES_DUPLICATE);
    expect((await getFavouriteIds("user-1")).size).toBe(1);
  });

  it("treats title case and surrounding whitespace as the same card", async () => {
    await toggleFavourite("user-1", task(1, { title: "Dishes", description: "Wash all" }));
    await expect(
      toggleFavourite("user-1", task(2, { title: "  DISHES ", description: "Wash all" })),
    ).rejects.toThrow(Messages.FAVOURITES_DUPLICATE);
  });

  it("allows the same title with a different body", async () => {
    await toggleFavourite("user-1", task(1, { title: "Dishes", description: "Wash all" }));
    const res = await toggleFavourite(
      "user-1",
      task(2, { title: "Dishes", description: "Dry all" }),
    );
    expect(res.favourited).toBe(true);
    expect(res.ids).toEqual(new Set([1, 2]));
  });

  it("resets corrupt data instead of crashing", async () => {
    await AsyncStorage.setItem("housearena.favourites:user-1", "{nope");
    expect(await getFavouriteIds("user-1")).toEqual(new Set());
    // And recovers on next write.
    const res = await toggleFavourite("user-1", task(1));
    expect(res.favourited).toBe(true);
  });
});

describe("starTask", () => {
  it("saves a new card and returns the id set", async () => {
    const ids = await starTask("user-1", task(1));
    expect(ids).toEqual(new Set([1]));
  });

  it("re-starring refreshes the snapshot instead of failing or duplicating", async () => {
    await starTask("user-1", task(1, { title: "Dishes", description: "Wash" }));
    const before = await getFavourites("user-1");
    // Board version changed body since: re-star must succeed and store
    // the current content under the same single entry.
    const ids = await starTask("user-1", task(1, { title: "Dishes", description: "Wash + dry" }));
    expect(ids).toEqual(new Set([1]));
    const after = await getFavourites("user-1");
    expect(after).toHaveLength(1);
    expect(after[0].task.description).toBe("Wash + dry");
    expect(after[0].favouritedAt).toBe(before[0].favouritedAt);
  });

  it("still enforces cap and no-dupes on brand-new saves", async () => {
    for (let id = 1; id <= MAX_FAVOURITES; id++) {
      await starTask("user-1", task(id));
    }
    await expect(starTask("user-1", task(999))).rejects.toThrow(
      Messages.FAVOURITES_FULL,
    );
  });

  it("rejects a new save duplicating another entry", async () => {
    await starTask("user-1", task(1, { title: "Dishes", description: "Wash" }));
    await expect(
      starTask("user-1", task(2, { title: "dishes", description: "Wash" })),
    ).rejects.toThrow(Messages.FAVOURITES_DUPLICATE);
  });
});

describe("removeFavourite", () => {
  it("drops the entry and no-ops when absent", async () => {
    await toggleFavourite("user-1", task(1));
    await toggleFavourite("user-1", task(2));
    await removeFavourite("user-1", 1);
    expect(await getFavouriteIds("user-1")).toEqual(new Set([2]));
    await expect(removeFavourite("user-1", 999)).resolves.toBeUndefined();
    expect(await getFavouriteIds("user-1")).toEqual(new Set([2]));
  });
});
