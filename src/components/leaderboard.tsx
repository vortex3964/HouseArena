// Leaderboard board: podium top 3 under a gradient header, ranked list
// below. Pure presentational: the screen feeds it users, it sorts, ranks
// and splits them itself. Dark Catppuccin theme, app copy ("pts").
import { useMemo } from "react";
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";

// One entrant. Avatar may be missing (profiles without photos), then the
// initials circle shows instead of an image.
export type LeaderboardUser = {
  id: string;
  name: string;
  points: number;
  avatarUrl: string | null;
};

export type RankedUser = LeaderboardUser & { rank: number };

// Sorts points desc and numbers ranks 1..N. Pure so it is unit-testable
// without rendering anything native.
export function rankUsers(users: LeaderboardUser[]): RankedUser[] {
  return [...users]
    .sort((a, b) => b.points - a.points)
    .map((user, index) => ({ ...user, rank: index + 1 }));
}

// First letters, up to 2, for the fallback circles.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({
  user,
  size,
  ringColor,
}: {
  user: LeaderboardUser;
  size: number;
  ringColor?: string;
}) {
  if (user.avatarUrl) {
    return (
      <View style={[styles.ring, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, borderColor: ringColor ?? Colors.border }]}>
        <Image source={{ uri: user.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      </View>
    );
  }
  return (
    <View style={[styles.ring, styles.ringFallback, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2, borderColor: ringColor ?? Colors.border }]}>
      <Text style={[styles.initials, { fontSize: size * 0.36 }]}>{initials(user.name)}</Text>
    </View>
  );
}

function PodiumCard({
  user,
  isFirst,
  medalColor,
  onPress,
}: {
  user: RankedUser;
  isFirst: boolean;
  medalColor: string;
  onPress?: (user: LeaderboardUser) => void;
}) {
  const body = (
    <View style={[styles.podiumCard, isFirst && styles.podiumCardTall]}>
      <Avatar user={user} size={isFirst ? 80 : 56} ringColor="rgba(255,255,255,0.85)" />
      <Text style={styles.podiumName} numberOfLines={2}>
        {user.name}
      </Text>
      <View style={styles.pointsPill}>
        <Text style={styles.pointsPillText}>{user.points} pts</Text>
      </View>
      <View style={[styles.medal, { backgroundColor: medalColor }]}>
        <Text style={styles.medalRank}>{user.rank}</Text>
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={() => onPress(user)}
      accessibilityLabel={`Open ${user.name}`}
      style={({ pressed }) => [styles.podiumPress, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function RankedRow({
  user,
  maxPoints,
  onPress,
}: {
  user: RankedUser;
  maxPoints: number;
  onPress?: (user: LeaderboardUser) => void;
}) {
  const progress = maxPoints > 0 ? Math.min(user.points / maxPoints, 1) : 0;
  const body = (
    <View style={styles.row}>
      <Text style={styles.rowRank}>{user.rank}</Text>
      <Avatar user={user} size={48} />
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {user.name}
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.rowPoints}>{user.points} pts</Text>
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={() => onPress(user)}
      accessibilityLabel={`Open ${user.name}`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const MEDAL_COLORS = ["#F5A623", "#B8B8B8", "#CD7F32"];

export function Leaderboard({
  users,
  title = "Leaderboard",
  onUserPress,
  refreshing = false,
  onRefresh,
}: {
  users: LeaderboardUser[];
  title?: string;
  onUserPress?: (user: LeaderboardUser) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const ranked = useMemo(() => rankUsers(users), [users]);
  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);

  // Physical podium order: 2nd left, 1st center, 3rd right.
  const podiumOrder = useMemo(() => {
    if (podium.length < 3) return podium;
    const [first, second, third] = podium;
    return [second, first, third];
  }, [podium]);

  const maxPoints = ranked[0]?.points ?? 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        ) : undefined
      }
    >
      <LinearGradient
        colors={[Colors.mauve, Colors.secondary, Colors.accent]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.header}
      >
        <Text style={styles.headerTitle}>{title}</Text>
        {podium.length > 0 ? (
          <View style={styles.podiumRow}>
            {podiumOrder.map((user) => (
              <PodiumCard
                key={user.id}
                user={user}
                isFirst={user.rank === 1}
                medalColor={MEDAL_COLORS[user.rank - 1] ?? MEDAL_COLORS[MEDAL_COLORS.length - 1]}
                onPress={onUserPress}
              />
            ))}
          </View>
        ) : null}
      </LinearGradient>

      <View style={styles.sheet}>
        <Text style={styles.sheetTitle}>Standings</Text>
        <Text style={styles.sheetSubtitle}>Points update when cards get completed</Text>
        {ranked.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="trophy-outline" size={40} color={Colors.disabled} />
            <Text style={styles.emptyTitle}>No members yet</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {rest.map((user) => (
              <RankedRow
                key={user.id}
                user={user}
                maxPoints={maxPoints}
                onPress={onUserPress}
              />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDeep },
  screenContent: { flexGrow: 1, paddingBottom: 24 },
  header: {
    paddingTop: 24,
    paddingBottom: 90,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 24,
  },
  podiumRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 10,
  },
  podiumPress: { flex: 1, maxWidth: 120 },
  podiumCard: {
    flex: 1,
    maxWidth: 120,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 20,
    paddingTop: 16,
    paddingBottom: 22,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 10,
  },
  podiumCardTall: {
    paddingBottom: 30,
    paddingTop: 8,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  ring: {
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  ringFallback: { backgroundColor: Colors.primarySoft },
  initials: { color: Colors.primary, fontWeight: "800" },
  podiumName: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    minHeight: 32,
  },
  pointsPill: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
  },
  pointsPillText: { color: Colors.onPrimary, fontSize: 11, fontWeight: "800" },
  medal: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  medalRank: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  sheet: {
    backgroundColor: Colors.mantle,
    marginTop: -46,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: Colors.border,
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  sheetTitle: { color: Colors.text, fontSize: 20, fontWeight: "800" },
  sheetSubtitle: { color: Colors.muted, fontSize: 13, marginTop: 4, marginBottom: 12 },
  list: { paddingBottom: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSoft,
  },
  rowRank: { width: 20, color: Colors.muted, fontSize: 14, fontWeight: "700" },
  rowBody: { flex: 1, gap: 6 },
  rowName: { color: Colors.text, fontSize: 14, fontWeight: "700" },
  progressTrack: {
    height: 6,
    backgroundColor: Colors.bg,
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3, backgroundColor: Colors.primary },
  rowPoints: { color: Colors.primary, fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", gap: 8, paddingTop: 48 },
  emptyTitle: { color: Colors.text, fontSize: 17, fontWeight: "800" },
  pressed: { opacity: 0.8 },
});
