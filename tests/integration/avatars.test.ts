import { renderHook, waitFor } from "@testing-library/react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  pickProfilePhoto,
  resolveAvatarUrl,
  updateProfile,
  uploadAvatar,
  useAvatarUrl,
} from "../../src/system/avatars";
import { FakeClient } from "../fake/fake_supabase";
import { ANA, BOB, CHARLIE, createSeed } from "../fake/seed";

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

import * as ImagePicker from "expo-image-picker";

const Picker = ImagePicker as unknown as {
  requestMediaLibraryPermissionsAsync: jest.Mock;
  launchImageLibraryAsync: jest.Mock;
};

let fake: FakeClient;
let client: SupabaseClient;

beforeEach(() => {
  fake = new FakeClient(createSeed());
  client = fake as unknown as SupabaseClient;
  Picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  Picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
  (globalThis as any).fetch = jest.fn(async () => ({
    blob: async () => new Blob(["photo-bytes"], { type: "image/jpeg" }),
  }));
});

describe("pickProfilePhoto", () => {
  it("throws when access is denied", async () => {
    Picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(pickProfilePhoto()).rejects.toThrow("Photo access");
  });

  it("returns null when the user backs out", async () => {
    await expect(pickProfilePhoto()).resolves.toBeNull();
  });

  it("returns the picked uri", async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///photo.jpg" }],
    });
    await expect(pickProfilePhoto()).resolves.toBe("file:///photo.jpg");
  });
});

describe("uploadAvatar", () => {
  it("stores under the user folder and returns the path", async () => {
    const path = await uploadAvatar(client, ANA.id, "file:///photo.jpg");
    expect(path).toBe(`${ANA.id}/avatar.jpg`);
    expect(fake.storageFiles.get(`avatars/${ANA.id}/avatar.jpg`)).toBeDefined();
  });

  it("overwrites instead of piling up files", async () => {
    await uploadAvatar(client, ANA.id, "file:///one.jpg");
    await uploadAvatar(client, ANA.id, "file:///two.jpg");
    const keys = [...fake.storageFiles.keys()].filter((k) =>
      k.startsWith(`avatars/${ANA.id}/`),
    );
    expect(keys).toEqual([`avatars/${ANA.id}/avatar.jpg`]);
  });

  it("surfaces storage failures", async () => {
    fake.storageError = "Bucket is full";
    await expect(uploadAvatar(client, ANA.id, "file:///photo.jpg")).rejects.toThrow(
      "Bucket is full",
    );
  });
});

describe("resolveAvatarUrl", () => {
  it("returns null for null paths without any calls", async () => {
    fake.resetCalls();
    await expect(resolveAvatarUrl(client, null)).resolves.toBeNull();
    expect(fake.calls.signedUrl).toBe(0);
  });

  it("mints once then serves from cache", async () => {
    await uploadAvatar(client, CHARLIE.id, "file:///photo.jpg");
    const path = `${CHARLIE.id}/avatar.jpg`;
    fake.resetCalls();
    const first = await resolveAvatarUrl(client, path);
    expect(first).toContain(path);
    expect(fake.calls.signedUrl).toBe(1);
    const second = await resolveAvatarUrl(client, path);
    expect(second).toBe(first);
    expect(fake.calls.signedUrl).toBe(1);
  });

  it("re-upload invalidates the cached URL", async () => {
    await uploadAvatar(client, BOB.id, "file:///one.jpg");
    const path = `${BOB.id}/avatar.jpg`;
    await resolveAvatarUrl(client, path);
    fake.resetCalls();
    await uploadAvatar(client, BOB.id, "file:///two.jpg");
    await resolveAvatarUrl(client, path);
    expect(fake.calls.signedUrl).toBe(1);
  });

  it("throws for missing objects", async () => {
    await expect(resolveAvatarUrl(client, "nobody/avatar.jpg")).rejects.toThrow();
  });
});

describe("useAvatarUrl", () => {
  it("publishes the resolved URL and clears on path change", async () => {
    await uploadAvatar(client, ANA.id, "file:///photo.jpg");
    const { result, rerender, unmount } = renderHook(
      ({ path }: { path: string | null }) => useAvatarUrl(client, path),
      { initialProps: { path: `${ANA.id}/avatar.jpg` as string | null } },
    );
    await waitFor(() => expect(result.current).toContain(`${ANA.id}/avatar.jpg`));
    rerender({ path: null });
    await waitFor(() => expect(result.current).toBeNull());
    unmount();
  });
});

describe("updateProfile", () => {
  it("trims and saves a new username", async () => {
    await updateProfile(client, ANA.id, { username: "  ana2  " });
    expect(
      fake.tables.profiles.find((p) => p.id === ANA.id)?.username,
    ).toBe("ana2");
  });

  it("validates names without touching the backend", async () => {
    fake.resetCalls();
    await expect(updateProfile(client, ANA.id, { username: "x" })).rejects.toThrow();
    expect(fake.calls.update).toBe(0);
    expect(fake.tables.profiles.find((p) => p.id === ANA.id)?.username).toBe("ana");
  });

  it("maps taken names to the friendly message", async () => {
    await expect(updateProfile(client, ANA.id, { username: "bob" })).rejects.toThrow(
      "That username is taken.",
    );
  });

  it("saves avatar paths and no-ops on empty patches", async () => {
    await updateProfile(client, ANA.id, { avatar_url: `${ANA.id}/avatar.jpg` });
    expect(
      fake.tables.profiles.find((p) => p.id === ANA.id)?.avatar_url,
    ).toBe(`${ANA.id}/avatar.jpg`);
    fake.resetCalls();
    await updateProfile(client, ANA.id, {});
    expect(fake.calls.update).toBe(0);
  });
});
