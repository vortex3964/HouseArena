// Housemate profile: read-only view opened from a household card.
// Stats only, no editing, no email. Back returns to the household list
// explicitly because the drawer keeps routes as siblings (no stack).
import { StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { useAuth } from "../system/AuthProvider";
import { useHouseholdMembers } from "../system/db";
import { useAvatarUrl } from "../system/avatars";
import { AuthScreen, PrimaryButton } from "../components/auth_ui";
import { AvatarImage } from "../components/AvatarImage";

function StatBox({
  icon,
  value,
  label,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  label: string;
  color: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={styles.statValue}>{(value ?? 0).toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function Member() {
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();
  const viewedId = Array.isArray(userIdParam) ? userIdParam[0] : userIdParam;
  const { client, activeHousehold } = useAuth();
  const membersQuery = useHouseholdMembers(client, activeHousehold?.household.id ?? null);
  const member = viewedId
    ? (membersQuery.data ?? []).find((m) => m.profile_id === viewedId)
    : undefined;
  const avatarUrl = useAvatarUrl(client, member?.profile?.avatar_url ?? null);

  function backToHousehold() {
    router.replace("/household");
  }

  if (!member?.profile) {
    return (
      <AuthScreen eyebrow="HouseArena" title="Profile" subtitle="Not found">
        <Text style={styles.email}>That member is not here anymore.</Text>
        <PrimaryButton title="Back" onPress={backToHousehold} />
      </AuthScreen>
    );
  }

  const p = member.profile;
  return (
    <AuthScreen eyebrow="HouseArena" title="Profile" subtitle={p.username}>
      <View style={styles.center}>
        <AvatarImage uri={avatarUrl} size={96} />
      </View>
      <View style={styles.stats}>
        <StatBox icon="star" value={p.points} label="Points" color={Colors.peach} />
        <StatBox icon="diamond" value={p.gems} label="Gems" color={Colors.teal} />
        <StatBox icon="trophy" value={p.wins} label="Wins" color={Colors.yellow} />
        <StatBox icon="warning" value={p.strikes} label="Strikes" color={Colors.danger} />
      </View>
      <Text style={styles.email}>{member.role}</Text>
      <PrimaryButton title="Back" onPress={backToHousehold} />
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", marginVertical: 4 },
  stats: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    backgroundColor: Colors.surface0,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    paddingVertical: 12,
  },
  statValue: { color: Colors.text, fontWeight: "800", fontSize: 17 },
  statLabel: { color: Colors.subtext0, fontSize: 12 },
  email: { color: Colors.subtext0, fontSize: 14, textAlign: "center" },
});
