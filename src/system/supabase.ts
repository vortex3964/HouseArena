// Runtime-configurable Supabase client for HouseArena.
//
// The owner types the Supabase URL + anon key INSIDE the app (Register screen),
// not in a .env file. Values are persisted in SecureStore (native) /
// AsyncStorage (web) and the client is created dynamically.
//
// .env is only used as an optional dev prefill, never required.

import "react-native-url-polyfill/auto";
import { Platform } from "react-native";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const CONFIG_KEY = "housearena.supabase.config";
// Keys used by earlier builds, migrated to CONFIG_KEY automatically.
const LEGACY_URL_KEY = "housearena.supabase.url";
const LEGACY_ANON_KEY = "housearena.supabase.anon_key";

// __DEV__ is true for dev builds only, never for store builds.
const DEV = typeof __DEV__ !== "undefined" ? __DEV__ : false;

export type BackendConfig = { url: string; anonKey: string };

let _client: SupabaseClient | null = null;
let _config: BackendConfig | null = null;

// Storage helpers, SecureStore on native and AsyncStorage on web.

async function storeSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function storeGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function storeDel(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

// Auth session storage. Supabase tokens live here, so on native they go
// to SecureStore in chunks (values have a ~2KB limit per item).
const CHUNK_SIZE = 1800;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

async function secureAuthGet(key: string): Promise<string | null> {
  const count = Number(await SecureStore.getItemAsync(chunkKey(key, -1)));
  if (!Number.isFinite(count) || count <= 0) return null;
  let out = "";
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i));
    if (part == null) return null;
    out += part;
  }
  return out;
}

async function secureAuthSet(key: string, value: string): Promise<void> {
  const oldCount =
    Number(await SecureStore.getItemAsync(chunkKey(key, -1))) || 0;
  const chunks = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
  for (let i = 0; i < chunks; i++) {
    await SecureStore.setItemAsync(
      chunkKey(key, i),
      value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    );
  }
  await SecureStore.setItemAsync(chunkKey(key, -1), String(chunks));
  for (let i = chunks; i < oldCount; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i)).catch(() => {});
  }
}

async function secureAuthDel(key: string): Promise<void> {
  const count =
    Number(await SecureStore.getItemAsync(chunkKey(key, -1)).catch(() => null)) ||
    0;
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i)).catch(() => {});
  }
  await SecureStore.deleteItemAsync(chunkKey(key, -1)).catch(() => {});
}

const authStorage =
  Platform.OS === "web"
    ? AsyncStorage
    : {
        getItem: secureAuthGet,
        setItem: secureAuthSet,
        removeItem: secureAuthDel,
      };

// Config helpers.

export function sanitizeConfig(url: string, anonKey: string): BackendConfig {
  return { url: url.trim().replace(/\/+$/, ""), anonKey: anonKey.trim() };
}

export function validateConfig(c: BackendConfig): string | null {
  if (!c.url.startsWith("https://"))
    return "Supabase URL must start with https://";
  if (!c.url.includes(".supabase.co") && !c.url.includes("localhost"))
    return "That URL doesn't look like a Supabase URL.";
  if (c.anonKey.length < 20)
    return "Anon key looks too short - paste the full anon key.";
  return null;
}

export async function loadBackendConfig(): Promise<BackendConfig | null> {
  // Single atomic blob. One key means no half-saved URL-without-key state.
  const raw = await storeGet(CONFIG_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as BackendConfig;
      if (parsed.url && parsed.anonKey) return parsed;
    } catch {
      return null;
    }
  }
  // One-time migration from the two-key format of earlier builds.
  const [url, anonKey] = await Promise.all([
    storeGet(LEGACY_URL_KEY),
    storeGet(LEGACY_ANON_KEY),
  ]);
  if (url && anonKey) {
    const cfg = { url, anonKey };
    await storeSet(CONFIG_KEY, JSON.stringify(cfg));
    await Promise.all([
      storeDel(LEGACY_URL_KEY),
      storeDel(LEGACY_ANON_KEY),
    ]).catch(() => {});
    return cfg;
  }
  return null;
}

