// Data-access layer for HouseArena v2.
// Every function takes an explicit Supabase client (runtime-configured,
// see supabase.ts) so screens never import a global that may be null.
// Auth uses real emails. Login takes email + password directly;
// usernames are display-only and may repeat.

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
  TaskDifficulty,
  TaskVote,
} from "./obj_types";
import { Lengths, Limits, PointsBands, QueryCache } from "../global/constants";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QueryCache.STALE_TIME,
      gcTime: QueryCache.GC_TIME,
      retry: QueryCache.RETRY,
    },
  },
});

export const qk = {
  myHouseholds: (userId: string | null) => ["my-households", userId] as const,
  myProfile: (userId: string | null) => ["profile", userId] as const,
  tasks: (householdId: number | null) => ["tasks", householdId] as const,
  logs: (householdId: number | null) => ["logs", householdId] as const,
  members: (householdId: number | null) => ["members", householdId] as const,
  votes: (householdId: number | null) => ["votes", householdId] as const,
};

// Auth.

// Register with a real email plus a display name (duplicates allowed,
// it is only shown on cards and profiles, never used to log in).
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

// Login takes email + password and signs in directly. Usernames are
// display-only and may repeat, so they can never identify an account.
// Returns the user id from the session, so callers skip an extra getUser.
export async function signInWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const eErr = validateEmail(email);
  if (eErr) throw new Error(eErr);
  if (!password) throw new Error("Type your password.");
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw new Error(friendlyAuthError(error));
  const uid = data.session?.user?.id ?? null;
  if (!uid) throw new Error("Login worked but no user was returned.");
  return uid;
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
      "role,joined_at,household:households(id,name,invite_code,created_by,created_at,check_at)",
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

// Joins with the invite code shown to household members.
// Example: joinHouseholdByCode(c, "KX7Q2MAB12CD")
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

// Moves the weekly check slot. Only the time of day is configurable,
// the server pins it to the upcoming Sunday. Hour and minute are
// range-checked here so typos fail fast with a friendly error.
export async function setCheckTime(
  client: SupabaseClient,
  householdId: number,
  hour: number,
  minute: number,
): Promise<Household> {
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  )
    throw new Error("Pick a valid time.");
  const { data, error } = await client.rpc("set_check_time", {
    p_household_id: householdId,
    p_hour: hour,
    p_minute: minute,
  });
  if (error) throw new Error(error.message);
  return data as Household;
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
      "id,title,description,difficulty,points,status,household_id,owner,created_by,created_at,completed_at,boosted",
    )
    .eq("household_id", householdId)
    .order("created_at", { ascending: true })
    .limit(Limits.TASKS_PAGE);
  if (error) throw new Error(error.message);
  return (data ?? []) as Task[];
}

// Client-side twin of the points_match_difficulty CHECK plus the title
// length cap. Returns a friendly message or null when valid. Shared by
// createTask and the create-task form so both agree; RLS still enforces
// membership, free status, and null owner server-side.
export function validateTaskInput(input: {
  title: string;
  difficulty: TaskDifficulty;
  points: number;
}): string | null {
  const title = input.title.trim();
  if (!title) return "Type a task title.";
  if (title.length > Lengths.TASK_TITLE)
    return `Keep titles under ${Lengths.TASK_TITLE} characters.`;
  const band = PointsBands[input.difficulty];
  if (!band) return "Pick a valid difficulty.";
  if (
    !Number.isInteger(input.points) ||
    input.points < band.min ||
    input.points > band.max
  )
    return `${input.difficulty} tasks pay ${band.min}-${band.max} points.`;
  return null;
}

