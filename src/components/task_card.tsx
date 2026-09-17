// One kanban card for the home board. Status accent on the left edge,
// points chip on top, owner/difficulty hints below, and per-lane action
// buttons with busy guards. Tapping the card body opens the magnified
// detail view (title/description edits live there, via RLS-guarded update).

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import type { Task, TaskStatus } from "../system/obj_types";

export type TaskCardAction = "claim" | "review" | "complete" | "unclaim" | "delete" | "favourite" | "reminder";
export type TaskCardVariant = "available" | "claimed" | "review" | "done";

const STATUS_ACCENT: Record<TaskStatus, string> = {
  free: Colors.info,
  taken: Colors.warning,
  in_review: Colors.mauve,
  completed: Colors.success,
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  free: "Free",
  taken: "Taken",
  in_review: "In review",
  completed: "Done",
};

// Short "Tue 18:30" label for a scheduled reminder, never crashes
// on bad input (falls back to an empty string, hiding the note).
function formatReminder(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString([], { weekday: "short" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

function SmallButton({
  title,
  icon,
  onPress,
  loading,
  disabled,
  tone = "primary",
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: "primary" | "soft" | "danger";
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.btn,
        tone === "primary" && styles.btnPrimary,
        tone === "soft" && styles.btnSoft,
        tone === "danger" && styles.btnDanger,
        off && styles.btnOff,
        pressed && !off && styles.btnPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tone === "primary" ? Colors.onPrimary : Colors.text} />
      ) : (
        <Ionicons
          name={icon}
          size={15}
          color={tone === "primary" ? Colors.onPrimary : Colors.text}
        />
      )}
      <Text
        style={[
          styles.btnText,
          tone === "primary" && styles.btnTextPrimary,
        ]}
      >
        {loading ? "Working…" : title}
      </Text>
    </Pressable>
  );
}

