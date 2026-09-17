// In-app confirm dialog. React Native Web's Alert.alert is a no-op, so
// destructive actions confirm here instead, identically on all platforms.
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { PrimaryButton } from "./auth_ui";

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Ionicons name="warning-outline" size={22} color={Colors.danger} />
            <Text style={styles.title}>{title}</Text>
          </View>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <PrimaryButton title="Cancel" onPress={onCancel} />
            </View>
            <View style={styles.flex}>
              <PrimaryButton title={confirmLabel} onPress={onConfirm} />
            </View>
          </View>
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
    maxWidth: 380,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: Colors.text, fontSize: 17, fontWeight: "800", flex: 1 },
  message: { color: Colors.subtext0, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: 10 },
  flex: { flex: 1 },
});
