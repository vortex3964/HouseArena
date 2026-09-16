import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { qk, queryClient } from "./db";
import type {
  ActivityLog,
  Household,
  HouseholdMember,
  MyHousehold,
  Task,
} from "./obj_types";

// Upsert helpers, everything merges by id so realtime never refetches.
function upsertById<T extends { id: number }>(list: T[], row: T): T[] {
  const i = list.findIndex((r) => r.id === row.id);
  if (i === -1) return [...list, row];
  const next = [...list];
  next[i] = { ...next[i], ...row };
  return next;
}

function removeById<T extends { id: number }>(list: T[], id: number): T[] {
  return list.filter((r) => r.id !== id);
}

// One channel per active household, three filtered bindings on it
// (tasks, members, household meta). Logs have their own hook below so
// the feed is tracked only while its tab is open.
// Every payload writes straight into the TanStack cache, zero SELECTs,
// except a new member join which refetches once to get their profile.
export function useLiveHousehold(
  client: SupabaseClient | null,
  userId: string | null,
  householdId: number | null,
) {
  useEffect(() => {
    if (!client || householdId == null) return;

    const tasksKey = qk.tasks(householdId);
    const membersKey = qk.members(householdId);

    const channel = client
      .channel(`household-${householdId}`)
      // Task cards: append, merge edits, drop deletes, oldest first.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tasks",
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id: number }).id;
            queryClient.setQueryData<Task[]>(tasksKey, (old) =>
              old ? removeById(old, id) : old,
            );
            return;
          }
          const row = payload.new as Task;
          queryClient.setQueryData<Task[]>(tasksKey, (old) => {
            const next = upsertById(old ?? [], row);
            next.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
            return next;
          });
        },
      )
      // Members: role edits and leaves patch directly. A fresh join
      // refetches once because the payload carries no profile row.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "household_members",
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const left = payload.old as { profile_id: string };
            queryClient.setQueryData<HouseholdMember[]>(
              membersKey,
              (old) =>
                old?.filter((m) => m.profile_id !== left.profile_id) ?? old,
            );
            return;
          }
          const row = payload.new as HouseholdMember;
          if (payload.eventType === "INSERT") {
            queryClient.invalidateQueries({ queryKey: membersKey });
            return;
          }
          queryClient.setQueryData<HouseholdMember[]>(membersKey, (old) =>
            (old ?? []).map((m) =>
              m.profile_id === row.profile_id ? { ...m, ...row } : m,
            ),
          );
        },
      )
      // Household meta (name, check date): patched into our list.
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "households",
          filter: `id=eq.${householdId}`,
        },
        (payload) => {
          if (!userId) return;
          if (payload.eventType === "DELETE") {
            queryClient.setQueryData<MyHousehold[]>(
              qk.myHouseholds(userId),
              (old) =>
                old?.filter((m) => m.household.id !== householdId) ?? old,
            );
            return;
          }
          const row = payload.new as Household;
          queryClient.setQueryData<MyHousehold[]>(
            qk.myHouseholds(userId),
            (old) =>
              old?.map((m) =>
                m.household.id === householdId
                  ? { ...m, household: { ...m.household, ...row } }
                  : m,
              ) ?? old,
          );
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [client, userId, householdId]);
}

// Activity feed on its own channel, owned by the logs tab only.
// Mount it with a household id while focused, with null otherwise:
// subscribing starts tracking, cleanup stops it, zero cost off-tab.
// Newest on top, trimmed like the prune cap, zero SELECTs.
export function useLiveLogs(
  client: SupabaseClient | null,
  householdId: number | null,
) {
  useEffect(() => {
    if (!client || householdId == null) return;

    const logsKey = qk.logs(householdId);

    const channel = client
      .channel(`logs-${householdId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "activity_logs",
          filter: `household_id=eq.${householdId}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id: number }).id;
            queryClient.setQueryData<ActivityLog[]>(logsKey, (old) =>
              old ? removeById(old, id) : old,
            );
            return;
          }
          const row = payload.new as ActivityLog;
          queryClient.setQueryData<ActivityLog[]>(logsKey, (old) =>
            upsertById(old ?? [], row)
              .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
              .slice(0, 30),
          );
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [client, householdId]);
}
