import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import {
  cancelTaskReminder,
  getReminders,
  scheduleTaskReminder,
} from "../../src/system/reminders";

const N = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
  cancelScheduledNotificationAsync: jest.Mock;
};

const card = { id: 7, title: "Dishes", description: "All of them" };
const future = () => new Date(Date.now() + 60 * 60 * 1000);

beforeEach(async () => {
  await AsyncStorage.clear();
  // clearAllMocks wipes implementations too, so re-arm after it.
  jest.clearAllMocks();
  N.getPermissionsAsync.mockResolvedValue({ status: "granted" });
  N.requestPermissionsAsync.mockResolvedValue({ status: "granted" });
  N.scheduleNotificationAsync.mockResolvedValue("notif-id-1");
  N.cancelScheduledNotificationAsync.mockResolvedValue(undefined);
});

describe("scheduleTaskReminder", () => {
  it("schedules title + description and persists the entry", async () => {
    const entry = await scheduleTaskReminder("user-1", card, future());
    expect(entry.notificationId).toBe("notif-id-1");
    expect(entry.title).toBe("Dishes");
    expect(N.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const [arg] = N.scheduleNotificationAsync.mock.calls[0];
    expect(arg.content.title).toBe("Reminder for task: Dishes");
    expect(arg.content.body).toBe("All of them");
    expect(arg.trigger.type).toBe("date");
    expect(arg.trigger.date instanceof Date).toBe(true);
    expect(await getReminders("user-1")).toEqual({
      7: expect.objectContaining({ notificationId: "notif-id-1" }),
    });
  });

  it("falls back body text when the task has no description", async () => {
    await scheduleTaskReminder("user-1", { id: 8, title: "Vacuum", description: "  " }, future());
    const [arg] = N.scheduleNotificationAsync.mock.calls[0];
    expect(arg.content.body).toBe("Time to do this task.");
  });

  it("rejects past dates without touching notifications", async () => {
    await expect(
      scheduleTaskReminder("user-1", card, new Date(Date.now() - 1000)),
    ).rejects.toThrow("Pick a future time");
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("throws when permission is denied", async () => {
    N.getPermissionsAsync.mockResolvedValue({ status: "denied" });
    N.requestPermissionsAsync.mockResolvedValue({ status: "denied" });
    await expect(scheduleTaskReminder("user-1", card, future())).rejects.toThrow(
      "Allow notifications",
    );
    expect(N.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("replaces a previous reminder for the same card", async () => {
    await scheduleTaskReminder("user-1", card, future());
    N.scheduleNotificationAsync.mockResolvedValue("notif-id-2");
    await scheduleTaskReminder("user-1", card, future());
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith("notif-id-1");
    expect(Object.keys(await getReminders("user-1"))).toEqual(["7"]);
  });

  it("isolates users and survives corrupt data", async () => {
    await scheduleTaskReminder("user-1", card, future());
    expect(await getReminders("user-2")).toEqual({});
    await AsyncStorage.setItem("housearena.reminders:user-2", "{nope");
    expect(await getReminders("user-2")).toEqual({});
  });
});

describe("cancelTaskReminder", () => {
  it("cancels the OS notification and drops the entry", async () => {
    await scheduleTaskReminder("user-1", card, future());
    await cancelTaskReminder("user-1", 7);
    expect(N.cancelScheduledNotificationAsync).toHaveBeenCalledWith("notif-id-1");
    expect(await getReminders("user-1")).toEqual({});
  });

  it("no-ops on unknown ids", async () => {
    await expect(cancelTaskReminder("user-1", 999)).resolves.toBeUndefined();
    expect(N.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });
});
