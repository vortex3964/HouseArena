// Leaderboard screen. Live household members with real points, ranked
// together on one scrolling board.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useIsFocused } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import { useHouseholdMembers } from "../system/db";
import { resolveAvatarUrl } from "../system/avatars";
import { Colors } from "../global/theme";
import { ErrorBanner, PrimaryButton } from "../components/auth_ui";
import { Leaderboard, type LeaderboardUser } from "../components/leaderboard";

export default function LeaderboardScreen() {
  const { client, activeHousehold } = useAuth();
  const focused = useIsFocused();
  const householdId = activeHousehold?.household.id ?? null;
  const membersQuery = useHouseholdMembers(client, householdId);

  // Realtime patches points, but a refetch on focus covers reconnect
  // gaps and the first paint with a warm cache.
  useEffect(() => {
    if (focused) void membersQuery.refetch();
  }, [focused]);

  // Storage paths are private: one signed URL per member, failures fall
  // back to the initials circle (null url).
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const members = membersQuery.data;
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!client || !members) return;
      const pairs = await Promise.all(
        members.map(async (m) => {
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
  }, [client, members]);

  const users = useMemo<LeaderboardUser[]>(() => {
    return (members ?? []).map((m) => ({
      id: m.profile_id,
      name: m.profile?.username?.trim() ? m.profile.username : "Housemate",
      points: m.profile?.points ?? 0,
      avatarUrl: photoUrls[m.profile_id] ?? null,
    }));
  }, [members, photoUrls]);

  if (membersQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }
  if (membersQuery.isError) {
    return (
      <View style={styles.center}>
        <ErrorBanner message="Could not load members." />
        <PrimaryButton title="Retry" onPress={() => membersQuery.refetch()} />
      </View>
    );
  }

  return (
    <Leaderboard
      users={users}
      refreshing={membersQuery.isRefetching}
      onRefresh={() => void membersQuery.refetch()}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
});
