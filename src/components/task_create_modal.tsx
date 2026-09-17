// Create-task modal for the home FAB. Title, description, difficulty
// selector, and a points field validated against PointsBands through
// the shared validateTaskInput helper (same friendly errors as db).
// Busy-guarded submit, no double-tap creates.

import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { Lengths, PointsBands } from "../global/constants";
import { ErrorBanner, PrimaryButton } from "./auth_ui";
import { createTask, validateTaskInput } from "../system/db";
import { toMessage } from "../system/errors";
import type { Task, TaskDifficulty } from "../system/obj_types";

const DIFFICULTIES: TaskDifficulty[] = ["easy", "medium", "hard"];

export function TaskCreateModal({
  visible,
  client,
  householdId,
  onClose,
  onCreated,
}: {
  visible: boolean;
  client: SupabaseClient | null;
  householdId: number | null;
  onClose: () => void;
  onCreated: (task: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState<TaskDifficulty>("easy");
  const [pointsText, setPointsText] = useState(String(PointsBands.easy.min));
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function reset() {
    setTitle("");
    setDescription("");
    setDifficulty("easy");
    setPointsText(String(PointsBands.easy.min));
    setError(null);
    setCreating(false);
  }

  function close() {
    if (creating) return;
    reset();
    onClose();
  }

  // Switching difficulty presets the points to the band minimum so the
  // field starts valid instead of failing on first submit.
  function pickDifficulty(d: TaskDifficulty) {
    setDifficulty(d);
    setPointsText(String(PointsBands[d].min));
  }

  async function onSubmit() {
    if (creating) return;
    setError(null);
    if (!client || householdId == null) {
      setError("Join or create a household first.");
      return;
    }
    const points = Number.parseInt(pointsText.trim(), 10);
    const err = validateTaskInput({ title, difficulty, points });
    if (err) {
      setError(err);
      return;
    }
    setCreating(true);
    try {
      const task = await createTask(client, {
        householdId,
        title,
        description: description.trim() ? description : null,
        difficulty,
        points,
      });
      onCreated(task);
      reset();
      onClose();
    } catch (e) {
      setError(toMessage(e));
      setCreating(false);
    }
  }

  const band = PointsBands[difficulty];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.center}
        >
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>New task</Text>
              <Pressable onPress={close} disabled={creating} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={Colors.muted} />
              </Pressable>
            </View>

            <Text style={styles.label}>Title</Text>
            <TextInput
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Take out the recycling"
              placeholderTextColor={Colors.muted}
              maxLength={Lengths.TASK_TITLE}
              editable={!creating}
              returnKeyType="next"
            />
            <Text style={styles.counter}>
              {title.trim().length}/{Lengths.TASK_TITLE}
            </Text>

            <Text style={styles.label}>Description (optional)</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={description}
              onChangeText={setDescription}
              placeholder="Which bins, where they live…"
              placeholderTextColor={Colors.muted}
              multiline
              numberOfLines={3}
              editable={!creating}
            />

            <Text style={styles.label}>Difficulty</Text>
            <View style={styles.diffRow}>
              {DIFFICULTIES.map((d) => {
                const active = d === difficulty;
                return (
                  <Pressable
                    key={d}
                    onPress={() => pickDifficulty(d)}
                    disabled={creating}
                    accessibilityLabel={`Difficulty ${d}`}
                    style={({ pressed }) => [
                      styles.diff,
                      active && styles.diffActive,
                      pressed && !creating && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.diffText, active && styles.diffTextActive]}>
                      {d}
                    </Text>
                    <Text style={[styles.bandText, active && styles.diffTextActive]}>
                      {PointsBands[d].min}-{PointsBands[d].max}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>
              Points ({band.min}-{band.max} for {difficulty})
            </Text>
            <TextInput
              style={styles.input}
              value={pointsText}
              onChangeText={setPointsText}
              placeholder={String(band.min)}
              placeholderTextColor={Colors.muted}
              keyboardType="number-pad"
              editable={!creating}
              onSubmitEditing={onSubmit}
            />

            <ErrorBanner message={error} />
            <PrimaryButton title="Create task" onPress={onSubmit} loading={creating} />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(6, 6, 12, 0.7)",
    justifyContent: "flex-end",
  },
  center: { justifyContent: "flex-end" },
  sheet: {
    backgroundColor: Colors.elevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border,
    padding: 20,
    paddingBottom: 28,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  title: { color: Colors.text, fontSize: 20, fontWeight: "800" },
  label: { color: Colors.subtext1, fontSize: 13, fontWeight: "600", marginTop: 4 },
  input: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: Colors.text,
    fontSize: 15,
  },
  multiline: { minHeight: 72, textAlignVertical: "top" },
  counter: { color: Colors.muted, fontSize: 11, textAlign: "right" },
  diffRow: { flexDirection: "row", gap: 8 },
  diff: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 10,
  },
  diffActive: { borderColor: Colors.borderStrong, backgroundColor: Colors.primarySoft },
  diffText: { color: Colors.subtext0, fontSize: 13, fontWeight: "700", textTransform: "capitalize" },
  diffTextActive: { color: Colors.text },
  bandText: { color: Colors.muted, fontSize: 11 },
  pressed: { opacity: 0.8 },
});
