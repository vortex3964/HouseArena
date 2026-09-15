import { Pressable, Text, View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DrawerToggleButton } from "expo-router/drawer";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { useAuth } from "../system/AuthProvider";

export function TopBar() {
  const insets = useSafeAreaInsets();
  // Live values from the realtime profile subscription, null until loaded.
  const { profile } = useAuth();

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <DrawerToggleButton tintColor={Colors.text} />

      <View style={styles.counters}>
        <View style={styles.box}>
          <Ionicons name="star" size={16} color={Colors.peach} />
          <Text style={styles.count}>
            {(profile?.points ?? 0).toLocaleString()}
          </Text>
        </View>

        <View style={styles.box}>
          <Ionicons name="diamond" size={16} color={Colors.teal} />
          <Text style={styles.count}>
            {(profile?.gems ?? 0).toLocaleString()}
          </Text>
        </View>
      </View>

      <Pressable style={styles.avatar} accessibilityLabel="Profile">
        <Ionicons name="person" size={20} color={Colors.primary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.mantle,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  counters: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
  },
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.surface0,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  count: { color: Colors.text, fontWeight: "700" },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface0,
    borderWidth: 2,
    borderColor: Colors.primary,
    marginRight: 8,
  },
});
