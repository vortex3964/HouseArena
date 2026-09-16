import { Text, View, StyleSheet } from "react-native";
import { useIsFocused } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import { useHouseholdLogs } from "../system/db";
import { useLiveLogs } from "../system/live";

export default function Index() {
  const { client, activeHousehold } = useAuth();
  // Tracked only while this tab is focused: leaving unmounts nothing
  // (drawer keeps screens alive) so null id stops both the fetch and
  // the channel. Placeholder UI until the feed is built.
  const focused = useIsFocused();
  const householdId =
    focused && activeHousehold ? activeHousehold.household.id : null;
  useHouseholdLogs(client, householdId);
  useLiveLogs(client, householdId);

  return (
    <View style={styles.container}>
      <Text> Hello from Logs </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
