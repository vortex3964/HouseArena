import AsyncStorage from "@react-native-async-storage/async-storage";
import { Lengths, Messages } from "../global/constants";
import type { Task } from "./obj_types";

// Per-user favourite tasks, stored as snapshots: exactly the card as it
// looked (toggles, points, everything) at the moment of starring.
// Cap is 15 per user; corrupt data resets to empty, never crashes.
export const MAX_FAVOURITES = 15;

export type FavouriteEntry = {
  task: Task;
  favouritedAt: string;
};

function keyFor(userId: string): string {
  return `housearena.favourites:${userId}`;
}

// Identity of a card for duplicate detection: normalized title + body.
// Two tasks with the same title and description count as the same
// favourite, even if their ids differ.
function duplicateKey(task: Task): string {
  const title = task.title.trim().toLowerCase();
  const body = (task.description ?? "").trim();
  return `${title}\n${body}`;
}

async function loadRaw(userId: string): Promise<FavouriteEntry[]> {
  const raw = await AsyncStorage.getItem(keyFor(userId)).catch(() => null);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is FavouriteEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as FavouriteEntry).task === "object" &&
        (e as FavouriteEntry).task !== null &&
        typeof (e as FavouriteEntry).task.id === "number",
    );
  } catch {
    return [];
  }
}

async function saveRaw(userId: string, entries: FavouriteEntry[]): Promise<void> {
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(entries)).catch(() => {});
}

export async function getFavouriteIds(userId: string): Promise<Set<number>> {
  const entries = await loadRaw(userId);
  return new Set(entries.map((e) => e.task.id));
}

export async function getFavourites(userId: string): Promise<FavouriteEntry[]> {
  return loadRaw(userId);
}

// Saves a board card as a favourite, or refreshes the saved snapshot
// when it is already starred (same id, current board content wins).
// Cap and no-dupes apply to brand-new saves only; re-snapshotting its
// own entry can never dupe. One entry per task id, always. Returns the
// fresh id set.
export async function starTask(userId: string, task: Task): Promise<Set<number>> {
  const entries = await loadRaw(userId);
  const at = entries.findIndex((e) => e.task.id === task.id);
  const clone = JSON.parse(JSON.stringify(task)) as Task;
  if (at >= 0) {
    entries[at] = { task: clone, favouritedAt: entries[at].favouritedAt };
  } else {
    if (entries.length >= MAX_FAVOURITES) {
      throw new Error(Messages.FAVOURITES_FULL);
    }
    const key = duplicateKey(task);
    if (entries.some((e) => duplicateKey(e.task) === key)) {
      throw new Error(Messages.FAVOURITES_DUPLICATE);
    }
    entries.push({ task: clone, favouritedAt: new Date().toISOString() });
  }
  await saveRaw(userId, entries);
  return new Set(entries.map((e) => e.task.id));
}

// Toggles one card: removes the entry when starred, otherwise saves it
// through starTask (same cap and no-dupes rules).
export async function toggleFavourite(
  userId: string,
  task: Task,
): Promise<{ favourited: boolean; ids: Set<number> }> {
  const entries = await loadRaw(userId);
  const at = entries.findIndex((e) => e.task.id === task.id);
  if (at >= 0) {
    entries.splice(at, 1);
    await saveRaw(userId, entries);
    return { favourited: false, ids: new Set(entries.map((e) => e.task.id)) };
  }
  const ids = await starTask(userId, task);
  return { favourited: true, ids };
}

// Drops one entry without toggling (e.g. its task was deleted).
export async function removeFavourite(userId: string, taskId: number): Promise<void> {
  const entries = await loadRaw(userId);
  const kept = entries.filter((e) => e.task.id !== taskId);
  if (kept.length !== entries.length) await saveRaw(userId, kept);
}

// Edits a stored snapshot in place (title/body only). The board row is
// untouched: snapshots are frozen copies. Validates like a board edit
// and throws FAVOURITES_DUPLICATE when another entry already has the
// same title and body, so the no-dupes invariant survives edits.
export async function updateFavouriteSnapshot(
  userId: string,
  taskId: number,
  input: { title: string; description: string },
): Promise<FavouriteEntry[]> {
  const title = input.title.trim();
  if (!title) throw new Error("Type a task title.");
  if (title.length > Lengths.TASK_TITLE)
    throw new Error(`Keep titles under ${Lengths.TASK_TITLE} characters.`);
  const description = input.description.trim();
  const entries = await loadRaw(userId);
  const at = entries.findIndex((e) => e.task.id === taskId);
  if (at < 0) throw new Error("That favourite is gone.");
  const key = `${title.toLowerCase()}\n${description}`;
  if (entries.some((e, i) => i !== at && duplicateKey(e.task) === key)) {
    throw new Error(Messages.FAVOURITES_DUPLICATE);
  }
  entries[at] = {
    favouritedAt: entries[at].favouritedAt,
    task: { ...entries[at].task, title, description: description || null },
  };
  await saveRaw(userId, entries);
  return entries;
}
