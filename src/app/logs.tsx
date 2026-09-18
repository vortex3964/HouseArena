import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFocused } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import { useHouseholdLogs } from "../system/db";
import { useLiveLogs } from "../system/live";
import { Colors } from "../global/theme";
import type { ActivityLog } from "../system/obj_types";

const ACTION_META: Record<
  string,
  { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }
> = {
  created: { color: Colors.blue, icon: "add-circle", label: "Created" },
  claimed: { color: Colors.teal, icon: "hand-left", label: "Claimed" },
  released: { color: Colors.yellow, icon: "return-down-back", label: "Released" },
  review: { color: Colors.sky, icon: "eye", label: "In Review" },
  confirmed: { color: Colors.green, icon: "checkmark-circle", label: "Confirmed" },
  rejected: { color: Colors.red, icon: "close-circle", label: "Rejected" },
  completed: { color: Colors.success, icon: "trophy", label: "Completed" },
  boosted: { color: Colors.pink, icon: "flash", label: "Boosted" },
  deleted: { color: Colors.danger, icon: "trash", label: "Deleted" },
  edited: { color: Colors.peach, icon: "pencil", label: "Edited" },
};

function actionMeta(action: string | null) {
  if (!action) return { color: Colors.muted, icon: "ellipsis-horizontal" as const, label: "Activity" };
  return (
    ACTION_META[action.toLowerCase()] ?? {
      color: Colors.muted,
      icon: "ellipsis-horizontal" as const,
      label: action,
    }
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function LogCard({ entry }: { entry: ActivityLog }) {
  const meta = actionMeta(entry.action);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.cardLeft}>
          <View style={[styles.iconWrap, { backgroundColor: meta.color + "22" }]}>
            <Ionicons name={meta.icon} size={16} color={meta.color} />
          </View>
          <Text style={styles.owner}>{entry.owner ?? "system"}</Text>
        </View>
        <Text style={styles.time}>{timeAgo(entry.created_at)}</Text>
      </View>
      <View style={styles.cardBody}>
        <View style={[styles.badge, { backgroundColor: meta.color + "20" }]}>
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
        <Text style={styles.details}>{entry.details ?? ""}</Text>
      </View>
    </View>
  );
}

export default function Logs() {
  const { client, activeHousehold } = useAuth();
  const householdId = activeHousehold?.household.id ?? null;
  const { data: logs, isLoading, refetch } = useHouseholdLogs(client, householdId);
  const [search, setSearch] = useState("");
  const focused = useIsFocused();

  useLiveLogs(client, focused ? householdId : null);

  useEffect(() => {
    if (focused) refetch();
  }, [focused, refetch]);

  const filtered = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    if (!search.trim()) return logs;
    const q = search.toLowerCase();
    return logs.filter(
      (l) =>
        (l.owner ?? "").toLowerCase().includes(q) ||
        (l.action ?? "").toLowerCase().includes(q) ||
        (l.details ?? "").toLowerCase().includes(q),
    );
  }, [logs, search]);

  if (!activeHousehold) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyText}>No household selected.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={Colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search activity..."
          placeholderTextColor={Colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {search.length > 0 ? (
          <Pressable onPress={() => setSearch("")} hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={Colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="newspaper-outline" size={48} color={Colors.disabled} />
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.emptyHint}>
            {search ? "Try a different search" : "Task actions will appear here"}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {filtered.map((entry) => (
            <LogCard key={entry.id} entry={entry} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDeep, padding: 20 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.bgDeep,
  },
  emptyTitle: { color: Colors.text, fontSize: 16, fontWeight: "700" },
  emptyHint: { color: Colors.muted, fontSize: 13 },
  emptyText: { color: Colors.muted, fontSize: 14 },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  searchInput: { flex: 1, color: Colors.text, fontSize: 14 },

  list: { flex: 1 },
  listContent: { gap: 10, paddingBottom: 32 },

  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  owner: { color: Colors.text, fontSize: 14, fontWeight: "700" },
  time: { color: Colors.muted, fontSize: 12 },

  cardBody: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },
  details: { color: Colors.subtext1, fontSize: 13, flex: 1 },
});
