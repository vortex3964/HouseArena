import { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { useAuth } from "../system/AuthProvider";
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
  const { backendReady, authLoading, signUp, configureBackend } = useAuth();
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
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // Runs when Create account is tapped.
  // Example: ana@mail.com + ana + secret12 -> auth.users row created,
  // handle_new_user trigger builds the profile, session starts,
  // then we move to the household step below.
  async function onCreateAccount() {
    setError(null);
    try {
      await accountGuard.run(async () => {
        if (password !== confirm)
          throw new Error(Messages.PASSWORDS_MISMATCH);
        if (!(await form.ensureBackend())) return;
        await signUp(email, username, password);
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
        title="Create account"
        onPress={onCreateAccount}
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
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 2 },
  footerText: { color: Colors.muted, fontSize: 14 },
  link: { color: Colors.primary, fontSize: 14, fontWeight: "700" },
});
