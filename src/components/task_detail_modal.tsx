// Magnified task view. Tapping a card opens this modal with the full
// title and description as plain text. The pencil button switches to
// edit mode (title + body); saving goes through the RLS-guarded update via
// onSave. Below it sits the gem boost: one of your gems doubles the
// card's points through the boost_task RPC. Every household member sees
// both buttons, completed or already-boosted cards show neither.
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { Lengths } from "../global/constants";
import { ErrorBanner, PrimaryButton } from "./auth_ui";
import type { Task, TaskStatus } from "../system/obj_types";

const STATUS_LABEL: Record<TaskStatus, string> = {
  free: "Free",
  taken: "Taken",
  in_review: "In review",
  completed: "Done",
};

export function TaskDetailModal({
  task,
  ownerLabel,
  canEdit,
  saving,
  saveError,
  onClose,
  onSave,
  canBoost,
  myGems,
  boosting,
  boostError,
  onBoost,
}: {
  task: Task | null;
  ownerLabel: string | null;
  // True for any signed-in household member.
  canEdit: boolean;
  saving: boolean;
  saveError: string | null;
  onClose: () => void;
  // Truthy on success so the modal can leave edit mode.
  onSave: (input: { title: string; description: string }) => Promise<unknown>;
  // Same membership rule as editing. The modal hides the button for
  // completed or already-boosted cards on top of this.
  canBoost: boolean;
  myGems: number;
  boosting: boolean;
  boostError: string | null;
  onBoost: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Fresh drafts every time a task is opened or the edit starts.
  useEffect(() => {
    setEditing(false);
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
  }, [task?.id]);

  async function save() {
    const saved = await onSave({ title, description });
    if (saved) setEditing(false);
  }

  const editable = canEdit && task != null && task.status !== "completed";
  const boostable =
    canBoost && task != null && task.status !== "completed" && !task.boosted;

  return (
    <Modal
      visible={task != null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          {task ? (
            <>
              <View style={styles.topRow}>
                <View style={styles.statusPill}>
                  <Text style={styles.statusText}>{STATUS_LABEL[task.status]}</Text>
                </View>
                <View style={styles.pointsChip}>
                  <Ionicons name="star" size={14} color={Colors.peach} />
                  <Text style={styles.pointsText}>{task.points} pts</Text>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityLabel="Close details"
                  hitSlop={10}
                  style={styles.iconBtn}
                >
                  <Ionicons name="close" size={22} color={Colors.muted} />
                </Pressable>
              </View>

              {editing ? (
                <>
                  <Text style={styles.label}>Title</Text>
                  <TextInput
                    style={styles.input}
                    value={title}
                    onChangeText={setTitle}
                    maxLength={Lengths.TASK_TITLE}
                    autoCapitalize="sentences"
                    returnKeyType="next"
                  />
                  <Text style={styles.label}>Description</Text>
                  <TextInput
                    style={[styles.input, styles.bodyInput]}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    textAlignVertical="top"
                    autoCapitalize="sentences"
                    placeholder="What needs doing?"
                    placeholderTextColor={Colors.muted}
                  />
                  {saveError ? <ErrorBanner message={saveError} /> : null}
                  <View style={styles.row}>
                    <View style={styles.flex}>
                      <PrimaryButton
                        title="Cancel"
                        onPress={() => {
                          setEditing(false);
                          setTitle(task.title);
                          setDescription(task.description ?? "");
                        }}
                      />
                    </View>
                    <View style={styles.flex}>
                      <PrimaryButton
                        title="Save"
                        onPress={() => void save()}
                        loading={saving}
                      />
                    </View>
                  </View>
                </>
              ) : (
                <ScrollView
                  style={styles.scroll}
                  contentContainerStyle={styles.scrollBody}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.bigTitle}>{task.title}</Text>
                  {task.description ? (
                    <Text style={styles.desc}>{task.description}</Text>
                  ) : (
                    <Text style={styles.noDesc}>No description.</Text>
                  )}
                  <View style={styles.meta}>
                    <View style={styles.metaItem}>
                      <Ionicons name="speedometer" size={14} color={Colors.muted} />
                      <Text style={styles.metaText}>{task.difficulty}</Text>
                    </View>
                    {ownerLabel ? (
                      <View style={styles.metaItem}>
                        <Ionicons name="person" size={14} color={Colors.muted} />
                        <Text style={styles.metaText}>{ownerLabel}</Text>
                      </View>
                    ) : null}
                  </View>
                </ScrollView>
              )}

              {!editing && editable ? (
                <Pressable
                  onPress={() => {
                    setTitle(task.title);
                    setDescription(task.description ?? "");
                    setEditing(true);
                  }}
                  accessibilityLabel="Edit task"
                  style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
                >
                  <Ionicons name="pencil" size={18} color={Colors.onPrimary} />
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
              ) : null}
              {!editing && boostable ? (
                <>
                  {boostError ? <ErrorBanner message={boostError} /> : null}
                  <Pressable
                    onPress={onBoost}
                    disabled={boosting || myGems < 1}
                    accessibilityLabel="Double points for 1 gem"
                    style={({ pressed }) => [
                      styles.boostBtn,
                      (boosting || myGems < 1) && styles.btnOff,
                      pressed && myGems > 0 && !boosting && styles.pressed,
                    ]}
                  >
                    {boosting ? (
                      <ActivityIndicator size="small" color={Colors.bgDeep} />
                    ) : (
                      <Ionicons name="diamond" size={18} color={Colors.bgDeep} />
                    )}
                    <Text style={styles.boostText}>
                      {myGems > 0 ? `Double points` : "No gems left"}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: Colors.mantle,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    padding: 20,
    gap: 12,
    width: "100%",
    maxHeight: "85%",
  },
  topRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusPill: {
    backgroundColor: Colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: { color: Colors.primary, fontSize: 12, fontWeight: "800" },
  pointsChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pointsText: { color: Colors.text, fontSize: 13, fontWeight: "800" },
  iconBtn: { marginLeft: "auto", padding: 4 },
  scroll: { flexGrow: 0 },
  scrollBody: { gap: 10, paddingBottom: 4 },
  bigTitle: { color: Colors.text, fontSize: 24, fontWeight: "800" },
  desc: { color: Colors.text, fontSize: 16, lineHeight: 24 },
  noDesc: { color: Colors.muted, fontSize: 15, fontStyle: "italic" },
  meta: { flexDirection: "row", gap: 14, marginTop: 4 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaText: { color: Colors.muted, fontSize: 14 },
  label: { color: Colors.muted, fontSize: 12, fontWeight: "700" },
  input: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    color: Colors.text,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bodyInput: { minHeight: 140 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 12,
  },
  editText: { color: Colors.onPrimary, fontSize: 15, fontWeight: "800" },
  boostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.success,
    borderRadius: 14,
    paddingVertical: 12,
  },
  boostText: { color: Colors.bgDeep, fontSize: 15, fontWeight: "800" },
  btnOff: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
});
