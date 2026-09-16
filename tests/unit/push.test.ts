import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { FakeClient } from "../fake/fake_supabase";
import { createSeed } from "../fake/seed";
import {
  confirmResetCode,
  registerPushToken,
  requestResetCode,
} from "../../src/system/push";

const N = Notifications as unknown as {
  getPermissionsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
  getExpoPushTokenAsync: jest.Mock;
};
const URL = "https://xyz.supabase.co";
const KEY = "a".repeat(40);
const FUNCTION_URL = `${URL}/functions/v1/request-password-reset`;

function mockFetchOnce(handler: (url: string, init: any) => any) {
  (globalThis as any).fetch = jest.fn(async (url: string, init: any) =>
    handler(url, init),
  );
}

function okJson(body: any, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  // Mutate the mocked module object itself: namespace imports are
  // per-file views, so assigning on the import would be invisible
  // to push.ts. requireMock reaches the shared underlying object.
  (jest.requireMock("expo-constants") as any).expoConfig = {};
  N.getPermissionsAsync.mockResolvedValue({ status: "denied" });
  N.requestPermissionsAsync.mockResolvedValue({ status: "denied" });
  N.getExpoPushTokenAsync.mockResolvedValue({ data: "ExponentPushToken[abc123]" });
});

describe("registerPushToken", () => {
  it("skips silently with no project id configured", async () => {
    const fake = new FakeClient(createSeed());
    await expect(registerPushToken(fake as any, "user-ana")).resolves.toBeUndefined();
    expect(fake.calls.upsert).toBe(0);
    expect(N.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it("upserts once per token then uses the cache", async () => {
    (jest.requireMock("expo-constants") as any).expoConfig = {
      extra: { eas: { projectId: "test-proj" } },
    };
    N.getPermissionsAsync.mockResolvedValue({ status: "granted" });
    const fake = new FakeClient(createSeed());
    const client = fake as any;

    await registerPushToken(client, "user-ana");
    expect(fake.calls.upsert).toBe(1);
    expect(fake.tables.push_devices).toEqual([
      expect.objectContaining({
        user_id: "user-ana",
        expo_push_token: "ExponentPushToken[abc123]",
      }),
    ]);

    await registerPushToken(client, "user-ana");
    expect(fake.calls.upsert).toBe(1);
  });
});

describe("requestResetCode", () => {
  it("posts action, email, key, and normalized URL", async () => {
    let seen: any = null;
    mockFetchOnce(async (url: string, init: any) => {
      seen = { url, init };
      return okJson({ ok: true });
    });
    await requestResetCode(`${URL}///`, KEY, " ana@mail.com ");
    expect(seen.url).toBe(FUNCTION_URL);
    expect(seen.init.method).toBe("POST");
    expect(seen.init.headers).toEqual({
      apikey: KEY,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(seen.init.body)).toEqual({ action: "request", email: "ana@mail.com" });
  });

  it("rejects empty email before any fetch", async () => {
    const spy = jest.fn(async () => okJson({ ok: true }));
    (globalThis as any).fetch = spy;
    await expect(requestResetCode(URL, KEY, "   ")).rejects.toThrow("Type your email first.");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports dead networks honestly", async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError("Network request failed");
    });
    await expect(requestResetCode(URL, KEY, "ana@mail.com")).rejects.toThrow(
      "Couldn't reach the server",
    );
  });

  it("reports non-ok HTTP as connection trouble", async () => {
    mockFetchOnce(async () => okJson({ error: "x" }, 500));
    await expect(requestResetCode(URL, KEY, "ana@mail.com")).rejects.toThrow(
      "Couldn't reach the server",
    );
  });
});

describe("confirmResetCode", () => {
  it("posts the full confirm payload and resolves on ok", async () => {
    let seen: any = null;
    mockFetchOnce(async (_url: string, init: any) => {
      seen = init;
      return okJson({ ok: true });
    });
    await confirmResetCode(URL, KEY, "ana@mail.com", "123456", "newsecret");
    expect(JSON.parse(seen.body)).toEqual({
      action: "confirm",
      email: "ana@mail.com",
      code: "123456",
      newPassword: "newsecret",
    });
  });

  it("throws the server message on rejection and generic on transport death", async () => {
    mockFetchOnce(async () => okJson({ ok: false, error: "Invalid or expired code." }));
    await expect(confirmResetCode(URL, KEY, "a@b.c", "1", "newsecret")).rejects.toThrow(
      "Invalid or expired code.",
    );
    (globalThis as any).fetch = jest.fn(async () => {
      throw new TypeError("down");
    });
    await expect(confirmResetCode(URL, KEY, "a@b.c", "1", "newsecret")).rejects.toThrow(
      "Reset failed, try again.",
    );
  });
});
