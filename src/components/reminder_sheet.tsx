import { useState } from "react";
import { Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { PrimaryButton } from "./auth_ui";

// Bottom sheet for picking a reminder moment. iOS gets one datetime
// picker; Android gets date-then-time steps (no combined mode there).
// Dismissing at any point cancels without scheduling anything.
export function ReminderSheet({
  visible,
  taskTitle,
  onPick,
  onClose,
}: {
  visible: boolean;
  taskTitle: string;
  onPick: (date: Date) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d;
  });
  const [androidStep, setAndroidStep] = useState<"date" | "time">("date");

  function close() {
    setAndroidStep("date");
    onClose();
  }

  function confirm() {
    onPick(draft);
    setAndroidStep("date");
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <Ionicons name="alarm-outline" size={20} color={Colors.info} />
            <Text style={styles.sheetTitle} numberOfLines={1}>
              Remind me: {taskTitle}
            </Text>
          </View>

          {Platform.OS === "android" ? (
            androidStep === "date" ? (
              <DateTimePicker
                value={draft}
                mode="date"
                minimumDate={new Date()}
                display="default"
                onChange={(_e, d) => {
                  if (!d) {
                    close();
                    return;
                  }
                  const next = new Date(draft);
                  next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                  setDraft(next);
                  setAndroidStep("time");
                }}
              />
            ) : (
              <>
                <DateTimePicker
                  value={draft}
                  mode="time"
                  display="default"
                  onChange={(_e, d) => {
                    if (!d) {
                      close();
                      return;
                    }
                    const next = new Date(draft);
                    next.setHours(d.getHours(), d.getMinutes(), 0, 0);
                    setDraft(next);
                    confirm();
                  }}
                />
                <PrimaryButton title="Cancel" onPress={close} />
              </>
            )
          ) : (
            <>
              <DateTimePicker
                value={draft}
                mode="datetime"
                minimumDate={new Date()}
                display="spinner"
                onChange={(_e, d) => {
                  if (d) setDraft(d);
                }}
              />
              <View style={styles.row}>
                <View style={styles.flex}>
                  <PrimaryButton title="Cancel" onPress={close} />
                </View>
                <View style={styles.flex}>
                  <PrimaryButton title="Set reminder" onPress={confirm} />
                </View>
              </View>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: Colors.mantle,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border,
    padding: 20,
    gap: 12,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.border,
    alignSelf: "center",
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetTitle: { color: Colors.text, fontSize: 16, fontWeight: "800", flex: 1 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
});
