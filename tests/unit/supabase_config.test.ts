import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearBackendConfig,
  dropClient,
  getBackendConfigSync,
  getDevPrefill,
  getSupabase,
  initSupabaseClient,
  loadBackendConfig,
  restoreBackend,
  saveBackendConfig,
  withTimeout,
} from "../../src/system/supabase";

const SECURE = () => (globalThis as any).__secureStore as Map<string, string>;
const URL = "https://xyz.supabase.co";
const KEY = "a".repeat(40);
const OLD_ENV = { ...process.env };

function clearEnv() {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_KEY;
}

beforeEach(async () => {
  SECURE().clear();
  await AsyncStorage.clear();
  await clearBackendConfig();
  Object.assign(process.env, OLD_ENV);
  clearEnv();
});

afterAll(() => {
  Object.assign(process.env, OLD_ENV);
});

describe("withTimeout", () => {
  it("passes fast values through", async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, "T")).resolves.toBe(7);
  });

  it("rejects hangs with the label", async () => {
    await expect(withTimeout(new Promise(() => {}), 20, "Profile load")).rejects.toThrow(
      "Profile load timed out",
    );
  });

  it("propagates the original error, not the timeout", async () => {
    await expect(withTimeout(Promise.reject(new Error("nope")), 1000, "T")).rejects.toThrow(
      "nope",
    );
  });
});

describe("save/load/clear backend config", () => {
  it("rejects invalid configs before touching storage", async () => {
    await expect(saveBackendConfig("http://x.supabase.co", KEY)).rejects.toThrow(
      "must start with https",
    );
    expect(SECURE().size).toBe(0);
    expect(getBackendConfigSync()).toBeNull();
  });

  it("round-trips through one atomic blob", async () => {
    await saveBackendConfig(`  ${URL}/// `, ` ${KEY} `);
    expect(SECURE().size).toBe(1);
    await expect(loadBackendConfig()).resolves.toEqual({ url: URL, anonKey: KEY });
    expect(getBackendConfigSync()).toEqual({ url: URL, anonKey: KEY });
  });

  it("treats corrupt blobs as unconfigured", async () => {
    SECURE().set("housearena.supabase.config", "{broken");
    await expect(loadBackendConfig()).resolves.toBeNull();
  });

  it("migrates the legacy two-key format once", async () => {
    SECURE().set("housearena.supabase.url", URL);
    SECURE().set("housearena.supabase.anon_key", KEY);
    await expect(loadBackendConfig()).resolves.toEqual({ url: URL, anonKey: KEY });
    expect(SECURE().has("housearena.supabase.url")).toBe(false);
    expect(SECURE().has("housearena.supabase.anon_key")).toBe(false);
    expect(SECURE().size).toBe(1);
  });

  it("clears everything including sync getters", async () => {
    await saveBackendConfig(URL, KEY);
    await clearBackendConfig();
    await expect(loadBackendConfig()).resolves.toBeNull();
    expect(getBackendConfigSync()).toBeNull();
    expect(getSupabase()).toBeNull();
    expect(SECURE().size).toBe(0);
  });
});

describe("client lifecycle", () => {
  it("init wires the sync getters without network", () => {
    const client = initSupabaseClient({ url: URL, anonKey: KEY });
    expect(getSupabase()).toBe(client);
    expect(getBackendConfigSync()).toEqual({ url: URL, anonKey: KEY });
    // stopAutoRefresh may not exist on all client versions; guard it.
    (client.auth as any).stopAutoRefresh?.();
  });

  it("dropClient clears the singleton without touching stored config", async () => {
    const client = initSupabaseClient({ url: URL, anonKey: KEY });
    expect(getSupabase()).not.toBeNull();
    (client.auth as any).stopAutoRefresh?.();
    dropClient();
    expect(getSupabase()).toBeNull();
    expect(getBackendConfigSync()).toEqual({ url: URL, anonKey: KEY });
  });

  it("restoreBackend returns null with nothing stored and no env", async () => {
    await expect(restoreBackend()).resolves.toBeNull();
  });

  it("restoreBackend prefers storage, then env, and persists env once", async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = URL;
    process.env.EXPO_PUBLIC_SUPABASE_KEY = KEY;
    const first = await restoreBackend();
    expect(first).not.toBeNull();
    (first!.auth as any).stopAutoRefresh?.();
    // Env fallback is persisted, so storage and client agree afterwards.
    expect(JSON.parse(SECURE().get("housearena.supabase.config")!)).toEqual({
      url: URL,
      anonKey: KEY,
    });
    const second = await restoreBackend();
    expect(second).toBe(first);
  });

  it("restoreBackend prefers a stored config over env", async () => {
    await saveBackendConfig("https://stored.supabase.co", KEY);
    process.env.EXPO_PUBLIC_SUPABASE_URL = "https://env.supabase.co";
    process.env.EXPO_PUBLIC_SUPABASE_KEY = KEY;
    const client = await restoreBackend();
    (client!.auth as any).stopAutoRefresh?.();
    expect(getBackendConfigSync()).toEqual({ url: "https://stored.supabase.co", anonKey: KEY });
  });
});

describe("getDevPrefill", () => {
  it("returns env values or null", () => {
    expect(getDevPrefill()).toBeNull();
    process.env.EXPO_PUBLIC_SUPABASE_URL = URL;
    process.env.EXPO_PUBLIC_SUPABASE_KEY = KEY;
    expect(getDevPrefill()).toEqual({ url: URL, anonKey: KEY });
  });
});
