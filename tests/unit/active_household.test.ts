import AsyncStorage from "@react-native-async-storage/async-storage";
import { resolveActiveId, saveActiveId } from "../../src/system/active_household";
import type { MyHousehold } from "../../src/system/obj_types";

const homes: MyHousehold[] = [
  {
    role: "owner",
    joined_at: "2026-01-01T00:00:01Z",
    household: {
      id: 1,
      name: "Sunset Flat",
      invite_code: "SUNSET000001",
      created_by: "user-ana",
      created_at: "2026-01-01T00:00:01Z",
      check_date: null,
    },
  },
  {
    role: "member",
    joined_at: "2026-01-01T00:00:02Z",
    household: {
      id: 2,
      name: "Beach House",
      invite_code: "BEACH0000002",
      created_by: "user-bob",
      created_at: "2026-01-01T00:00:02Z",
      check_date: null,
    },
  },
];

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("resolveActiveId", () => {
  it("returns null and clears storage with no households", async () => {
    await expect(resolveActiveId([])).resolves.toBeNull();
    await expect(AsyncStorage.getItem("housearena.active_household")).resolves.toBeNull();
  });

  it("keeps a saved id that is still a member", async () => {
    await AsyncStorage.setItem("housearena.active_household", "2");
    await expect(resolveActiveId(homes)).resolves.toBe(2);
  });

  it("falls back to the first household for foreign or garbage ids", async () => {
    await AsyncStorage.setItem("housearena.active_household", "999");
    await expect(resolveActiveId(homes)).resolves.toBe(1);
    await AsyncStorage.setItem("housearena.active_household", "abc");
    await expect(resolveActiveId(homes)).resolves.toBe(1);
    // Fallback is persisted, so next boot agrees.
    await expect(AsyncStorage.getItem("housearena.active_household")).resolves.toBe("1");
  });
});

describe("saveActiveId", () => {
  it("writes and clears", async () => {
    await saveActiveId(2);
    await expect(AsyncStorage.getItem("housearena.active_household")).resolves.toBe("2");
    await saveActiveId(null);
    await expect(AsyncStorage.getItem("housearena.active_household")).resolves.toBeNull();
  });
});
