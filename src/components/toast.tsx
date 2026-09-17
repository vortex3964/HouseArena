// Bottom toast pill. Renders nothing when there is no message and never
// intercepts taps (pointerEvents none): it only announces, then the
// caller clears the message on its own timer.
import { StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.pill}>
        <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
        <Text style={styles.text}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 190,
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.mantle,
    borderWidth: 1,
    borderColor: Colors.success,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  text: { color: Colors.text, fontSize: 14, fontWeight: "700" },
});
