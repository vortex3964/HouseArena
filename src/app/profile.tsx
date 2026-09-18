import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";
import { useAuth } from "../system/AuthProvider";
import {
  pickProfilePhoto,
  updateProfile,
  uploadAvatar,
  useAvatarUrl,
} from "../system/avatars";
import { toMessage } from "../system/errors";
import { AuthScreen, ErrorBanner, Field, PrimaryButton } from "../components/auth_ui";
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

export default function Profile() {
  const { profile, client, sessionUserId, refreshSessionData } = useAuth();
  const avatarUrl = useAvatarUrl(client, profile?.avatar_url ?? null);

  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seed the editor from the loaded profile every time editing starts.
  useEffect(() => {
    if (editing && profile) {
      setUsername(profile.username);
      setPendingPhoto(null);
      setError(null);
    }
  }, [editing, profile]);

  async function onPickPhoto() {
    setError(null);
    try {
      const uri = await pickProfilePhoto();
      if (uri) setPendingPhoto(uri);
    } catch (e) {
      setError(toMessage(e));
    }
  }

  async function onSave() {
    setError(null);
    if (!client || !sessionUserId || !profile) return;
    const nameChanged = username.trim() !== profile.username;
    const photoChanged = pendingPhoto !== null;
    if (!nameChanged && !photoChanged) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      let avatarPath = profile.avatar_url;
      if (photoChanged && pendingPhoto) {
        avatarPath = await uploadAvatar(client, sessionUserId, pendingPhoto);
      }
      await updateProfile(client, sessionUserId, {
        ...(nameChanged ? { username } : {}),
        ...(photoChanged ? { avatar_url: avatarPath } : {}),
      });
      await refreshSessionData();
      setEditing(false);
    } catch (e) {
      setError(toMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!profile) {
    return (
      <AuthScreen
        eyebrow="HouseArena"
        title="Profile"
        subtitle="Your profile is still loading."
      >
        <View style={styles.center}>
          <AvatarImage uri={null} size={96} />
        </View>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen eyebrow="HouseArena" title="Profile" subtitle={`@${profile.username}`}>
      <View style={styles.center}>
        {editing ? (
          <Pressable onPress={onPickPhoto} accessibilityLabel="Change photo">
            <AvatarImage uri={pendingPhoto ?? avatarUrl} size={96} />
            <View style={styles.badge}>
              <Ionicons name="camera" size={16} color={Colors.onPrimary} />
            </View>
          </Pressable>
        ) : (
          <AvatarImage uri={avatarUrl} size={96} />
        )}
      </View>

      {!editing ? (
        <>
          <View style={styles.stats}>
            <StatBox icon="star" value={profile.points} label="Points" color={Colors.peach} />
            <StatBox icon="diamond" value={profile.gems} label="Gems" color={Colors.teal} />
            <StatBox icon="trophy" value={profile.wins} label="Wins" color={Colors.yellow} />
          </View>
          <Text style={styles.email}>{profile.email ?? ""}</Text>
          <PrimaryButton title="Edit profile" onPress={() => setEditing(true)} />
        </>
      ) : (
        <>
          <Field
            label="Username"
            icon="person"
            fieldKey="profile-username"
            value={username}
            onChangeText={setUsername}
            maxLength={20}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <ErrorBanner message={error} />
          <PrimaryButton title="Save" onPress={onSave} loading={saving} />
          <Pressable
            onPress={() => setEditing(false)}
            hitSlop={8}
            style={styles.cancelWrap}
          >
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", marginVertical: 4 },
  badge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
  },
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
  cancelWrap: { alignItems: "center", paddingVertical: 4 },
  cancel: { color: Colors.subtext0, fontSize: 14, fontWeight: "600" },
});
