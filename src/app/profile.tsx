import { useEffect, useState } from "react";
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
import * as Clipboard from "expo-clipboard";
import { Colors } from "../global/theme";
import { useAuth } from "../system/AuthProvider";
import {
  pickProfilePhoto,
  updateProfile,
  uploadAvatar,
  useAvatarUrl,
  type PickedPhoto,
} from "../system/avatars";
import { toMessage } from "../system/errors";
import { ErrorBanner } from "../components/auth_ui";
import { AvatarImage } from "../components/AvatarImage";

const RADIUS = 18;

function AccountCard({
  username,
  email,
  avatarUrl,
  saving,
  onPickPhoto,
}: {
  username: string;
  email: string;
  avatarUrl: string | null;
  saving: boolean;
  onPickPhoto: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.accountRow}>
        <Pressable onPress={onPickPhoto} accessibilityLabel="Change photo">
          <AvatarImage uri={avatarUrl} size={64} />
          <View style={styles.badge}>
            {saving ? (
              <ActivityIndicator size={12} color={Colors.onPrimary} />
            ) : (
              <Ionicons name="camera" size={14} color={Colors.onPrimary} />
            )}
          </View>
        </Pressable>
        <View style={styles.accountBody}>
          <Text style={styles.accountName} numberOfLines={1}>
            {username}
          </Text>
          <Text style={styles.accountEmail} numberOfLines={1}>
            {email}
          </Text>
        </View>
      </View>
    </View>
  );
}

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
      <Ionicons name={icon} size={18} color={color} />
      <Text style={styles.statValue}>{(value ?? 0).toLocaleString()}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function NavRow({
  icon,
  label,
  value,
  tint,
  disabled,
  onPress,
  isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string;
  tint?: string;
  disabled?: boolean;
  onPress?: () => void;
  isLast?: boolean;
}) {
  const content = (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={18} color={tint ?? Colors.secondary} />
        <Text style={[styles.rowLabel, tint ? { color: tint } : null]}>
          {label}
        </Text>
      </View>
      <View style={styles.rowRight}>
        {value ? (
          <Text style={styles.rowValue} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {onPress ? (
          <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
        ) : null}
      </View>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {content}
    </Pressable>
  );
}

export default function Profile() {
  const {
    profile,
    client,
    sessionUserId,
    refreshSessionData,
    activeHousehold,
    households,
    signOut,
  } = useAuth();
  const avatarUrl = useAvatarUrl(client, profile?.avatar_url ?? null);

  const [editingName, setEditingName] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState<PickedPhoto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localSaving, setLocalSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (editingName && profile) {
      setUsernameDraft(profile.username);
      setError(null);
    }
  }, [editingName, profile]);

  async function onPickPhoto() {
    setError(null);
    try {
      const picked = await pickProfilePhoto();
      if (!picked || !client || !sessionUserId || !profile) return;
      setLocalSaving(true);
      const avatarPath = await uploadAvatar(client, sessionUserId, picked);
      await updateProfile(client, sessionUserId, { avatar_url: avatarPath });
      setPendingPhoto(picked);
      await refreshSessionData();
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLocalSaving(false);
    }
  }

  async function onSaveUsername() {
    setError(null);
    if (!client || !sessionUserId || !profile) return;
    const trimmed = usernameDraft.trim();
    if (trimmed === profile.username) {
      setEditingName(false);
      return;
    }
    setLocalSaving(true);
    try {
      await updateProfile(client, sessionUserId, { username: trimmed });
      await refreshSessionData();
      setEditingName(false);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setLocalSaving(false);
    }
  }

  async function onCopyInvite() {
    if (!activeHousehold) return;
    await Clipboard.setStringAsync(activeHousehold.household.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!profile) {
    return (
      <View style={styles.screen}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  const displayAvatar = pendingPhoto?.uri ?? avatarUrl;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <AccountCard
        username={profile.username}
        email={profile.email ?? ""}
        avatarUrl={displayAvatar}
        saving={localSaving}
        onPickPhoto={onPickPhoto}
      />

      <View style={styles.stats}>
        <StatBox
          icon="star"
          value={profile.points}
          label="Points"
          color={Colors.peach}
        />
        <StatBox
          icon="diamond"
          value={profile.gems}
          label="Gems"
          color={Colors.teal}
        />
        <StatBox
          icon="trophy"
          value={profile.wins}
          label="Wins"
          color={Colors.yellow}
        />
      </View>

      <SectionHeader title="ACCOUNT" />
      <View style={styles.card}>
        {editingName ? (
          <View style={styles.editRow}>
            <TextInput
              style={styles.editInput}
              value={usernameDraft}
              onChangeText={setUsernameDraft}
              maxLength={20}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={Colors.muted}
              placeholder="Username"
              autoFocus
            />
            <View style={styles.editActions}>
              <Pressable
                onPress={onSaveUsername}
                disabled={localSaving}
                style={styles.editBtn}
              >
                {localSaving ? (
                  <ActivityIndicator size={14} color={Colors.primary} />
                ) : (
                  <Text style={styles.editSave}>Save</Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => setEditingName(false)}
                style={styles.editBtn}
              >
                <Text style={styles.editCancel}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <NavRow
            icon="person"
            label="Username"
            value={`@${profile.username}`}
            onPress={() => setEditingName(true)}
            isLast
          />
        )}
      </View>

      <SectionHeader title="EMAIL" />
      <View style={styles.card}>
        <NavRow
          icon="mail"
          label={profile.email ?? "No email"}
          isLast
        />
      </View>

      <ErrorBanner message={error} />

      <SectionHeader title="HOUSEHOLD" />
      <View style={styles.card}>
        {activeHousehold ? (
          <>
            <NavRow
              icon="home"
              label="Name"
              value={activeHousehold.household.name}
            />
            <View style={[styles.row, styles.rowBorder]}>
              <View style={styles.rowLeft}>
                <Ionicons
                  name="ticket"
                  size={18}
                  color={Colors.secondary}
                />
                <Text style={styles.rowLabel}>Invite code</Text>
              </View>
              <Pressable onPress={onCopyInvite} style={styles.rowRight}>
                <Text style={styles.rowValue}>
                  {activeHousehold.household.invite_code}
                </Text>
                <Ionicons
                  name={copied ? "checkmark" : "copy"}
                  size={16}
                  color={copied ? Colors.success : Colors.muted}
                />
              </Pressable>
            </View>
          </>
        ) : (
          <NavRow
            icon="home"
            label={
              households.length === 0
                ? "No household yet"
                : "No household selected"
            }
            isLast
          />
        )}
      </View>

      <SectionHeader title="SESSION" />
      <View style={styles.card}>
        <NavRow
          icon="log-out"
          label="Log Out"
          tint={Colors.danger}
          onPress={signOut}
          isLast
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDeep },
  content: { padding: 20, paddingBottom: 48, gap: 16 },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.bgDeep,
  },

  // Account card
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: RADIUS,
    overflow: "hidden",
  },
  accountRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  badge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
    borderWidth: 2,
    borderColor: Colors.card,
  },
  accountBody: { flex: 1 },
  accountName: { color: Colors.text, fontSize: 17, fontWeight: "700" },
  accountEmail: { color: Colors.subtext0, fontSize: 13, marginTop: 2 },

  // Stats
  stats: { flexDirection: "row", gap: 10 },
  stat: {
    flex: 1,
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    paddingVertical: 14,
  },
  statValue: { color: Colors.text, fontWeight: "800", fontSize: 18 },
  statLabel: { color: Colors.subtext0, fontSize: 12 },

  // Section headers
  sectionTitle: {
    color: Colors.muted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginLeft: 4,
  },

  // Row items
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    minHeight: 50,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.borderSoft },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  rowLabel: { color: Colors.text, fontSize: 15, fontWeight: "500" },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowValue: { color: Colors.subtext0, fontSize: 14, maxWidth: 160 },

  // Inline username editor
  editRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  editInput: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: Colors.text,
    fontSize: 15,
  },
  editActions: { flexDirection: "row", gap: 12, justifyContent: "flex-end" },
  editBtn: { paddingVertical: 4, paddingHorizontal: 8 },
  editSave: { color: Colors.primary, fontSize: 14, fontWeight: "700" },
  editCancel: { color: Colors.muted, fontSize: 14, fontWeight: "600" },

  // Footer
  footer: {
    color: Colors.disabled,
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
  },

  pressed: { opacity: 0.6 },
});
