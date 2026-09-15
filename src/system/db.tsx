// Data-access layer for HouseArena v2.
// Every function takes an explicit Supabase client (runtime-configured,
// see supabase.ts) so screens never import a global that may be null.
// Auth uses real emails. Login takes username only and resolves the email
// through the get_email_for_username RPC first.

import { QueryClient, useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createURL } from "expo-linking";
import {
  friendlyAuthError,
  validateEmail,
  validatePassword,
  validateUsername,
} from "./supabase";
import type { Household, MyHousehold, Profile } from "./obj_types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1 },
  },
});

export const qk = {
  myHouseholds: (userId: string | null) => ["my-households", userId] as const,
  myProfile: (userId: string | null) => ["profile", userId] as const,
};

// Auth.

// Register with a real email plus a unique username.
// Example: signUpWithEmail(c, "ana@mail.com", "ana", "secret12")
export async function signUpWithEmail(
  client: SupabaseClient,
  email: string,
  username: string,
  password: string,
) {
  const eErr = validateEmail(email);
  if (eErr) throw new Error(eErr);
  const uErr = validateUsername(username);
  if (uErr) throw new Error(uErr);
  const pErr = validatePassword(password);
  if (pErr) throw new Error(pErr);
  const { data, error } = await client.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: { username: username.trim() },
      // After tapping the confirmation mail, Supabase sends the user
      // back into the app instead of a localhost page phones can't open.
      // In Expo Go this is an exp:// URL, in builds housearena://.
      emailRedirectTo: createURL("auth/callback"),
    },
  });
  if (error) throw new Error(friendlyAuthError(error));
  return data;
}

// Login keeps asking username + password only.
// Step 1 resolves the username to its email (works while logged out).
// Step 2 signs in with that email. Wrong names report "no account".
// Returns the user id from the session, so callers skip an extra getUser.
export async function signInWithUsername(
  client: SupabaseClient,
  username: string,
  password: string,
): Promise<string> {
  const uErr = validateUsername(username);
  if (uErr) throw new Error(uErr);
  if (!password) throw new Error("Type your password.");
  const email = await resolveEmailForUsername(client, username);
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw new Error(friendlyAuthError(error));
  const uid = data.session?.user?.id ?? null;
  if (!uid) throw new Error("Login worked but no user was returned.");
  return uid;
}

// Calls the public RPC. Returns the email or throws when unknown.
export async function resolveEmailForUsername(
  client: SupabaseClient,
  username: string,
): Promise<string> {
  const { data, error } = await client.rpc("get_email_for_username", {
    p_username: username.trim(),
  });
  if (error) throw new Error(friendlyAuthError(error));
  if (!data || typeof data !== "string" || !data.includes("@"))
    throw new Error("No account matches that username + password.");
  return data;
}

// Profiles.

export async function fetchMyProfile(
  client: SupabaseClient,
  userId: string,
): Promise<Profile | null> {
  const { data, error } = await client
    .from("profiles")
    .select(
      "id,username,email,avatar_url,points,gems,strikes,wins,created_at",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Profile | null) ?? null;
}

// Households.

// All households the user belongs to, newest membership last.
// Example row: { role: "owner", household: { id: 3, name: "Sunset Flat" } }
export async function fetchMyHouseholds(
  client: SupabaseClient,
  userId: string,
): Promise<MyHousehold[]> {
  const { data, error } = await client
    .from("household_members")
    .select(
      "role,joined_at,household:households(id,name,invite_code,created_by,created_at,check_date)",
    )
    .eq("profile_id", userId)
    .order("joined_at", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<{
    role: MyHousehold["role"];
    joined_at: string;
    household: Household | Household[];
  }>;
  return rows
    .filter((r) => r.household && !Array.isArray(r.household))
    .map((r) => ({
      role: r.role,
      joined_at: r.joined_at,
      household: r.household as Household,
    }));
}

// Creates a household and makes the caller its owner (one RPC call).
export async function createHousehold(
  client: SupabaseClient,
  name: string,
): Promise<Household> {
  const clean = name.trim();
  if (clean.length < 2) throw new Error("Household name is too short.");
  if (clean.length > 50) throw new Error("Household name max 50 characters.");
  const { data, error } = await client.rpc("create_household", {
    p_name: clean,
  });
  if (error) throw new Error(error.message);
  return data as Household;
}

// Joins with the 6-letter code shown to household members.
// Example: joinHouseholdByCode(c, "KX7Q2M")
export async function joinHouseholdByCode(
  client: SupabaseClient,
  code: string,
): Promise<Household> {
  const clean = code.trim().toUpperCase();
  if (clean.length < 4) throw new Error("That invite code is too short.");
  const { data, error } = await client.rpc("join_household_by_code", {
    p_code: clean,
  });
  if (error) throw new Error(error.message);
  return data as Household;
}

export async function leaveHousehold(
  client: SupabaseClient,
  householdId: number,
): Promise<void> {
  const { error } = await client.rpc("leave_household", {
    p_household_id: householdId,
  });
  if (error) throw new Error(error.message);
}

// TanStack hooks.

export function useMyHouseholds(
  client: SupabaseClient | null,
  userId: string | null,
) {
  return useQuery({
    queryKey: qk.myHouseholds(userId),
    enabled: !!client && !!userId,
    queryFn: () => fetchMyHouseholds(client!, userId!),
  });
}

export function useMyProfile(
  client: SupabaseClient | null,
  userId: string | null,
) {
  return useQuery({
    queryKey: qk.myProfile(userId),
    enabled: !!client && !!userId,
    queryFn: () => fetchMyProfile(client!, userId!),
  });
}
