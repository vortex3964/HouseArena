import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Messages } from "../global/constants";

type NotificationsModule = typeof import("expo-notifications");

// Remote push was removed from Expo Go, so the module loads lazily and
// never in Expo Go. require() (not dynamic import()) is deliberate: it
// always resolves through the module registry, while import() can slip
// past mocks and bundler analysis. Null means pushes are unavailable
// and the app simply runs without them.
declare const require: (id: string) => any;

let cached: NotificationsModule | null | undefined;

function getNotifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  // Expo Go cannot even evaluate this module (it throws on Android),
  // so it is never imported there. Dev and store builds proceed.
  if (Constants.appOwnership === "expo") {
    cached = null;
    return cached;
  }
  try {
    cached = require("expo-notifications") as NotificationsModule;
  } catch {
    cached = null;
  }
  return cached;
}

// Foreground pushes show a banner instead of vanishing silently.
export function setupNotificationHandler() {
  try {
    getNotifications()?.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Push unavailable; the app runs without it.
  }
}

const TOKEN_CACHE = "housearena.push_token_sent";

// Saves this device for push on first login per token, skips after that.
// Best effort only, a missing token or denied permission never blocks login.
export async function registerPushToken(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  try {
    if (Platform.OS === "web") return;
    const N = getNotifications();
    if (!N) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) return;
    const { status: existing } = await N.getPermissionsAsync();
    const { status } =
      existing === "granted"
        ? { status: existing }
        : await N.requestPermissionsAsync();
    if (status !== "granted") return;
    const { data: token } = await N.getExpoPushTokenAsync({
      projectId,
    });
    if (!token) return;
    const cacheKey = `${TOKEN_CACHE}:${userId}`;
    if ((await AsyncStorage.getItem(cacheKey).catch(() => null)) === token)
      return;
    const { error } = await client.from("push_devices").upsert(
      {
        user_id: userId,
        expo_push_token: token,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,expo_push_token" },
    );
    if (error) return;
    await AsyncStorage.setItem(cacheKey, token).catch(() => {});
  } catch {
    // Push is best effort, it never blocks login.
  }
}

// Asks for a reset code by push. Always resolves quietly, never
// reveals whether the address exists, matching the function behavior.
const RESET_FUNCTION_PATH = "/functions/v1/request-password-reset";

function resetEndpoint(url: string): string {
  return `${url.replace(/\/+$/, "")}${RESET_FUNCTION_PATH}`;
}

function resetHeaders(anonKey: string): Record<string, string> {
  return { apikey: anonKey, "Content-Type": "application/json" };
}

export async function requestResetCode(
  url: string,
  anonKey: string,
  email: string,
): Promise<void> {
  const clean = email.trim();
  if (!clean) throw new Error(Messages.TYPE_EMAIL_FIRST);
  try {
    const res = await fetch(resetEndpoint(url), {
      method: "POST",
      headers: resetHeaders(anonKey),
      body: JSON.stringify({ action: "request", email: clean }),
    });
    if (!res.ok)
      throw new Error("Couldn't reach the server - check your connection.");
  } catch (e) {
    // A dead network must say so; anything the server answered stays
    // generic so the box cannot probe which emails exist.
    if (e instanceof TypeError)
      throw new Error("Couldn't reach the server - check your connection.");
    throw e;
  }
}

// Spends the pushed code for a new password. Throws the server message
// on a bad code so the box can show it.
export async function confirmResetCode(
  url: string,
  anonKey: string,
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(resetEndpoint(url), {
    method: "POST",
    headers: resetHeaders(anonKey),
    body: JSON.stringify({
      action: "confirm",
      email: email.trim(),
      code: code.trim(),
      newPassword,
    }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (!body?.ok) throw new Error(body?.error ?? "Reset failed, try again.");
}