// Creates a free task card. Title length and the points band are checked
// here so a bad value gets a friendly error instead of a raw Postgres
// constraint violation. RLS still enforces membership, free status, and
// null owner server-side; created_by defaults to the caller in SQL.
export async function createTask(
  client: SupabaseClient,
  input: {
    householdId: number;
    title: string;
    description?: string | null;
    difficulty: TaskDifficulty;
    points: number;
  },
): Promise<Task> {
  const err = validateTaskInput({
    title: input.title,
    difficulty: input.difficulty,
    points: input.points,
  });
  if (err) throw new Error(err);
  const title = input.title.trim();
  const description = input.description?.trim() || null;
  const { data, error } = await client
    .from("tasks")
    .insert({
      household_id: input.householdId,
      title,
      description,
      difficulty: input.difficulty,
      points: input.points,
      status: "free",
      owner: null,
    })
    .select(
      "id,title,description,difficulty,points,status,household_id,owner,created_by,created_at",
    )
    .single();
  if (error) throw new Error(error.message);
  return data as Task;
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

// Writes one log row through the RPC so the owner name is stamped
// server-side from the caller account. Empty text is rejected here;
// over-long text is trimmed to the server cap of 500 chars.
export async function addLog(
  client: SupabaseClient,
  householdId: number,
  details: string,
): Promise<ActivityLog> {
  const clean = details.trim();
  if (!clean) throw new Error("Type what happened first.");
  const { data, error } = await client.rpc("log_activity", {
    p_household_id: householdId,
    p_details: clean.slice(0, 500),
  });
  if (error) throw new Error(error.message);
  return data as ActivityLog;
}

// Moves the caller's taken task into review. The server owns the
// transition (member + owner + taken checks). A lone member completes
// straight away; otherwise an approval round opens and every other
// member must confirm before points are paid.
export async function submitForReview(
  client: SupabaseClient,
  taskId: number,
): Promise<Task> {
  const { data, error } = await client.rpc("submit_for_review", {
    p_task_id: taskId,
  });
  if (error) throw new Error(error.message);
  return data as Task;
}

// Confirms a task under review. Anyone except the holder, once each;
// the last needed confirm completes the card and pays the holder.
// The server owns the counting (current members only).
export async function confirmTask(
  client: SupabaseClient,
  taskId: number,
): Promise<Task> {
  if (!Number.isInteger(taskId) || taskId <= 0)
    throw new Error("Pick a task first.");
  const { data, error } = await client.rpc("confirm_task", {
    p_task_id: taskId,
  });
  if (error) throw new Error(error.message);
  return data as Task;
}

// Rejects a task under review. One rejection is enough: the card goes
// back to taken and the round is wiped. Holder included, any member.
export async function rejectTask(
  client: SupabaseClient,
  taskId: number,
): Promise<Task> {
  if (!Number.isInteger(taskId) || taskId <= 0)
    throw new Error("Pick a task first.");
  const { data, error } = await client.rpc("reject_task", {
    p_task_id: taskId,
  });
  if (error) throw new Error(error.message);
  return data as Task;
}

// Distinct confirms on one card against the approvals needed (every
// current member except the holder). Pure, so the card note is cheap
// and unit-testable.
export function approvalProgress(
  votes: TaskVote[],
  task: Task,
  memberCount: number,
): { confirmed: number; needed: number } {
  const needed = Math.max(memberCount - (task.owner ? 1 : 0), 0);
  const confirmed = Math.min(
    new Set(
      votes.filter((v) => v.task_id === task.id).map((v) => v.profile_id),
    ).size,
    needed,
  );
  return { confirmed, needed };
}

// All current-round votes in the household. Small table by design (wiped
// on reject/complete), refetched on focus and patched live.
export async function fetchTaskVotes(
  client: SupabaseClient,
  householdId: number,
): Promise<TaskVote[]> {
  const { data, error } = await client
    .from("task_votes")
    .select("task_id,profile_id,household_id,created_at")
    .eq("household_id", householdId);
  if (error) throw new Error(error.message);
  return (data ?? []) as TaskVote[];
}

// Edit validation, shared by updateTask and the detail modal so both
// agree. Only title and description are editable; points, difficulty,
// status and owner are frozen after creation. The server re-checks
// everything (household member, not completed, title rules, plus a guard
// trigger pinning all other columns) in RLS.
export function validateTaskEdit(input: {
  title: string;
}): string | null {
  const title = input.title.trim();
  if (!title) return "Type a task title.";
  if (title.length > Lengths.TASK_TITLE)
    return `Keep titles under ${Lengths.TASK_TITLE} characters.`;
  return null;
}

// Edits a task's title and description through a direct UPDATE guarded
// by the "Members can edit open tasks" RLS policy (deliberately
// not an RPC). Zero rows back means the policy refused: not a household
// member, card completed, or task gone.
export async function updateTask(
  client: SupabaseClient,
  taskId: number,
  input: {
    title: string;
    description?: string | null;
  },
): Promise<Task> {
  if (!Number.isInteger(taskId) || taskId <= 0)
    throw new Error("Pick a task first.");
  const err = validateTaskEdit({ title: input.title });
  if (err) throw new Error(err);
  const description = input.description?.trim() ? input.description.trim() : null;
  const { data, error } = await client
    .from("tasks")
    .update({ title: input.title.trim(), description })
    .eq("id", taskId)
    .select("*");
  if (error) {
    if (error.message.includes("row-level security")) {
      throw new Error("Only household members can edit open tasks.");
    }
    throw new Error(error.message);
  }
  const saved = (data as Task[] | null)?.[0];
  if (!saved) {
    throw new Error("Only household members can edit open tasks.");
  }
  return saved;
}

// Spends one of the caller's gems to double an open card's points.
// Any member, any open card, once per card. The server owns the checks
// (member, open, not already boosted, gems balance).
export async function boostTask(
  client: SupabaseClient,
  taskId: number,
): Promise<Task> {
  if (!Number.isInteger(taskId) || taskId <= 0)
    throw new Error("Pick a task first.");
  const { data, error } = await client.rpc("boost_task", {
    p_task_id: taskId,
  });
  if (error) throw new Error(error.message);
  return data as Task;
}

// Releases a taken/in-review card back to free with no owner. Only the
// holder can do it: the guard trigger allows the status/owner move solely
// for taken/in_review -> free/NULL by the holder, and the RLS policy
// covers the resulting row. Deliberately a direct UPDATE, not an RPC.
export async function unclaimTask(
  client: SupabaseClient,
  taskId: number,
): Promise<Task> {
  if (!Number.isInteger(taskId) || taskId <= 0)
    throw new Error("Pick a task first.");
  const { data, error } = await client
    .from("tasks")
    .update({ status: "free", owner: null })
    .eq("id", taskId)
    .select("*");
  if (error) {
    if (/app actions only|row-level security/i.test(error.message)) {
      throw new Error("Only the holder can unclaim a taken card.");
    }
    throw new Error(error.message);
  }
  const saved = (data as Task[] | null)?.[0];
  if (!saved) {
    throw new Error("Only the holder can unclaim a taken card.");
  }
  return saved;
}

// Claims a free task for the caller. The server owns the transition
// (member + free checks). Direct UPDATEs are rejected by RLS ("No direct
// task updates, RPC only"), so this RPC is the only claim path.
export async function claimTask(
  client: SupabaseClient,
  taskId: number,
): Promise<Task> {
  if (!Number.isInteger(taskId) || taskId <= 0)
    throw new Error("Pick a task first.");
  const { data, error } = await client.rpc("claim_task", {
    p_task_id: taskId,
  });
  if (error) throw new Error(error.message);
  return data as Task;
}

// Completes the caller's taken/in-review task and pays its points.
// The server owns the transition (member + owner + status checks),
// same RPC-only rule as claiming.
export async function completeTask(
  client: SupabaseClient,
  taskId: number,
): Promise<Task> {
  if (!Number.isInteger(taskId) || taskId <= 0)
    throw new Error("Pick a task first.");
  const { data, error } = await client.rpc("complete_task", {
    p_task_id: taskId,
  });
  if (error) throw new Error(error.message);
  return data as Task;
}

// Deletes an unclaimed task. RLS gates this to household members on free
// cards only ("Members can delete free tasks"); taken/review/done cards
// must be unclaimed or completed instead. The button is hidden past free,
// the policy rejects the rest.
// NOTE: updates stay narrow on purpose. Title/description edits go through
// updateTask ("Members can edit open tasks" RLS policy plus a
// guard trigger pinning every other column); difficulty / points / status /
// owner cannot be changed after creation except through the move RPCs.
export async function deleteTask(
  client: SupabaseClient,
  taskId: number,
): Promise<void> {
  if (!Number.isInteger(taskId) || taskId <= 0)
    throw new Error("Pick a task first.");
  // NOTE: a denied DELETE returns zero rows with no error, so the row
  // count is the only proof anything happened. Never drop the select.
  const { data, error } = await client
    .from("tasks")
    .delete()
    .eq("id", taskId)
    .select("id");
  if (error) {
    if (/row-level security/i.test(error.message)) {
      throw new Error("Only household members can delete unclaimed tasks.");
    }
    throw new Error(error.message);
  }
  if (!data || (data as unknown[]).length === 0) {
    throw new Error("Only household members can delete unclaimed tasks.");
  }
}

// Members with public profile fields only, never emails.
export async function fetchHouseholdMembers(
  client: SupabaseClient,
  householdId: number,
): Promise<HouseholdMember[]> {
  const { data, error } = await client
    .from("household_members")
    .select(
      "household_id,profile_id,role,joined_at,profile:profiles(id,username,avatar_url,points,gems,strikes,wins)",
    )
    .eq("household_id", householdId)
    .order("joined_at", { ascending: true })
    .limit(Limits.MEMBERS_PAGE);
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
// and the homeless state cost zero queries. Long stale time plus no
// remount/focus refetch: the realtime subscription owns freshness.
export function useHouseholdTasks(
  client: SupabaseClient | null,
  householdId: number | null,
) {
  return useQuery({
    queryKey: qk.tasks(householdId),
    enabled: !!client && householdId != null,
    queryFn: () => fetchHouseholdTasks(client!, householdId!),
    staleTime: QueryCache.LIVE_STALE_TIME,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
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
    staleTime: QueryCache.LIVE_STALE_TIME,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
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
    staleTime: QueryCache.LIVE_STALE_TIME,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function useTaskVotes(
  client: SupabaseClient | null,
  householdId: number | null,
) {
  return useQuery({
    queryKey: qk.votes(householdId),
    enabled: !!client && householdId != null,
    queryFn: () => fetchTaskVotes(client!, householdId!),
    staleTime: QueryCache.LIVE_STALE_TIME,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}