export function TaskCard({
  task,
  variant,
  ownerLabel,
  busy,
  canDelete,
  favourite,
  reminderFireAt,
  onClaim,
  onSubmitReview,
  onComplete,
  onUnclaim,
  onDelete,
  onToggleFavourite,
  onToggleReminder,
  onOpen,
}: {
  task: Task;
  variant: TaskCardVariant;
  // "You", a housemate name, or null for free cards.
  ownerLabel: string | null;
  // Which action on THIS card is in flight (null when idle).
  busy: TaskCardAction | null;
  // True for free cards only: members can delete unclaimed tasks, and
  // the server rejects deletes on taken/review/done cards regardless.
  canDelete: boolean;
  favourite: boolean;
  // ISO date of the scheduled reminder, null when none set.
  reminderFireAt: string | null;
  onClaim: () => void;
  onSubmitReview: () => void;
  onComplete: () => void;
  onUnclaim: () => void;
  onDelete: () => void;
  onToggleFavourite: () => void;
  onToggleReminder: () => void;
  // Opens the magnified detail view for this card.
  onOpen: () => void;
}) {
  const accent = STATUS_ACCENT[task.status];
  const locked = busy != null;
  const reminderLabel = reminderFireAt ? formatReminder(reminderFireAt) : "";

  return (
    <Pressable
      onPress={onOpen}
      accessibilityLabel={`Open ${task.title}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={styles.statusPill}>
            <View style={[styles.dot, { backgroundColor: accent }]} />
            <Text style={styles.statusText}>{STATUS_LABEL[task.status]}</Text>
          </View>
          <View style={styles.pointsChip}>
            <Ionicons name="star" size={13} color={Colors.peach} />
            <Text style={styles.pointsText}>{task.points} pts</Text>
          </View>
        </View>

        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {task.title}
          </Text>
          <Pressable
            onPress={onToggleFavourite}
            disabled={locked}
            accessibilityLabel={favourite ? "Remove favourite" : "Mark favourite"}
            hitSlop={10}
            style={({ pressed }) => [
              styles.iconBtn,
              locked && styles.btnOff,
              pressed && !locked && styles.btnPressed,
            ]}
          >
            {busy === "favourite" ? (
              <ActivityIndicator size="small" color={Colors.warning} />
            ) : (
              <Ionicons
                name={favourite ? "star" : "star-outline"}
                size={20}
                color={favourite ? Colors.warning : Colors.muted}
              />
            )}
          </Pressable>
        </View>
        {task.description ? (
          <Text style={styles.desc} numberOfLines={3}>
            {task.description}
          </Text>
        ) : null}
        {reminderLabel ? (
          <View style={styles.hint}>
            <Ionicons name="alarm" size={13} color={Colors.info} />
            <Text style={styles.hintText}>
              {reminderLabel}
            </Text>
          </View>
        ) : null}

        <View style={styles.hints}>
          <View style={styles.hint}>
            <Ionicons name="speedometer" size={13} color={Colors.muted} />
            <Text style={styles.hintText}>{task.difficulty}</Text>
          </View>
          {ownerLabel ? (
            <View style={styles.hint}>
              <Ionicons name="person" size={13} color={Colors.muted} />
              <Text style={styles.hintText} numberOfLines={1}>
                {ownerLabel}
              </Text>
            </View>
          ) : null}
        </View>

        {variant === "claimed" && task.status === "in_review" ? (
          <Text style={styles.note}>Waiting on review - you can still complete it.</Text>
        ) : null}
        {variant === "review" ? (
          <Text style={styles.note}>
            {ownerLabel ?? "A housemate"} is waiting on review - only they can complete it.
          </Text>
        ) : null}
        {variant === "done" ? (
          <Text style={styles.note}>+{task.points} pts to {ownerLabel ?? "a housemate"}.</Text>
        ) : null}

        <View style={styles.actions}>
          {variant === "available" ? (
            <SmallButton
              title="Claim"
              icon="bookmark"
              onPress={onClaim}
              loading={busy === "claim"}
              disabled={locked}
            />
          ) : null}
          {variant === "claimed" && task.status === "taken" ? (
            <>
              <SmallButton
                title="For review"
                icon="send"
                onPress={onSubmitReview}
                loading={busy === "review"}
                disabled={locked}
              />
              <SmallButton
                title="Unclaim"
                icon="arrow-undo"
                tone="soft"
                onPress={onUnclaim}
                loading={busy === "unclaim"}
                disabled={locked}
              />
            </>
          ) : null}
          {variant === "claimed" && task.status === "in_review" ? (
            <>
              <SmallButton
                title="Complete"
                icon="checkmark-done"
                onPress={onComplete}
                loading={busy === "complete"}
                disabled={locked}
              />
              <SmallButton
                title="Unclaim"
                icon="arrow-undo"
                tone="soft"
                onPress={onUnclaim}
                loading={busy === "unclaim"}
                disabled={locked}
              />
            </>
          ) : null}
          {canDelete ? (
            <Pressable
              onPress={onDelete}
              disabled={locked}
              accessibilityLabel={`Delete ${task.title}`}
              hitSlop={10}
              style={({ pressed }) => [
                styles.trash,
                locked && styles.btnOff,
                pressed && !locked && styles.btnPressed,
              ]}
            >
              {busy === "delete" ? (
                <ActivityIndicator size="small" color={Colors.danger} />
              ) : (
                <Ionicons name="trash-outline" size={17} color={Colors.danger} />
              )}
            </Pressable>
          ) : null}
          <Pressable
            onPress={onToggleReminder}
            disabled={locked}
            accessibilityLabel={
              reminderFireAt ? "Cancel reminder" : "Set reminder"
            }
            hitSlop={10}
            style={({ pressed }) => [
              styles.iconBtnBox,
              locked && styles.btnOff,
              pressed && !locked && styles.btnPressed,
            ]}
          >
            {busy === "reminder" ? (
              <ActivityIndicator size="small" color={Colors.info} />
            ) : (
              <Ionicons
                name={reminderFireAt ? "alarm" : "alarm-outline"}
                size={17}
                color={reminderFireAt ? Colors.info : Colors.muted}
              />
            )}
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 18,
    overflow: "hidden",
  },
  accent: { width: 5 },
  cardPressed: { opacity: 0.85 },
  body: { flex: 1, padding: 14, gap: 8 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: Colors.subtext1, fontSize: 12, fontWeight: "700" },
  pointsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pointsText: { color: Colors.text, fontSize: 12, fontWeight: "800" },
  title: { color: Colors.text, fontSize: 16, fontWeight: "800", flex: 1 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  iconBtn: { padding: 2 },
  desc: { color: Colors.subtext0, fontSize: 13 },
  hints: { flexDirection: "row", alignItems: "center", gap: 12 },
  hint: { flexDirection: "row", alignItems: "center", gap: 5 },
  hintText: { color: Colors.muted, fontSize: 12, fontWeight: "600" },
  note: { color: Colors.muted, fontSize: 12, fontStyle: "italic" },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
  },
  btnPrimary: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  btnSoft: {
    backgroundColor: Colors.bg,
    borderColor: Colors.border,
  },
  btnDanger: {
    backgroundColor: "rgba(243,139,168,0.10)",
    borderColor: "rgba(243,139,168,0.35)",
  },
  btnOff: { opacity: 0.5 },
  btnPressed: { opacity: 0.8 },
  btnText: { color: Colors.text, fontSize: 13, fontWeight: "700" },
  btnTextPrimary: { color: Colors.onPrimary },
  trash: {
    marginLeft: "auto",
    borderWidth: 1,
    borderColor: "rgba(243,139,168,0.35)",
    backgroundColor: "rgba(243,139,168,0.08)",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  iconBtnBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
});
