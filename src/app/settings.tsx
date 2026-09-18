import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Clipboard from "expo-clipboard";
import { useAuth } from "../system/AuthProvider";
import { setCheckTime } from "../system/db";
import {
  getBackendConfigSync,
  getDevPrefill,
  loadBackendConfig,
  type BackendConfig,
} from "../system/supabase";
import { Colors } from "../global/theme";
import {
  ErrorBanner,
  PrimaryButton,
} from "../components/auth_ui";

// Settings lives at the bottom of the drawer. It shows the saved backend
// values, the active household invite code, and the check time.
export default function Settings() {
  const { activeHousehold, households, client, dataError, refreshSessionData } =
    useAuth();
  const [backend, setBackend] = useState<BackendConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [draftTime, setDraftTime] = useState(() => new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [savingCheck, setSavingCheck] = useState(false);

  // Saved backend values, same ones typed during register.
  // Falls back to the live client config and dev prefill, so this
  // never claims nothing is saved while the app is connected.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cfg =
        (await loadBackendConfig().catch(() => null)) ??
        getBackendConfigSync() ??
        getDevPrefill();
      if (alive) {
        setBackend(cfg);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function copy(label: string, text: string) {
    await Clipboard.setStringAsync(text);
    setCopied(label);
  }

  const checkAt = activeHousehold?.household.check_at ?? null;

  function formatSlot(iso: string): string {
    const d = new Date(iso);
    const day = d.toLocaleDateString([], {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    const time = d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${day} at ${time}`;
  }

  // Saves the picked time. The server pins the slot to the upcoming
  // Sunday, then the household list is reloaded so every screen agrees.
  async function onSaveCheckTime() {
    setCheckMsg(null);
    setCheckError(null);
    const home = activeHousehold?.household;
    if (!client || !home) {
      setCheckError("Join or create a household first.");
      return;
    }
    setSavingCheck(true);
    try {
      await setCheckTime(
        client,
        home.id,
        draftTime.getHours(),
        draftTime.getMinutes(),
      );
      await refreshSessionData();
      setCheckMsg("Check time saved.");
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingCheck(false);
    }
  }

  const maskedKey = backend
    ? showKey
      ? backend.anonKey
      : backend.anonKey.slice(0, 8) + "..." + backend.anonKey.slice(-4)
    : "";

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Settings</Text>

      {dataError ? (
        <>
          <ErrorBanner message={dataError} />
          <PrimaryButton title="Retry" onPress={() => refreshSessionData()} />
        </>
      ) : null}

      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="server" size={18} color={Colors.secondary} />
          <Text style={styles.cardTitle}>Backend connection</Text>
        </View>
        {loading ? (
          <ActivityIndicator color={Colors.primary} />
        ) : backend ? (
          <>
            <Text style={styles.label}>Supabase URL</Text>
            <View style={styles.valueRow}>
              <Text style={styles.value} numberOfLines={1}>
                {backend.url}
              </Text>
              <Pressable onPress={() => copy("url", backend.url)} hitSlop={8}>
                <Ionicons name="copy" size={18} color={Colors.muted} />
              </Pressable>
            </View>
            <Text style={styles.label}>Anon key</Text>
            <View style={styles.valueRow}>
              <Text style={styles.value} numberOfLines={1}>
                {maskedKey}
              </Text>
              <Pressable onPress={() => setShowKey((s) => !s)} hitSlop={8}>
                <Ionicons
                  name={showKey ? "eye-off" : "eye"}
                  size={18}
                  color={Colors.muted}
                />
              </Pressable>
              <Pressable
                onPress={() => copy("key", backend.anonKey)}
                hitSlop={8}
              >
                <Ionicons name="copy" size={18} color={Colors.muted} />
              </Pressable>
            </View>
            {copied && (
              <Text style={styles.copied}>Copied {copied} to clipboard.</Text>
            )}
          </>
        ) : (
          <Text style={styles.hint}>No backend saved on this device yet.</Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="ticket" size={18} color={Colors.secondary} />
          <Text style={styles.cardTitle}>Invite members</Text>
        </View>
        {activeHousehold ? (
          <>
            <Text style={styles.hint}>
              Members of {activeHousehold.household.name} join with this code.
            </Text>
            <Pressable
              style={styles.codeRow}
              onPress={() =>
                copy("code", activeHousehold.household.invite_code)
              }
            >
              <Text style={styles.code}>
                {activeHousehold.household.invite_code}
              </Text>
              <Ionicons name="copy" size={20} color={Colors.primary} />
            </Pressable>
          </>
        ) : (
          <Text style={styles.hint}>
            {households.length === 0
              ? "Join or create a household first."
              : "No active household selected."}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <View style={styles.row}>
          <Ionicons name="calendar" size={18} color={Colors.secondary} />
          <Text style={styles.cardTitle}>Weekly check</Text>
        </View>
        {activeHousehold ? (
          <>
            <Text style={styles.hint}>
              {checkAt
                ? `Next check for ${activeHousehold.household.name}: ${formatSlot(checkAt)}. Winner takes a gem, under 85% takes a strike.`
                : "No check scheduled yet."}
            </Text>
            <Pressable
              style={styles.valueRow}
              onPress={() => {
                if (checkAt) setDraftTime(new Date(checkAt));
                setShowPicker((s) => !s);
              }}
            >
              <Ionicons name="time" size={18} color={Colors.muted} />
              <Text style={styles.value}>
                {draftTime.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </Text>
              <Ionicons name="chevron-down" size={18} color={Colors.muted} />
            </Pressable>
            {showPicker && (
              <DateTimePicker
                value={draftTime}
                mode="time"
                is24Hour
                display="default"
                onChange={(_event, date) => {
                  if (date) setDraftTime(date);
                }}
              />
            )}
            <ErrorBanner message={checkError} />
            {checkMsg ? <Text style={styles.copied}>{checkMsg}</Text> : null}
            <PrimaryButton
              title="Save check time"
              onPress={onSaveCheckTime}
              loading={savingCheck}
            />
          </>
        ) : (
          <Text style={styles.hint}>
            {households.length === 0
              ? "Join or create a household first."
              : "No active household selected."}
          </Text>
        )}
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  title: { color: Colors.text, fontSize: 26, fontWeight: "800" },
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 18,
    padding: 16,
    gap: 10,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { color: Colors.text, fontWeight: "700", fontSize: 16 },
  label: { color: Colors.subtext1, fontSize: 13, fontWeight: "600" },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  value: { flex: 1, color: Colors.text, fontSize: 13 },
  hint: { color: Colors.muted, fontSize: 13 },
  copied: { color: Colors.success, fontSize: 13, fontWeight: "600" },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  code: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 4,
  },
});
