// Data-access layer for HouseArena v2.
// Every function takes an explicit Supabase client (runtime-configured,
// see supabase.ts) so screens never import a global that may be null.
// Auth uses real emails. Login takes username only and resolves the email
// through the get_email_for_username RPC first.

import { QueryClient, useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  friendlyAuthError,
  validateEmail,
  validatePassword,
  validateUsername,
} from "./supabase";
import type {
  ActivityLog,
  Household,
  HouseholdMember,
  MyHousehold,
  Profile,
  Task,
} from "./obj_types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 1 },
  },
});

export const qk = {
  myHouseholds: (userId: string | null) => ["my-households", userId] as const,
  myProfile: (userId: string | null) => ["profile", userId] as const,
  tasks: (householdId: number | null) => ["tasks", householdId] as const,
  logs: (householdId: number | null) => ["logs", householdId] as const,
  members: (householdId: number | null) => ["members", householdId] as const,
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
    email: email.trim().toLowerCase(),
    password,
    options: { data: { username: username.trim() } },
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

// Live board data. Column lists stay narrow and every list is capped,
// realtime merges keep them fresh without refetching.

// Tasks of one household, oldest first for board order.
export async function fetchHouseholdTasks(
  client: SupabaseClient,
  householdId: number,
): Promise<Task[]> {
  const { data, error } = await client
    .from("tasks")
    .select(
      "id,title,description,difficulty,points,status,household_id,owner,created_by,created_at",
    )
    .eq("household_id", householdId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as Task[];
}

// Recent activity of one household, newest first, capped like the prune.
export async function fetchHouseholdLogs(
  client: SupabaseClient,
  householdId: number,
): Promise<ActivityLog[]> {
  const { data, error } = await client.rpc("get_household_logs", {
    p_household_id: householdId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ActivityLog[];
}

// Members with public profile fields only, never emails.
export async function fetchHouseholdMembers(
  client: SupabaseClient,
  householdId: number,
): Promise<HouseholdMember[]> {
  const { data, error } = await client
    .from("household_members")
    .select(
      "household_id,profile_id,role,joined_at,profile:profiles(id,username,avatar_url,points,gems,wins)",
    )
    .eq("household_id", householdId)
    .order("joined_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Array<{
    household_id: number;
    profile_id: string;
    role: HouseholdMember["role"];
    joined_at: string;
    profile: Profile | Profile[] | null;
  }>;
  return rows.map((r) => ({
    household_id: r.household_id,
    profile_id: r.profile_id,
    role: r.role,
    joined_at: r.joined_at,
    profile: Array.isArray(r.profile) ? (r.profile[0] ?? undefined) : (r.profile ?? undefined),
  }));
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

// Board hooks. Enabled only with a household, so logged-out screens
// and the homeless state cost zero queries.
export function useHouseholdTasks(
  client: SupabaseClient | null,
  householdId: number | null,
) {
  return useQuery({
    queryKey: qk.tasks(householdId),
    enabled: !!client && householdId != null,
    queryFn: () => fetchHouseholdTasks(client!, householdId!),
  });
}

export function useHouseholdLogs(
  client: SupabaseClient | null,
  householdId: number | null,
) {
  return useQuery({
    queryKey: qk.logs(householdId),
    enabled: !!client && householdId != null,
    queryFn: () => fetchHouseholdLogs(client!, householdId!),
  });
}

export function useHouseholdMembers(
  client: SupabaseClient | null,
  householdId: number | null,
) {
  return useQuery({
    queryKey: qk.members(householdId),
    enabled: !!client && householdId != null,
    queryFn: () => fetchHouseholdMembers(client!, householdId!),
  });
}
