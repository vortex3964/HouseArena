import { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";

// One avatar renderer for every screen: photo when we have a working
// URL, person icon while loading, on error, or with no photo at all.
export function AvatarImage({
  uri,
  size,
}: {
  uri: string | null;
  size: number;
}) {
  const [failed, setFailed] = useState(false);

  if (!uri || failed) {
    return (
      <View
        style={[
          styles.fallback,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <Ionicons name="person" size={size * 0.52} color={Colors.primary} />
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      contentFit="cover"
      onError={() => setFailed(true)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.surface0,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
});
