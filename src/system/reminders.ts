import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { Messages } from "../global/constants";
import { getNotifications } from "./push";
import type { Task } from "./obj_types";

// Per-user task reminders, backed by OS-scheduled local notifications.
// Store shape: task id -> { notificationId, fireAt, title }.
export type ReminderEntry = {
  notificationId: string;
  fireAt: string;
  title: string;
};

function keyFor(userId: string): string {
  return `housearena.reminders:${userId}`;
}

async function loadRaw(userId: string): Promise<Record<number, ReminderEntry>> {
  const raw = await AsyncStorage.getItem(keyFor(userId)).catch(() => null);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<number, ReminderEntry> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const id = Number(k);
      const e = v as Partial<ReminderEntry>;
      if (
        Number.isInteger(id) &&
        typeof e === "object" &&
        e !== null &&
        typeof e.notificationId === "string" &&
        typeof e.fireAt === "string" &&
        typeof e.title === "string"
      ) {
        out[id] = { notificationId: e.notificationId, fireAt: e.fireAt, title: e.title };
      }
    }
    return out;
  } catch {
    return {};
  }
}

async function saveRaw(
  userId: string,
  entries: Record<number, ReminderEntry>,
): Promise<void> {
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify(entries)).catch(() => {});
}

export async function getReminders(
  userId: string,
): Promise<Record<number, ReminderEntry>> {
  return loadRaw(userId);
}

// Schedules "Reminder for task: <title>" with the description as body.
// Throws friendly errors for past dates and unavailable notifications.
export async function scheduleTaskReminder(
  userId: string,
  task: Pick<Task, "id" | "title" | "description">,
  fireAt: Date,
): Promise<ReminderEntry> {
  if (Platform.OS === "web") throw new Error(Messages.REMINDER_NEEDS_BUILD);
  if (fireAt.getTime() <= Date.now()) throw new Error(Messages.REMINDER_FUTURE_ONLY);
  const N = getNotifications();
  if (!N) throw new Error(Messages.REMINDER_NEEDS_BUILD);
  const { status: existing } = await N.getPermissionsAsync();
  const { status } =
    existing === "granted" ? { status: existing } : await N.requestPermissionsAsync();
  if (status !== "granted") throw new Error("Allow notifications to set reminders.");

  const entries = await loadRaw(userId);
  const prev = entries[task.id];
  if (prev) {
    await N.cancelScheduledNotificationAsync(prev.notificationId).catch(() => {});
  }
  const notificationId = await N.scheduleNotificationAsync({
    content: {
      title: `Reminder for task: ${task.title}`,
      body: task.description?.trim() ? task.description : "Time to do this task.",
    },
    trigger: {
      type: N.SchedulableTriggerInputTypes.DATE,
      date: fireAt,
    },
  });
  const entry: ReminderEntry = {
    notificationId,
    fireAt: fireAt.toISOString(),
    title: task.title,
  };
  entries[task.id] = entry;
  await saveRaw(userId, entries);
  return entry;
}

// Cancels one reminder (toggle off). Missing entries are a no-op.
export async function cancelTaskReminder(userId: string, taskId: number): Promise<void> {
  const entries = await loadRaw(userId);
  const prev = entries[taskId];
  if (!prev) return;
  const N = getNotifications();
  if (N) {
    await N.cancelScheduledNotificationAsync(prev.notificationId).catch(() => {});
  }
  delete entries[taskId];
  await saveRaw(userId, entries);
}