export async function saveBackendConfig(
  url: string,
  anonKey: string,
): Promise<BackendConfig> {
  const cfg = sanitizeConfig(url, anonKey);
  const err = validateConfig(cfg);
  if (err) throw new Error(err);
  await storeSet(CONFIG_KEY, JSON.stringify(cfg));
  _config = cfg;
  return cfg;
}

export async function clearBackendConfig(): Promise<void> {
  await Promise.all([
    storeDel(CONFIG_KEY),
    storeDel(LEGACY_URL_KEY),
    storeDel(LEGACY_ANON_KEY),
  ]).catch(() => {});
  _config = null;
  _client = null;
}

// Client lifecycle.

export function initSupabaseClient(cfg: BackendConfig): SupabaseClient {
  _config = cfg;
  _client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      storage: authStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
  return _client;
}

/** Connect with owner-typed credentials: validate, persist, build client. */
export async function connectBackend(
  url: string,
  anonKey: string,
): Promise<SupabaseClient> {
  const cfg = await saveBackendConfig(url, anonKey);
  const client = initSupabaseClient(cfg);
  // Reachability check - wrong URL/key throws here.
  const { error } = await client.auth.getSession();
  if (error) throw error;
  return client;
}

/** Restore saved backend on app start. Returns null if never configured. */
export async function restoreBackend(): Promise<SupabaseClient | null> {
  if (_client) return _client;
  const cfg = _config ?? (await loadBackendConfig());
  // Dev builds only: prefill from .env so coding needs no retyping.
  // Store builds never read .env, values there would ship in the bundle.
  const envUrl = DEV ? process.env.EXPO_PUBLIC_SUPABASE_URL : undefined;
  const envKey = DEV ? process.env.EXPO_PUBLIC_SUPABASE_KEY : undefined;
  const effective = cfg ?? (envUrl && envKey ? { url: envUrl, anonKey: envKey } : null);
  if (!effective) return null;
  return initSupabaseClient(effective);
}

export function getSupabase(): SupabaseClient | null {
  return _client;
}

export function getBackendConfigSync(): BackendConfig | null {
  return _config;
}

/** Dev-only prefill for the credentials inputs. Always null in store builds. */
export function getDevPrefill(): BackendConfig | null {
  if (!DEV) return null;
  const envUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const envKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;
  if (envUrl && envKey) return { url: envUrl, anonKey: envKey };
  return null;
}

// Validators used by login and register.

export function validateUsername(username: string): string | null {
  const u = username.trim();
  if (u.length < 3) return "Username needs at least 3 characters.";
  if (u.length > 20) return "Username must be 20 characters or less.";
  if (!/^[a-zA-Z0-9_-]+$/.test(u))
    return "Only letters, numbers, _ and - allowed.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < 6) return "Password needs at least 6 characters.";
  return null;
}

// Format check only. Users must enter a real email, Supabase sends a
// confirmation link to it before the first login.
export function validateEmail(email: string): string | null {
  const clean = email.trim();
  if (!clean) return "Type your email.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean))
    return "That email does not look right.";
  return null;
}

/** Turn Supabase auth errors into short user-facing messages. */
export function friendlyAuthError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/invalid login credentials/i.test(msg))
    return "No account matches that username + password.";
  if (/user already registered|already exists/i.test(msg))
    return "That username is taken - try logging in.";
  if (/fetch|network|failed/i.test(msg))
    return "Can't reach Supabase - check the URL/key and connection.";
  return msg;
}

// True when the error looks like a dead backend (wrong URL, no net, bad key)
// and not like a wrong username or password. Used to reveal the
// "re-enter backend codes" buttons on login and register.
export function isBackendDownError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /reach supabase|fetch|network|failed/i.test(msg);
}
