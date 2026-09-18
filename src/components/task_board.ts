// Shared card-action logic for the board screens (home + favourites).
// Owns the per-user local state (favourites, reminders), the busy guard,
// and the server mutations (claim/submit/complete/delete) so both tabs
// behave identically. Local state reloads on focus, so starring or
// reminding on one tab is reflected when the other is opened.
import { useEffect, useMemo, useRef, useState } from "react";
import { useIsFocused } from "expo-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  boostTask,
  confirmTask,
  deleteTask,
  qk,
  queryClient,
  rejectTask,
  unclaimTask,
  updateTask,
} from "../system/db";
import { toMessage } from "../system/errors";
import {
  starTask,
  toggleFavourite,
  updateFavouriteSnapshot,
} from "../system/favourites";
import {
  cancelTaskReminder,
  getReminders,
  scheduleTaskReminder,
  type ReminderEntry,
} from "../system/reminders";
import type { HouseholdMember, Task } from "../system/obj_types";
import type { TaskCardAction, TaskCardVariant } from "./task_card";

// Maps a task's status to the card variant (which action row it shows).
// Others' taken cards show the claimed row; the RPCs enforce ownership
// server-side and rejections surface in the action error banner.
export function variantFor(task: Task, myId: string | null): TaskCardVariant {
  if (task.status === "completed") return "done";
  if (task.status === "in_review") return task.owner === myId ? "claimed" : "review";
  if (task.status === "taken") return "claimed";
  return "available";
}

type BoardArgs = {
  client: SupabaseClient | null;
  myId: string | null;
  householdId: number | null;
  members: HouseholdMember[] | undefined;
  // "server": detail edits write the board row (home). "snapshot": detail
  // edits rewrite only the frozen favourite copy (favourites tab). The two
  // memories never sync: a board edit leaves snapshots frozen and a
  // snapshot edit leaves the board untouched.
  detailMode: "server" | "snapshot";
};

