import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as ImagePicker from "expo-image-picker";
import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import { validateUsername } from "./supabase";

const AVATARS_BUCKET = "avatars";
const AVATAR_FILE = "avatar.jpg";
// Largest rendered avatar is 96px; at 3x that needs 288px source. 1024px
// leaves plenty of headroom for retina, zoom, and any future use.
const AVATAR_MAX_SIDE = 1024;
// Signed URLs live 7 days; the cache expires an hour early so the
// display layer never serves a dead link.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
const SIGNED_URL_CACHE_TTL_MS = SIGNED_URL_TTL_SECONDS * 1000 - 60 * 60 * 1000;

const urlCache = new Map<string, { url: string; expiresAt: number }>();

export function avatarPathFor(userId: string): string {
  return `${userId}/${AVATAR_FILE}`;
}

export type PickedPhoto = { uri: string; width: number; height: number };

// Opens the system photo picker with a square crop. Quality stays at 1:
// our own encode below decides the final bytes. Returns the local URI,
// width, and height, or null when the user backs out. Throws when
// access is denied.
export async function pickProfilePhoto(): Promise<PickedPhoto | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted)
    throw new Error("Photo access is needed to pick a picture.");
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (res.canceled || res.assets.length === 0) return null;
  const asset = res.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

// Caps the long side at AVATAR_MAX_SIDE and re-encodes JPEG 0.95 so every
// stored photo is crisp at display size. Small crops pass through
// untouched. Throws when the file cannot be read.
async function normalizeAvatar(
  localUri: string,
  width: number,
  height: number,
): Promise<string> {
  if (Math.max(width, height) <= AVATAR_MAX_SIDE) return localUri;
  const wide = width >= height;
  const resized = await manipulateAsync(
    localUri,
    wide ? [{ resize: { width: AVATAR_MAX_SIDE } }] : [{ resize: { height: AVATAR_MAX_SIDE } }],
    { compress: 0.95, format: SaveFormat.JPEG },
  );
  return resized.uri;
}

// Uploads to the user's own folder, overwriting any previous photo so
// no orphan files pile up. Returns the storage path for avatar_url.
export async function uploadAvatar(
  client: SupabaseClient,
  userId: string,
  picked: PickedPhoto,
): Promise<string> {
  const path = avatarPathFor(userId);
  const normalized = await normalizeAvatar(picked.uri, picked.width, picked.height);
  const res = await fetch(normalized);
  const blob = await res.blob();
  const { error } = await client.storage
    .from(AVATARS_BUCKET)
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  // Same path, new bytes: drop the stale signed URL.
  urlCache.delete(path);
  return path;
}

// Turns a stored path into a viewable URL, cached in memory.
export async function resolveAvatarUrl(
  client: SupabaseClient,
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const hit = urlCache.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.url;
  const { data, error } = await client.storage
    .from(AVATARS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl)
    throw new Error(error?.message ?? "Could not load avatar.");
  urlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_CACHE_TTL_MS,
  });
  return data.signedUrl;
}

export function useAvatarUrl(
  client: SupabaseClient | null,
  path: string | null,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!client || !path) return;
    resolveAvatarUrl(client, path)
      .then((u) => {
        if (alive) setUrl(u);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [client, path]);
  return url;
}

// Saves username and/or avatar path on the caller's own profile row.
// Throws a friendly message when the name is taken.
export async function updateProfile(
  client: SupabaseClient,
  userId: string,
  patch: { username?: string; avatar_url?: string | null },
): Promise<void> {
  const clean: { username?: string; avatar_url?: string | null } = {};
  if (patch.username !== undefined) {
    const uErr = validateUsername(patch.username);
    if (uErr) throw new Error(uErr);
    clean.username = patch.username.trim();
  }
  if (patch.avatar_url !== undefined) clean.avatar_url = patch.avatar_url;
  if (Object.keys(clean).length === 0) return;
  const { error } = await client
    .from("profiles")
    .update(clean)
    .eq("id", userId);
  if (error) throw new Error(error.message);
}
