// Personal stats screen: this week vs last week plus daily bars and a
// CSV download. Reads the cached board tasks (live), no extra queries.
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useIsFocused } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import { useHouseholdTasks } from "../system/db";
import { toMessage } from "../system/errors";
import { shareCsvFile } from "../system/csv_share";
import { Colors } from "../global/theme";
import { ErrorBanner, PrimaryButton } from "../components/auth_ui";
import { StatsBoard, bucketStats, buildStatsCsv } from "../components/stats_board";

export default function StatsScreen() {
  const { client, sessionUserId, profile, activeHousehold } = useAuth();
  const focused = useIsFocused();
  const householdId = activeHousehold?.household.id ?? null;
  const myId = sessionUserId ?? profile?.id ?? null;
  const tasksQuery = useHouseholdTasks(client, householdId);

  // Same belt-and-braces as the leaderboard: realtime patches rows, but
  // a refetch on focus covers reconnect gaps.
  useEffect(() => {
    if (focused) void tasksQuery.refetch();
  }, [focused]);

  const summary = useMemo(
    () => bucketStats(tasksQuery.data ?? [], myId),
    [tasksQuery.data, myId],
  );

  const [downloading, setDownloading] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  async function onDownload() {
    setShareError(null);
    setDownloading(true);
    try {
      const day = new Date().toISOString().slice(0, 10);
      await shareCsvFile(buildStatsCsv(summary), `housearena-stats-${day}.csv`);
    } catch (e) {
      setShareError(toMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  if (tasksQuery.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }
  if (tasksQuery.isError) {
    return (
      <View style={styles.center}>
        <ErrorBanner message={toMessage(tasksQuery.error)} />
        <PrimaryButton title="Retry" onPress={() => tasksQuery.refetch()} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <StatsBoard
        summary={summary}
        downloading={downloading}
        shareError={shareError}
        onDownload={onDownload}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { padding: 20, flexGrow: 1 },
  center: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
});
