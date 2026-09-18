// Household screen: name on top, every member with photo/points/gems/
// wins. Hardcoded test people sit alongside the live members so the
// list can be judged with a full roster.
// TODO: delete HARDCODED_MEMBERS once the layout is approved.
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAuth } from "../system/AuthProvider";
import { useHouseholdMembers } from "../system/db";
import { resolveAvatarUrl } from "../system/avatars";
import { Colors } from "../global/theme";
import { ErrorBanner, PrimaryButton } from "../components/auth_ui";
import { AvatarImage } from "../components/AvatarImage";
import type { HouseholdMember } from "../system/obj_types";

function Stat({ icon, value, label }: { icon: keyof typeof Ionicons.glyphMap; value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={14} color={Colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function HouseholdScreen() {
  const { client, sessionUserId, profile, activeHousehold } = useAuth();
  const householdId = activeHousehold?.household.id ?? null;
  const myId = sessionUserId ?? profile?.id ?? null;
  const membersQuery = useHouseholdMembers(client, householdId);

  const members = membersQuery.data ?? [];

  // Private photo paths need signed URLs. Test people have no photos,
  // so they fall back to the person icon.
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!client || !membersQuery.data) return;
      const pairs = await Promise.all(
        membersQuery.data.map(async (m) => {
          const path = m.profile?.avatar_url ?? null;
          if (!path) return [m.profile_id, null] as const;
          try {
            return [m.profile_id, await resolveAvatarUrl(client, path)] as const;
          } catch {
            return [m.profile_id, null] as const;
          }
        }),
      );
      if (!alive) return;
      const next: Record<string, string> = {};
      for (const [id, url] of pairs) {
        if (url) next[id] = url;
      }
      setPhotoUrls(next);
    })();
    return () => {
      alive = false;
    };
  }, [client, membersQuery.data]);

  if (!sessionUserId) {
    return (
      <View style={styles.center}>
        <Text style={styles.hint}>Log in to see your household.</Text>
      </View>
    );
  }
  if (membersQuery.isLoading) {
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
      </View>
    );
  }
  if (membersQuery.isError) {
    return (
      <View style={styles.center}>
        <ErrorBanner message="Could not load the household." />
        <PrimaryButton title="Retry" onPress={() => membersQuery.refetch()} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.houseName} numberOfLines={2}>
        {activeHousehold.household.name}
      </Text>

      <Text style={styles.sectionTitle}>Members</Text>
      <View style={styles.memberList}>
        {members.map((m) => (
          <Pressable
            key={m.profile_id}
            onPress={() => router.push({ pathname: "/member", params: { userId: m.profile_id } })}
            accessibilityLabel={`Open ${m.profile?.username ?? "housemate"} profile`}
            style={({ pressed }) => [styles.memberRow, pressed && styles.pressed]}
          >
            <AvatarImage uri={photoUrls[m.profile_id] ?? null} size={46} />
            <View style={styles.memberBody}>
              <Text style={styles.memberName} numberOfLines={1}>
                {m.profile?.username ?? "Housemate"}
                {myId && m.profile_id === myId ? " (you)" : ""}
              </Text>
              <Text style={styles.memberRole}>{m.role}</Text>
            </View>
            <View style={styles.memberStats}>
              <Stat icon="star" value={m.profile?.points ?? 0} label="pts" />
              <Stat icon="diamond" value={m.profile?.gems ?? 0} label="gems" />
              <Stat icon="trophy" value={m.profile?.wins ?? 0} label="wins" />
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { padding: 20, gap: 12, paddingBottom: 32, flexGrow: 1 },
  center: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  hint: { color: Colors.muted, fontSize: 13, textAlign: "center" },
  houseName: { color: Colors.text, fontSize: 26, fontWeight: "800", marginBottom: 4 },
  sectionTitle: { color: Colors.text, fontSize: 17, fontWeight: "800", marginTop: 4 },
  memberList: { gap: 10 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  memberBody: { flex: 1, gap: 2 },
  memberName: { color: Colors.text, fontSize: 15, fontWeight: "800" },
  memberRole: { color: Colors.muted, fontSize: 12 },
  memberStats: { flexDirection: "row", gap: 10 },
  stat: { alignItems: "center", gap: 1, minWidth: 40 },
  statValue: { color: Colors.text, fontSize: 14, fontWeight: "800" },
  statLabel: { color: Colors.muted, fontSize: 10 },
  pressed: { opacity: 0.85 },
});
