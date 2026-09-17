// Personal stats board: this week vs last week (completions + points)
// plus a 7-day bar chart, with CSV export. Weeks start Monday to match
// the server pruning. Pure helpers (bucketStats, buildStatsCsv) carry
// the logic so they are unit-testable without rendering.
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BarChart } from "react-native-gifted-charts";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { PrimaryButton } from "./auth_ui";
import type { Task } from "../system/obj_types";

export type DayBucket = {
  // Device-local yyyy-mm-dd.
  date: string;
  label: string;
  count: number;
  points: number;
};

export type WeekTotals = { count: number; points: number };

export type StatsSummary = {
  days: DayBucket[];
  lastDays: DayBucket[];
  thisWeek: WeekTotals;
  lastWeek: WeekTotals;
  deltaCount: number;
  deltaPoints: number;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_MS = 86_400_000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

// Monday 00:00 of the week containing d (device-local).
function mondayOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function isoDay(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Buckets the user's completed tasks into this week (per-day) and last
// week (totals). Rows missing completed_at (completed before the column
// existed) cannot be dated, so they are excluded from both weeks.
export function bucketStats(
  tasks: Task[],
  userId: string | null,
  now: Date = new Date(),
): StatsSummary {
  const thisStart = mondayOfWeek(now).getTime();
  const lastStart = thisStart - 7 * DAY_MS;
  const makeWeek = (start: number): DayBucket[] =>
    Array.from({ length: 7 }, (_, i) => {
      const date = new Date(start + i * DAY_MS);
      return { date: isoDay(date), label: DAY_LABELS[i], count: 0, points: 0 };
    });
  const days = makeWeek(thisStart);
  const lastDays = makeWeek(lastStart);
  const thisWeek: WeekTotals = { count: 0, points: 0 };
  const lastWeek: WeekTotals = { count: 0, points: 0 };

  if (userId) {
    for (const t of tasks) {
      if (t.owner !== userId || t.status !== "completed" || !t.completed_at) continue;
      const done = new Date(t.completed_at);
      if (Number.isNaN(done.getTime())) continue;
      const at = startOfDay(done).getTime();
      if (at >= thisStart) {
        const i = Math.round((at - thisStart) / DAY_MS);
        if (i >= 0 && i < 7) {
          days[i].count += 1;
          days[i].points += t.points;
          thisWeek.count += 1;
          thisWeek.points += t.points;
        }
      } else if (at >= lastStart) {
        const i = Math.round((at - lastStart) / DAY_MS);
        if (i >= 0 && i < 7) {
          lastDays[i].count += 1;
          lastDays[i].points += t.points;
          lastWeek.count += 1;
          lastWeek.points += t.points;
        }
      }
    }
  }

  return {
    days,
    lastDays,
    thisWeek,
    lastWeek,
    deltaCount: thisWeek.count - lastWeek.count,
    deltaPoints: thisWeek.points - lastWeek.points,
  };
}

// One CSV row per day (both weeks) plus two summary rows. No commas ever
// appear in fields, so no quoting is needed.
export function buildStatsCsv(summary: StatsSummary): string {
  const lines = ["week,day,date,completed,points"];
  for (const day of summary.lastDays) {
    lines.push(`last week,${day.label},${day.date},${day.count},${day.points}`);
  }
  for (const day of summary.days) {
    lines.push(`this week,${day.label},${day.date},${day.count},${day.points}`);
  }
  lines.push(
    `summary,this week,,${summary.thisWeek.count},${summary.thisWeek.points}`,
    `summary,last week,,${summary.lastWeek.count},${summary.lastWeek.points}`,
  );
  return lines.join("\n") + "\n";
}

function DeltaLine({ deltaCount, deltaPoints }: { deltaCount: number; deltaPoints: number }) {
  const flat = deltaCount === 0 && deltaPoints === 0;
  const up = deltaCount > 0 || deltaPoints > 0;
  const icon = flat ? "remove" : up ? "trending-up" : "trending-down";
  const color = flat ? Colors.muted : up ? Colors.success : Colors.danger;
  const countPart = `${deltaCount >= 0 ? "+" : ""}${deltaCount} tasks`;
  const pointsPart = `${deltaPoints >= 0 ? "+" : ""}${deltaPoints} pts`;
  return (
    <View style={styles.deltaLine}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[styles.deltaText, { color }]}>
        {countPart}, {pointsPart} vs last week
      </Text>
    </View>
  );
}

export function StatsBoard({
  summary,
  downloading,
  shareError,
  onDownload,
}: {
  summary: StatsSummary;
  downloading: boolean;
  shareError: string | null;
  onDownload: () => void;
}) {
  const maxCount = useMemo(
    () => Math.max(1, ...summary.days.map((d) => d.count)),
    [summary],
  );
  // Headroom above the tallest bar: maxValue equal to the data max pushes
  // that bar to 100% of the plot area and its top label clips off.
  const chartMaxValue = maxCount + Math.max(1, Math.ceil(maxCount * 0.2));
  const todayIso = isoDay(new Date());
  const empty = summary.thisWeek.count === 0 && summary.lastWeek.count === 0;
  // Measure the card so 7 bars fit exactly: fixed widths overflow narrow
  // phones and push Sunday out of the box.
  const [chartWidth, setChartWidth] = useState(0);
  const EDGE = 8;
  const GAP = 10;
  const barWidth =
    chartWidth > 0
      ? Math.max(16, Math.floor((chartWidth - EDGE * 2 - GAP * 6) / 7))
      : 24;
  const barData = useMemo(
    () =>
      summary.days.map((day) => {
        const isToday = day.date === todayIso;
        return {
          value: day.count,
          label: day.label,
          frontColor: isToday ? Colors.primary : Colors.primarySoft,
          // Explicit renderer, not showValuesAsTopLabel: the built-in path
          // garbles digits into stray glyphs on some versions. String()
          // here keeps the label exactly the count.
          topLabelComponent: () => (
            <Text style={[styles.topLabel, isToday && styles.topLabelToday]}>
              {String(day.count)}
            </Text>
          ),
        };
      }),
    [summary, todayIso],
  );

  return (
    <View style={styles.board}>
      <View style={styles.hero}>
        <Text style={styles.heroEyebrow}>This week</Text>
        <Text style={styles.heroCount}>{summary.thisWeek.count}</Text>
        <Text style={styles.heroSub}>
          {summary.thisWeek.count === 1 ? "task done" : "tasks done"} - {summary.thisWeek.points} pts earned
        </Text>
        <View style={styles.heroDivider} />
        <Text style={styles.lastWeek}>
          Last week: {summary.lastWeek.count} tasks, {summary.lastWeek.points} pts
        </Text>
        <DeltaLine deltaCount={summary.deltaCount} deltaPoints={summary.deltaPoints} />
      </View>

      <View style={styles.chartCard}>
        <Text style={styles.cardTitle}>Daily completions</Text>
        {empty ? (
          <View style={styles.empty}>
            <Ionicons name="bar-chart-outline" size={36} color={Colors.disabled} />
            <Text style={styles.emptyText}>Nothing completed yet</Text>
          </View>
        ) : (
          <View
            onLayout={(e) => {
              const w = Math.round(e.nativeEvent.layout.width);
              if (w !== chartWidth) setChartWidth(w);
            }}
          >
            {chartWidth > 0 ? (
              <BarChart
                data={barData}
                height={170}
                barWidth={barWidth}
                spacing={GAP}
                initialSpacing={EDGE}
                endSpacing={EDGE}
                roundedTop
                barBorderRadius={8}
                maxValue={chartMaxValue}
                noOfSections={Math.min(4, maxCount)}
                hideRules
                hideYAxisText
                yAxisThickness={0}
                xAxisThickness={0}
                xAxisLabelTextStyle={styles.axisLabel}
                labelsExtraHeight={10}
                isAnimated
              />
            ) : null}
          </View>
        )}
      </View>

      {shareError ? (
        <Text style={styles.shareError}>{shareError}</Text>
      ) : null}
      <PrimaryButton title="Download CSV" onPress={onDownload} loading={downloading} />
    </View>
  );
}

const styles = StyleSheet.create({
  board: { gap: 12, paddingBottom: 24 },
  hero: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    padding: 20,
    alignItems: "center",
    gap: 4,
  },
  heroEyebrow: { color: Colors.muted, fontSize: 12, fontWeight: "700" },
  heroCount: { color: Colors.text, fontSize: 56, fontWeight: "800", lineHeight: 60 },
  heroSub: { color: Colors.subtext0, fontSize: 14 },
  heroDivider: { height: 1, alignSelf: "stretch", backgroundColor: Colors.border, marginVertical: 8 },
  lastWeek: { color: Colors.subtext0, fontSize: 13 },
  deltaLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  deltaText: { fontSize: 13, fontWeight: "700" },
  chartCard: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 20,
    padding: 20,
    gap: 12,
  },
  cardTitle: { color: Colors.text, fontSize: 16, fontWeight: "800" },
  topLabel: { color: Colors.text, fontSize: 12, fontWeight: "700" },
  topLabelToday: { color: Colors.primary },
  axisLabel: { color: Colors.muted, fontSize: 11, fontWeight: "700" },
  empty: { alignItems: "center", gap: 8, paddingVertical: 20 },
  emptyText: { color: Colors.muted, fontSize: 14 },
  shareError: { color: Colors.danger, fontSize: 13, textAlign: "center" },
});
