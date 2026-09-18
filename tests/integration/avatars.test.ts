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

jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg", PNG: "png" },
}));

import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

const Picker = ImagePicker as unknown as {
  requestMediaLibraryPermissionsAsync: jest.Mock;
  launchImageLibraryAsync: jest.Mock;
};

const Manipulator = ImageManipulator as unknown as {
  manipulateAsync: jest.Mock;
};

let fake: FakeClient;
let client: SupabaseClient;

beforeEach(() => {
  fake = new FakeClient(createSeed());
  client = fake as unknown as SupabaseClient;
  Picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  Picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
  Manipulator.manipulateAsync.mockImplementation(async (uri: string) => ({
    uri,
    width: 1024,
    height: 1024,
  }));
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

  it("returns the picked uri and dimensions", async () => {
    Picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///photo.jpg", width: 3000, height: 3000 }],
    });
    await expect(pickProfilePhoto()).resolves.toEqual({
      uri: "file:///photo.jpg",
      width: 3000,
      height: 3000,
    });
  });
});

describe("uploadAvatar", () => {
  const largePicked = { uri: "file:///photo.jpg", width: 3000, height: 2000 };

  it("stores under the user folder and returns the path", async () => {
    const path = await uploadAvatar(client, ANA.id, largePicked);
    expect(path).toBe(`${ANA.id}/avatar.jpg`);
    expect(fake.storageFiles.get(`avatars/${ANA.id}/avatar.jpg`)).toBeDefined();
  });

  it("overwrites instead of piling up files", async () => {
    await uploadAvatar(client, ANA.id, { uri: "file:///one.jpg", width: 1000, height: 1000 });
    await uploadAvatar(client, ANA.id, { uri: "file:///two.jpg", width: 1000, height: 1000 });
    const keys = [...fake.storageFiles.keys()].filter((k) =>
      k.startsWith(`avatars/${ANA.id}/`),
    );
    expect(keys).toEqual([`avatars/${ANA.id}/avatar.jpg`]);
  });

  it("surfaces storage failures", async () => {
    fake.storageError = "Bucket is full";
    await expect(uploadAvatar(client, ANA.id, largePicked)).rejects.toThrow(
      "Bucket is full",
    );
  });

  it("downscales large photos to 1024px before upload", async () => {
    Manipulator.manipulateAsync.mockResolvedValue({ uri: "file:///photo-1024.jpg", width: 1024, height: 682 });
    await uploadAvatar(client, ANA.id, { uri: "file:///photo.jpg", width: 3000, height: 2000 });
    expect(Manipulator.manipulateAsync).toHaveBeenCalledWith(
      "file:///photo.jpg",
      [{ resize: { width: 1024 } }],
      { compress: 0.95, format: "jpeg" },
    );
    expect(globalThis.fetch as jest.Mock).toHaveBeenCalledWith("file:///photo-1024.jpg");
  });

  it("leaves small crops untouched", async () => {
    Manipulator.manipulateAsync.mockClear();
    await uploadAvatar(client, ANA.id, { uri: "file:///photo.jpg", width: 400, height: 400 });
    expect(Manipulator.manipulateAsync).not.toHaveBeenCalled();
    expect(globalThis.fetch as jest.Mock).toHaveBeenCalledWith("file:///photo.jpg");
  });
});

describe("resolveAvatarUrl", () => {
  it("returns null for null paths without any calls", async () => {
    fake.resetCalls();
    await expect(resolveAvatarUrl(client, null)).resolves.toBeNull();
    expect(fake.calls.signedUrl).toBe(0);
  });

  it("mints once then serves from cache", async () => {
    await uploadAvatar(client, CHARLIE.id, { uri: "file:///photo.jpg", width: 1000, height: 1000 });
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
    await uploadAvatar(client, BOB.id, { uri: "file:///one.jpg", width: 1000, height: 1000 });
    const path = `${BOB.id}/avatar.jpg`;
    await resolveAvatarUrl(client, path);
    fake.resetCalls();
    await uploadAvatar(client, BOB.id, { uri: "file:///two.jpg", width: 1000, height: 1000 });
    await resolveAvatarUrl(client, path);
    expect(fake.calls.signedUrl).toBe(1);
  });

  it("throws for missing objects", async () => {
    await expect(resolveAvatarUrl(client, "nobody/avatar.jpg")).rejects.toThrow();
  });
});

describe("useAvatarUrl", () => {
  it("publishes the resolved URL and clears on path change", async () => {
    await uploadAvatar(client, ANA.id, { uri: "file:///photo.jpg", width: 1000, height: 1000 });
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

  it("allows a duplicate display name", async () => {
    await updateProfile(client, ANA.id, { username: "bob" });
    expect(fake.tables.profiles.find((p) => p.id === ANA.id)?.username).toBe("bob");
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
