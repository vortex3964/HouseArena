import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Link, router } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import { getSupabase } from "../system/supabase";
import { pickProfilePhoto, updateProfile, uploadAvatar } from "../system/avatars";
import { isBackendDownError } from "../system/supabase";
import { toMessage } from "../system/errors";
import { Lengths, Messages, Routes } from "../global/constants";
import { Colors } from "../global/theme";
import {
  AuthScreen,
  ErrorBanner,
  Field,
  PrimaryButton,
} from "../components/auth_ui";
import { BackendGate, useBackendForm, useBusyGuard } from "../components/backend_form";
import { HouseholdForm } from "../components/household_form";

export default function Register() {
  const { backendReady, authLoading, signUp, configureBackend, client } = useAuth();
  const form = useBackendForm(backendReady, configureBackend);
  const accountGuard = useBusyGuard();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Step 2. With many households allowed, new users pick one path:
  // create a fresh household, join with a code, or skip for later.
  const [phase, setPhase] = useState<"account" | "household">("account");
  const [error, setError] = useState<string | null>(null);
  // Optional photo, picked before signup but uploadable only after it
  // (storage path and RLS both key off the new user id).
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Upload failed after the account already existed: offer a way out
  // instead of trapping the user, photo stays settable in profile.
  const [photoBlocked, setPhotoBlocked] = useState(false);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // Runs when Create account is tapped.
  // Example: ana@mail.com + ana + secret12 -> auth.users row created,
  // handle_new_user trigger builds the profile, session starts,
  // then we move to the household step below.
  async function onPickAvatar() {
    setPhotoError(null);
    try {
      const uri = await pickProfilePhoto();
      if (uri) {
        setAvatarUri(uri);
        setPhotoBlocked(false);
      }
    } catch (e) {
      setPhotoError(toMessage(e));
    }
  }

  async function onCreateAccount() {
    setError(null);
    try {
      await accountGuard.run(async () => {
        if (password !== confirm)
          throw new Error(Messages.PASSWORDS_MISMATCH);
        if (!(await form.ensureBackend())) return;
        const { userId } = await signUp(email, username, password);
        // Read the client fresh: on a first install it was just created
        // above, so the render-scope value may still be null here.
        const liveClient = client ?? getSupabase();
        if (avatarUri && liveClient) {
          try {
            const path = await uploadAvatar(liveClient, userId, avatarUri);
            await updateProfile(liveClient, userId, { avatar_url: path });
          } catch (e) {
            setPhotoError(toMessage(e));
            setPhotoBlocked(true);
            return;
          }
        }
        setPhase("household");
      });
    } catch (e) {
      setError(toMessage(e));
      if (isBackendDownError(e)) form.setBackendDown(true);
    }
  }

  if (phase === "household") {
    return (
      <HouseholdForm
        onSkip={() => router.replace(Routes.HOME)}
        notifyBackendDown={(e) => {
          if (isBackendDownError(e)) form.setBackendDown(true);
        }}
      />
    );
  }

  return (
    <AuthScreen
      eyebrow="HouseArena"
      title="Create account"
      subtitle="Email plus a unique username and password."
    >
      <BackendGate form={form} backendReady={backendReady} />

      <View style={styles.avatarWrap}>
        <Pressable onPress={onPickAvatar} accessibilityLabel="Choose profile photo">
          {avatarUri ? (
            <Image
              source={{ uri: avatarUri }}
              style={styles.avatarPicked}
              contentFit="cover"
            />
          ) : (
            <View style={styles.avatarEmpty}>
              <Ionicons name="camera" size={30} color={Colors.primary} />
              <Text style={styles.avatarHint}>Add photo</Text>
            </View>
          )}
        </Pressable>
      </View>
      {photoError ? <Text style={styles.photoError}>{photoError}</Text> : null}
      <Field
        label="Email"
        icon="mail"
        fieldKey="email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => usernameRef.current?.focus()}
        blurOnSubmit={false}
      />
      <Field
        label="Username"
        icon="person"
        fieldKey="username"
        ref={usernameRef}
        value={username}
        onChangeText={setUsername}
        maxLength={Lengths.USERNAME}
        autoComplete="username"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        blurOnSubmit={false}
      />
      <Field
        label="Password"
        icon="lock-closed"
        fieldKey="password"
        ref={passwordRef}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
        blurOnSubmit={false}
      />
      <Field
        label="Confirm password"
        icon="checkmark-circle"
        fieldKey="confirm"
        ref={confirmRef}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoComplete="password"
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={onCreateAccount}
      />

      <ErrorBanner message={error} />
      <PrimaryButton
        title={photoBlocked ? "Continue without photo" : "Create account"}
        onPress={photoBlocked ? () => setPhase("household") : onCreateAccount}
        loading={authLoading || accountGuard.busy}
      />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Have an account? </Text>
        <Link href={Routes.LOGIN} style={styles.link}>
          Log in
        </Link>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  avatarWrap: { alignItems: "center", marginVertical: 2 },
  avatarPicked: { width: 88, height: 88, borderRadius: 999 },
  avatarEmpty: {
    width: 88,
    height: 88,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: Colors.surface0,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: Colors.primary,
  },
  avatarHint: { color: Colors.subtext0, fontSize: 12, fontWeight: "600" },
  photoError: { color: Colors.danger, fontSize: 13, textAlign: "center" },
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 2 },
  footerText: { color: Colors.muted, fontSize: 14 },
  link: { color: Colors.primary, fontSize: 14, fontWeight: "700" },
});
