// Task-centered kanban home. Four in-screen tabs (NOT expo-router Tabs,
// the drawer + AuthGate stay untouched) over the cached board query:
// Available = free cards, Claimed = my taken/in-review cards,
// Review = others' in-review cards, Done = completed cards.
// Search filters the cache client-side (zero extra queries). Status moves
// go through the claim/submit RPCs; review completes by unanimous member
// confirm (single members auto-complete), rejects send cards back to work.
// Deletes are member-open on free cards only.
// Realtime comes from the app-wide useLiveHousehold in _layout - this
// screen only reads the TanStack cache and invalidates after mutations.

import { useMemo, useState } from "react";
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
import { useAuth } from "../system/AuthProvider";
import {
  approvalProgress,
  claimTask,
  submitForReview,
  useHouseholdMembers,
  useHouseholdTasks,
  useTaskVotes,
} from "../system/db";
import { toMessage } from "../system/errors";
import { Colors } from "../global/theme";
import { ErrorBanner, PrimaryButton } from "../components/auth_ui";
import { TaskCard } from "../components/task_card";
import { ReminderSheet } from "../components/reminder_sheet";
import { TaskDetailModal } from "../components/task_detail_modal";
import { useTaskBoard } from "../components/task_board";
import { TaskCreateModal } from "../components/task_create_modal";
import { ConfirmDialog } from "../components/confirm_dialog";
import { Toast } from "../components/toast";
import type { Task } from "../system/obj_types";

type TabId = "available" | "claimed" | "review" | "done";

const TABS: Array<{ id: TabId; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "available", label: "Available", icon: "sparkles" },
  { id: "claimed", label: "Claimed", icon: "bookmark" },
  { id: "review", label: "Review", icon: "eye" },
  { id: "done", label: "Done", icon: "checkmark-done" },
];

const EMPTY_TITLE: Record<TabId, string> = {
  available: "No free tasks",
  claimed: "Nothing claimed",
  review: "Nothing in review",
  done: "Nothing done yet",
};

const EMPTY_HINT: Record<TabId, string> = {
  available: "Tap + to create the first card.",
  claimed: "Grab a card from Available to get started.",
  review: "Cards others send for review land here.",
  done: "Completed cards land here with their points.",
};