export function useTaskBoard({ client, myId, householdId, members, detailMode }: BoardArgs) {
  const focused = useIsFocused();
  const [busy, setBusy] = useState<{ id: number; action: TaskCardAction } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reminders, setReminders] = useState<Record<number, ReminderEntry>>({});
  const [reminderTask, setReminderTask] = useState<Task | null>(null);
  const [detailTask, setDetailTask] = useState<Task | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [boosting, setBoosting] = useState(false);
  const [boostError, setBoostError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Toast timer never outlives the screen.
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  function flashToast(message: string, ms = 1400) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, ms);
  }

  // A failed save must not haunt the next card opened in the modal.
  const detailId = detailTask?.id ?? null;
  useEffect(() => {
    setDetailError(null);
    setBoostError(null);
  }, [detailId]);

  // Reminders are per-user local state, reloaded on account switch and
  // every time the screen gains focus (cross-tab consistency). Starred
  // state is never mirrored here: every check reads the favourites store
  // (the persisted map) directly, so it cannot go stale. No backend
  // calls involved.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!focused || !myId) {
        if (!myId) setReminders({});
        return;
      }
      const rems = await getReminders(myId);
      if (alive) setReminders(rems);
    })();
    return () => {
      alive = false;
    };
  }, [focused, myId]);

  // profile_id -> username for the owner hints. Falls back to "You"
  // for our own cards and "Housemate" when the member row is missing.
  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) {
      if (m.profile?.username) map.set(m.profile_id, m.profile.username);
    }
    return map;
  }, [members]);

  function ownerLabel(task: Task): string | null {
    if (!task.owner) return null;
    if (myId && task.owner === myId) return "You";
    return nameById.get(task.owner) ?? "Housemate";
  }

  async function refreshTasks() {
    if (householdId != null) {
      await queryClient.invalidateQueries({ queryKey: qk.tasks(householdId) });
    }
  }

  async function refreshVotes() {
    if (householdId != null) {
      await queryClient.invalidateQueries({ queryKey: qk.votes(householdId) });
    }
  }

  // One in-flight action at a time per card (busy guard, no double-submit).
  // Other cards stay usable while one works. Local-only toggles skip the
  // refetch; server mutations refresh the list.
  async function runAction(
    task: Task,
    action: TaskCardAction,
    fn: () => Promise<unknown>,
    refetch = true,
  ) {
    if (!client || (busy && busy.id === task.id)) return;
    setBusy({ id: task.id, action });
    setActionError(null);
    try {
      await fn();
      if (refetch) await refreshTasks();
    } catch (e) {
      setActionError(toMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function onToggleFavourite(task: Task) {
    if (!myId) return;
    await runAction(
      task,
      "favourite",
      async () => {
        await toggleFavourite(myId, task);
      },
      false,
    );
  }

  // Home-only starring: the home star is always outline, tapping it saves
  // the card (or refreshes its snapshot when already starred) and flashes
  // a toast. Starred state comes exclusively from the persisted map inside
  // starTask, never from component memory.
  async function onAddFavourite(task: Task) {
    if (!myId) return;
    await runAction(
      task,
      "favourite",
      async () => {
        await starTask(myId, task);
        flashToast("Task starred successfully.");
      },
      false,
    );
  }

  async function onUnclaim(task: Task) {
    if (!client) return;
    await runAction(task, "unclaim", () => unclaimTask(client, task.id));
  }

  // Review votes refresh both caches: the card may complete (tasks) and
  // the counts always move (votes). Errors stay in the action banner.
  async function onConfirm(task: Task) {
    if (!client) return;
    await runAction(task, "confirm", () => confirmTask(client, task.id));
    await refreshVotes();
  }

  async function onReject(task: Task) {
    if (!client) return;
    await runAction(task, "reject", () => rejectTask(client, task.id));
    await refreshVotes();
  }

  async function onToggleReminder(task: Task) {
    if (!myId) return;
    if (reminders[task.id]) {
      await runAction(
        task,
        "reminder",
        async () => {
          await cancelTaskReminder(myId, task.id);
          setReminders((r) => {
            if (!(task.id in r)) return r;
            const next = { ...r };
            delete next[task.id];
            return next;
          });
        },
        false,
      );
    } else {
      setReminderTask(task);
    }
  }

  async function onPickReminder(date: Date) {
    const task = reminderTask;
    setReminderTask(null);
    if (!task || !myId) return;
    await runAction(
      task,
      "reminder",
      async () => {
        const entry = await scheduleTaskReminder(myId, task, date);
        setReminders((r) => ({ ...r, [task.id]: entry }));
      },
      false,
    );
  }

  // Deletes the board task only. Local copies are independent memory:
  // favourited snapshots and reminders survive, and are managed from
  // the favourites tab and the bell toggle instead. Confirmation is an
  // in-app dialog (Alert.alert is a no-op on web): askDelete stages the
  // task, the screen renders ConfirmDialog, confirmDelete runs it.
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const pendingDeleteAfter = useRef<(() => void) | null>(null);

  function askDelete(task: Task, after?: () => void) {
    if (busy || !client) return;
    setPendingDelete(task);
    pendingDeleteAfter.current = after ?? null;
  }

  function cancelDelete() {
    setPendingDelete(null);
    pendingDeleteAfter.current = null;
  }

  async function confirmDelete() {
    const task = pendingDelete;
    const after = pendingDeleteAfter.current;
    setPendingDelete(null);
    pendingDeleteAfter.current = null;
    if (!task) return;
    await runAction(task, "delete", async () => {
      await deleteTask(client!, task.id);
      after?.();
    });
  }

  // Every household member can edit and delete tasks; the server owns
  // the rules (open cards only for edits). Completed cards stay frozen
  // even then (the modal hides the edit button).
  function canEdit(): boolean {
    return myId != null;
  }

  // Gem boost from the detail modal: spends one of your gems through
  // boost_task and swaps the open detail to the doubled row. Realtime
  // plus an explicit refetch keep the board and gem counts right.
  async function onBoostDetail(): Promise<void> {
    const task = detailTask;
    if (!task || !client || boosting) return;
    setBoosting(true);
    setBoostError(null);
    try {
      const fresh = await boostTask(client, task.id);
      await refreshTasks();
      setDetailTask(fresh);
    } catch (e) {
      setBoostError(toMessage(e));
    } finally {
      setBoosting(false);
    }
  }
  // Saves a title/description edit from the detail modal. In server mode
  // it writes the board row and refreshes the list; in snapshot mode it
  // rewrites only the frozen favourite copy. Either way the open detail
  // swaps to the saved copy. Returns it on success, null on failure.
  async function saveDetailEdit(input: {
    title: string;
    description: string;
  }): Promise<Task | null> {
    const task = detailTask;
    if (!task || !client || detailSaving) return null;
    setDetailSaving(true);
    setDetailError(null);
    try {
      if (detailMode === "snapshot") {
        if (!myId) return null;
        const list = await updateFavouriteSnapshot(myId, task.id, input);
        const updated = list.find((e) => e.task.id === task.id)?.task ?? null;
        if (updated) setDetailTask(updated);
        return updated;
      }
      const fresh = await updateTask(client, task.id, {
        title: input.title,
        description: input.description,
      });
      await refreshTasks();
      setDetailTask(fresh);
      return fresh;
    } catch (e) {
      setDetailError(toMessage(e));
      return null;
    } finally {
      setDetailSaving(false);
    }
  }

  return {
    busy,
    actionError,
    toast,
    reminders,
    reminderTask,
    setReminderTask,
    detailTask,
    setDetailTask,
    detailSaving,
    detailError,
    ownerLabel,
    canEdit,
    refreshTasks,
    runAction,
    onToggleFavourite,
    onAddFavourite,
    onUnclaim,
    onConfirm,
    onReject,
    onToggleReminder,
    onPickReminder,
    saveDetailEdit,
    boosting,
    boostError,
    onBoostDetail,
    askDelete,
    pendingDelete,
    cancelDelete,
    confirmDelete,
  };
}
