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

const URL_KEY = "housearena.supabase.url";
const ANON_KEY = "housearena.supabase.anon_key";

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
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    // Fallback if SecureStore unavailable (e.g. some emulators)
    return AsyncStorage.getItem(key);
  }
}

async function storeDel(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    await AsyncStorage.removeItem(key);
  }
}

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
  const [url, anonKey] = await Promise.all([
    storeGet(URL_KEY),
    storeGet(ANON_KEY),
  ]);
  if (url && anonKey) return { url, anonKey };
  return null;
}

export async function saveBackendConfig(
  url: string,
  anonKey: string,
): Promise<BackendConfig> {
  const cfg = sanitizeConfig(url, anonKey);
  const err = validateConfig(cfg);
  if (err) throw new Error(err);
  await Promise.all([
    storeSet(URL_KEY, cfg.url),
    storeSet(ANON_KEY, cfg.anonKey),
  ]);
  _config = cfg;
  return cfg;
}

export async function clearBackendConfig(): Promise<void> {
  await Promise.all([storeDel(URL_KEY), storeDel(ANON_KEY)]);
  _config = null;
  _client = null;
}

// Client lifecycle.

export function initSupabaseClient(cfg: BackendConfig): SupabaseClient {
  _config = cfg;
  _client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      storage: AsyncStorage,
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
  // Dev convenience: prefill from .env so you don't retype while coding.
  const envUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const envKey = process.env.EXPO_PUBLIC_SUPABASE_KEY;
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

/** Dev-only prefill for the credentials inputs (from .env if present). */
export function getDevPrefill(): BackendConfig | null {
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
