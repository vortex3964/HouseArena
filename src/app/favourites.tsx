// Favourites tab. Shows the user's starred cards (local snapshots of
// exactly how each card looked when starred), newest first, with the
// same search box as home. Starring is capped at 15 per user - the cap
// is enforced on the star toggle itself; this tab shows the live count
// and lets the user unstar from here too. Cards keep their full action
// rows (claim/review/complete/delete/remind) via the shared board hook.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFocused } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import {
  approvalProgress,
  createTask,
  submitForReview,
  useHouseholdMembers,
  useTaskVotes,
} from "../system/db";
import { Messages } from "../global/constants";
import { toMessage } from "../system/errors";
import {
  getFavourites,
  MAX_FAVOURITES,
  type FavouriteEntry,
} from "../system/favourites";
import { Colors } from "../global/theme";
import { ErrorBanner } from "../components/auth_ui";
import { TaskCard } from "../components/task_card";
import { ReminderSheet } from "../components/reminder_sheet";
import { TaskDetailModal } from "../components/task_detail_modal";
import { ConfirmDialog } from "../components/confirm_dialog";
import { useTaskBoard, variantFor } from "../components/task_board";
import type { Task } from "../system/obj_types";

export default function Favourites() {
  const { client, sessionUserId, profile, activeHousehold, dataLoading } = useAuth();

  const focused = useIsFocused();
  const householdId = activeHousehold?.household.id ?? null;
  const myId = sessionUserId ?? profile?.id ?? null;
  const membersQuery = useHouseholdMembers(client, householdId);
  const votesQuery = useTaskVotes(client, householdId);

  const {
    busy,
    actionError,
    reminders,
    reminderTask,
    setReminderTask,
    ownerLabel,
    runAction,
    onToggleFavourite,
    onUnclaim,
    onConfirm,
    onReject,
    onToggleReminder,
    onPickReminder,
    askDelete,
    pendingDelete,
    cancelDelete,
    confirmDelete,
    detailTask,
    setDetailTask,
    detailSaving,
    detailError,
    canEdit,
    saveDetailEdit,
    boosting,
    boostError,
    onBoostDetail,
  } = useTaskBoard({
    client,
    myId,
    householdId,
    members: membersQuery.data,
    detailMode: "snapshot",
  });

  const [entries, setEntries] = useState<FavouriteEntry[]>([]);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const reloadEntries = useCallback(async () => {
    if (!myId) {
      setEntries([]);
      return;
    }
    try {
      const list = await getFavourites(myId);
      list.sort((a, b) => b.favouritedAt.localeCompare(a.favouritedAt));
      setEntries(list);
      setEntriesError(null);
    } catch (e) {
      setEntriesError(toMessage(e));
    }
  }, [myId]);

  // Reload on focus so stars added/removed on the board (or deletes)
  // are reflected here, and vice versa.
  useEffect(() => {
    if (!focused) return;
    void reloadEntries();
  }, [focused, reloadEntries]);

  // Unstarring from this tab drops the row immediately.
  async function handleToggleFavourite(task: Task) {
    await onToggleFavourite(task);
    await reloadEntries();
  }

  function handleDelete(task: Task) {
    askDelete(task, () => void reloadEntries());
  }

  // "Create task" on a snapshot posts it to the board as a brand-new
  // free card (new id, no owner) for the whole household to claim.
  // Snapshot content goes as-is; the points band still applies.
  async function handleCreate(task: Task) {
    if (!client) return;
    await runAction(task, "claim", async () => {
      if (householdId == null) throw new Error(Messages.NO_ACTIVE_HOUSEHOLD);
      await createTask(client, {
        householdId,
        title: task.title,
        description: task.description,
        difficulty: task.difficulty,
        points: task.points,
      });
    });
  }

  // After an edit the hook already swapped the stored snapshot, so
  // just reload the rows to show the new title/body.
  async function handleSaveDetail(input: {
    title: string;
    description: string;
  }): Promise<boolean> {
    const saved = await saveDetailEdit(input);
    if (!saved) return false;
    await reloadEntries();
    return true;
  }

  // Search over the snapshots: title substring, case-insensitive.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.task.title.toLowerCase().includes(q));
  }, [entries, query]);

  // Approval progress for in_review snapshots, same math as home.
  function progressText(task: Task): string | null {
    if (task.status !== "in_review") return null;
    const { confirmed, needed } = approvalProgress(
      votesQuery.data ?? [],
      task,
      membersQuery.data?.length ?? 0,
    );
    if (needed <= 0) return null;
    return `Waiting on approval (${confirmed} of ${needed} confirmed).`;
  }

  if (!sessionUserId && !dataLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Log in to see your favourites.</Text>
      </View>
    );
  }
  if (dataLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const full = entries.length >= MAX_FAVOURITES;

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={Colors.muted} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search favourites…"
          placeholderTextColor={Colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query ? (
          <Pressable
            onPress={() => setQuery("")}
            hitSlop={8}
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={Colors.muted} />
          </Pressable>
        ) : null}
      </View>

      <Text style={styles.countLine}>
        {entries.length} of {MAX_FAVOURITES} saved
        {full ? " - full, unstar one to add more" : ""}
      </Text>

      {entriesError ? <ErrorBanner message={entriesError} /> : null}
      {actionError ? <ErrorBanner message={actionError} /> : null}

      <FlatList
        data={visible}
        keyExtractor={(e) => String(e.task.id)}
        // Same memoization trap as home: bell/busy live outside data.
        extraData={{ reminders, busy }}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="star" size={40} color={Colors.disabled} />
            <Text style={styles.emptyTitle}>No favourites yet</Text>
            <Text style={styles.hint}>
              {query.trim()
                ? `No matches for "${query.trim()}".`
                : "Tap the star on any card to pin it here."}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const task = item.task;
          return (
            <TaskCard
              task={task}
              variant={variantFor(task, myId)}
              ownerLabel={ownerLabel(task)}
              busy={busy?.id === task.id ? busy.action : null}
              canDelete={task.status === "free"}
              favourite
              claimLabel="Create task"
              reminderFireAt={reminders[task.id]?.fireAt ?? null}
              onClaim={() => handleCreate(task)}
              onSubmitReview={() =>
                runAction(task, "review", () => submitForReview(client!, task.id))
              }
              onUnclaim={() => onUnclaim(task)}
              onConfirm={() => onConfirm(task)}
              onReject={() => onReject(task)}
              onDelete={() => handleDelete(task)}
              onToggleFavourite={() => handleToggleFavourite(task)}
              onToggleReminder={() => onToggleReminder(task)}
              onOpen={() => setDetailTask(task)}
              reviewProgress={progressText(task)}
            />
          );
        }}
      />

      <ReminderSheet
        visible={reminderTask != null}
        taskTitle={reminderTask?.title ?? ""}
        onPick={onPickReminder}
        onClose={() => setReminderTask(null)}
      />

      <TaskDetailModal
        task={detailTask}
        ownerLabel={detailTask ? ownerLabel(detailTask) : null}
        canEdit={detailTask ? canEdit() : false}
        saving={detailSaving}
        saveError={detailError}
        onClose={() => setDetailTask(null)}
        onSave={handleSaveDetail}
        canBoost={detailTask ? canEdit() : false}
        myGems={profile?.gems ?? 0}
        boosting={boosting}
        boostError={boostError}
        onBoost={() => void onBoostDetail()}
      />

      <ConfirmDialog
        visible={pendingDelete != null}
        title="Delete task?"
        message={pendingDelete ? `"${pendingDelete.title}" goes away for everyone.` : ""}
        confirmLabel="Delete"
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDeep, paddingHorizontal: 20, paddingTop: 16 },
  center: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 8,
  },
  hint: { color: Colors.muted, fontSize: 13, textAlign: "center" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  search: { flex: 1, color: Colors.text, fontSize: 15 },
  countLine: { color: Colors.muted, fontSize: 12, marginBottom: 12 },
  list: { gap: 10, paddingBottom: 40, flexGrow: 1 },
  empty: { alignItems: "center", gap: 8, paddingTop: 48, paddingHorizontal: 24 },
  emptyTitle: { color: Colors.text, fontSize: 17, fontWeight: "800" },
});