export default function Home() {
  const {
    client,
    sessionUserId,
    profile,
    activeHousehold,
    dataLoading,
    dataError,
    refreshSessionData,
  } = useAuth();

  const householdId = activeHousehold?.household.id ?? null;
  const myId = sessionUserId ?? profile?.id ?? null;

  const tasksQuery = useHouseholdTasks(client, householdId);
  const membersQuery = useHouseholdMembers(client, householdId);
  const votesQuery = useTaskVotes(client, householdId);

  const [tab, setTab] = useState<TabId>("available");
  const [queries, setQueries] = useState<Record<TabId, string>>({
    available: "",
    claimed: "",
    review: "",
    done: "",
  });
  const [createOpen, setCreateOpen] = useState(false);

  // Card state + actions (favourites, reminders, claim/submit/complete/
  // delete) live in the shared board hook so the favourites tab behaves
  // identically.
  const {
    busy,
    actionError,
    toast,
    reminders,
    reminderTask,
    setReminderTask,
    ownerLabel,
    refreshTasks,
    runAction,
    onAddFavourite,
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
  } = useTaskBoard({
    client,
    myId,
    householdId,
    members: membersQuery.data,
    detailMode: "server",
  });

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);

  const base = useMemo(() => {
    const available = tasks.filter((t) => t.status === "free");
    const claimed = tasks.filter(
      (t) =>
        myId != null &&
        t.owner === myId &&
        (t.status === "taken" || t.status === "in_review"),
    );
    const review = tasks.filter(
      (t) => t.status === "in_review" && t.owner !== myId,
    );
    const done = tasks.filter((t) => t.status === "completed");
    return { available, claimed, review, done } satisfies Record<TabId, Task[]>;
  }, [tasks, myId]);

  // Per-tab search over the cached rows: title substring, case-insensitive.
  const visible = useMemo(() => {
    const q = queries[tab].trim().toLowerCase();
    if (!q) return base[tab];
    return base[tab].filter((t) => t.title.toLowerCase().includes(q));
  }, [base, queries, tab]);

  // Approval progress for in_review cards ("1 of 2 confirmed"), from the
  // live votes cache. Null outside review.
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

  // Defensive only: AuthGate redirects logged-out users, but the screen
  // must never crash on null profile/household.
  if (!sessionUserId && !dataLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Log in to see your household board.</Text>
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
  if (!activeHousehold) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Join or create a household first.</Text>
        {dataError ? (
          <View style={styles.retryBox}>
            <ErrorBanner message={dataError} />
            <PrimaryButton title="Retry" onPress={() => refreshSessionData()} />
          </View>
        ) : null}
      </View>
    );
  }

  const search = queries[tab];

  return (
    <View style={styles.screen}>
      {dataError ? <ErrorBanner message={dataError} /> : null}

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={Colors.muted} />
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={(v) => setQueries((q) => ({ ...q, [tab]: v }))}
          placeholder={`Search ${TABS.find((t) => t.id === tab)?.label.toLowerCase()}…`}
          placeholderTextColor={Colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search ? (
          <Pressable
            onPress={() => setQueries((q) => ({ ...q, [tab]: "" }))}
            hitSlop={8}
            accessibilityLabel="Clear search"
          >
            <Ionicons name="close-circle" size={18} color={Colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {actionError ? <ErrorBanner message={actionError} /> : null}

      {tasksQuery.isLoading ? (
        <View style={styles.listCenter}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : tasksQuery.isError ? (
        <View style={styles.listCenter}>
          <ErrorBanner message={toMessage(tasksQuery.error)} />
          <PrimaryButton title="Retry" onPress={() => tasksQuery.refetch()} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(t) => String(t.id)}
          // Rows memoize on data alone: bell/busy live outside it,
          // so they must be listed here or the rows never repaint.
          // (The star is a constant outline here, no state needed.)
          extraData={{ reminders, busy }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshing={tasksQuery.isRefetching}
          onRefresh={() => tasksQuery.refetch()}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons
                name={tab === "done" ? "trophy" : "file-tray"}
                size={40}
                color={Colors.disabled}
              />
              <Text style={styles.emptyTitle}>{EMPTY_TITLE[tab]}</Text>
              <Text style={styles.hint}>
                {search.trim()
                  ? `No matches for "${search.trim()}".`
                  : EMPTY_HINT[tab]}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TaskCard
              task={item}
              variant={tab}
              ownerLabel={ownerLabel(item)}
              busy={busy?.id === item.id ? busy.action : null}
              canDelete={item.status === "free"}
              // Home stars only: always outline, tapping saves. Unstarring
              // lives in the favourites tab.
              favourite={false}
              reminderFireAt={reminders[item.id]?.fireAt ?? null}
              onClaim={() => runAction(item, "claim", () => claimTask(client!, item.id))}
              onSubmitReview={() =>
                runAction(item, "review", () => submitForReview(client!, item.id))
              }
              onUnclaim={() => onUnclaim(item)}
              onConfirm={() => onConfirm(item)}
              onReject={() => onReject(item)}
              onDelete={() => askDelete(item)}
              onToggleFavourite={() => onAddFavourite(item)}
              onToggleReminder={() => onToggleReminder(item)}
              onOpen={() => setDetailTask(item)}
              reviewProgress={progressText(item)}
            />
          )}
        />
      )}

      <View style={styles.tabbar}>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              accessibilityLabel={`${t.label} tab`}
              style={({ pressed }) => [
                styles.tab,
                active && styles.tabActive,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={t.icon}
                size={20}
                color={active ? Colors.primary : Colors.muted}
              />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
                {t.label}
              </Text>
              <View style={[styles.count, active && styles.countActive]}>
                <Text style={[styles.countText, active && styles.countTextActive]}>
                  {base[t.id].length}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={() => setCreateOpen(true)}
        accessibilityLabel="Create task"
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Ionicons name="add" size={30} color={Colors.onPrimary} />
      </Pressable>

      <TaskCreateModal
        visible={createOpen}
        client={client}
        householdId={householdId}
        onClose={() => setCreateOpen(false)}
        onCreated={() => refreshTasks()}
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
        onSave={async (input) => (await saveDetailEdit(input)) != null}
      />

      <Toast message={toast} />

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
  retryBox: { width: "100%", gap: 10, marginTop: 8 },
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
    marginBottom: 12,
  },
  search: { flex: 1, color: Colors.text, fontSize: 15 },
  list: { gap: 10, paddingBottom: 100, flexGrow: 1 },
  listCenter: { flex: 1, alignItems: "stretch", justifyContent: "center", gap: 12, paddingBottom: 100 },
  empty: { alignItems: "center", gap: 8, paddingTop: 48, paddingHorizontal: 24 },
  emptyTitle: { color: Colors.text, fontSize: 17, fontWeight: "800" },
  hint: { color: Colors.muted, fontSize: 13, textAlign: "center" },
  tabbar: {
    flexDirection: "row",
    backgroundColor: Colors.mantle,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    padding: 6,
    gap: 2,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    borderRadius: 14,
    paddingVertical: 8,
  },
  tabActive: { backgroundColor: Colors.primarySoft },
  tabLabel: { color: Colors.muted, fontSize: 11, fontWeight: "700" },
  tabLabelActive: { color: Colors.primary },
  count: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  countActive: { borderColor: Colors.borderStrong },
  countText: { color: Colors.muted, fontSize: 11, fontWeight: "800" },
  countTextActive: { color: Colors.text },
  fab: {
    position: "absolute",
    right: 20,
    bottom: 104,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  pressed: { opacity: 0.8 },
});
