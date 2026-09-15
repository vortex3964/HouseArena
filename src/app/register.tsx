import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import { getDevPrefill, isBackendDownError } from "../system/supabase";
import { Colors } from "../global/theme";
import {
  AuthScreen,
  BackendConfigFields,
  BackendRecoveryButtons,
  ErrorBanner,
  Field,
  PrimaryButton,
} from "../components/auth_ui";

// Same dev prefill as login, only used to save typing while coding.
const prefill = getDevPrefill();

export default function Register() {
  const {
    backendReady,
    authLoading,
    signUp,
    configureBackend,
    createHousehold,
    joinHousehold,
  } = useAuth();

  const [url, setUrl] = useState(prefill?.url ?? "");
  const [anonKey, setAnonKey] = useState(prefill?.anonKey ?? "");
  // True when the user taps "re-enter codes" after a failure.
  const [showBackend, setShowBackend] = useState(false);
  // True only after signup fails with a network-like error.
  const [backendDown, setBackendDown] = useState(false);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  // Step 2. With many households allowed, new users pick one path:
  // create a fresh household, join with a code, or skip for later.
  const [phase, setPhase] = useState<"account" | "household">("account");
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // Fresh install shows the code fields, working devices hide them.
  const needsBackend = !backendReady || showBackend;

  // Saves codes and builds the client when needed.
  // Skipped entirely when a working backend is already saved.
  async function ensureBackend() {
    if (needsBackend) {
      if (!url.trim() || !anonKey.trim())
        throw new Error("Paste your Supabase URL + anon key first.");
      await configureBackend(url, anonKey);
      setShowBackend(false);
      setBackendDown(false);
    }
  }

  // Runs when Create account is tapped.
  // Example: ana@mail.com + ana + secret12 -> auth.users row created,
  // handle_new_user trigger builds the profile, session starts,
  // then we move to the household step below.
  async function onCreateAccount() {
    setError(null);
    try {
      if (password !== confirm) throw new Error("Passwords don't match.");
      await ensureBackend();
      await signUp(email, username, password);
      setPhase("household");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (isBackendDownError(e)) setBackendDown(true);
    }
  }

  // Owner path. Example: "Sunset Flat" -> create_household RPC inserts
  // the row and adds you as owner, then you go to "/".
  async function onCreateHousehold() {
    setError(null);
    try {
      await createHousehold(householdName);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (isBackendDownError(e)) setBackendDown(true);
    }
  }

  // Member path. Example: code "KX7Q2M" -> join_household_by_code RPC
  // adds you as member, then you go to "/".
  async function onJoinHousehold() {
    setError(null);
    try {
      await joinHousehold(inviteCode);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (isBackendDownError(e)) setBackendDown(true);
    }
  }

  if (phase === "household") {
    return (
      <AuthScreen
        eyebrow="Almost done"
        title="Join a household"
        subtitle="Create your own, join with an invite code, or skip for later."
      >
        <Field
          label="New household name"
          icon="home"
          fieldKey="household-name"
          value={householdName}
          onChangeText={setHouseholdName}
          maxLength={50}
          returnKeyType="done"
          onSubmitEditing={onCreateHousehold}
        />
        <PrimaryButton
          title="Create household"
          onPress={onCreateHousehold}
          loading={authLoading}
        />
        <Field
          label="Invite code"
          icon="ticket"
          fieldKey="invite-code"
          value={inviteCode}
          onChangeText={(v) => setInviteCode(v.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={12}
          returnKeyType="done"
          onSubmitEditing={onJoinHousehold}
        />
        <PrimaryButton
          title="Join with code"
          onPress={onJoinHousehold}
          loading={authLoading}
        />
        <ErrorBanner message={error} />
        <Pressable onPress={() => router.replace("/")} hitSlop={8}>
          <Text style={styles.skip}>Skip for now</Text>
        </Pressable>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      eyebrow="HouseArena"
      title="Create account"
      subtitle="Email plus a unique username and password."
    >
      {needsBackend ? (
        <BackendConfigFields
          url={url}
          setUrl={setUrl}
          anonKey={anonKey}
          setAnonKey={setAnonKey}
          onCancel={backendReady ? () => setShowBackend(false) : undefined}
        />
      ) : backendDown ? (
        <BackendRecoveryButtons onReenter={() => setShowBackend(true)} />
      ) : null}

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
        maxLength={20}
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
        title="Create account"
        onPress={onCreateAccount}
        loading={authLoading}
      />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Have an account? </Text>
        <Link href="/login" style={styles.link}>
          Log in
        </Link>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 2 },
  footerText: { color: Colors.muted, fontSize: 14 },
  link: { color: Colors.primary, fontSize: 14, fontWeight: "700" },
  skip: {
    color: Colors.subtext0,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
