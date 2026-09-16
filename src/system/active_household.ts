import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MyHousehold } from "./obj_types";

// Remembered across restarts so the app opens on the same household.
// The stored id is a hint only: callers must pass the current list so
// a stale or foreign id can never become active.
const ACTIVE_KEY = "housearena.active_household";

export async function resolveActiveId(
  homes: MyHousehold[],
): Promise<number | null> {
  const saved = await AsyncStorage.getItem(ACTIVE_KEY).catch(() => null);
  const savedId = saved ? Number(saved) : NaN;
  const next = homes.some((h) => h.household.id === savedId)
    ? savedId
    : homes.length > 0
      ? homes[0].household.id
      : null;
  await saveActiveId(next);
  return next;
}

export async function saveActiveId(id: number | null): Promise<void> {
  if (id != null)
    await AsyncStorage.setItem(ACTIVE_KEY, String(id)).catch(() => {});
  else await AsyncStorage.removeItem(ACTIVE_KEY).catch(() => {});
}
