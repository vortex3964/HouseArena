import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import {
  getBackendConfigSync,
  getDevPrefill,
  isBackendDownError,
} from "../system/supabase";
import { requestResetCode, confirmResetCode } from "../system/push";
import { Colors } from "../global/theme";
import {
  AuthScreen,
  BackendConfigFields,
  BackendRecoveryButtons,
  ErrorBanner,
  Field,
  PrimaryButton,
} from "../components/auth_ui";

// Dev prefill so you do not retype the URL and key while coding.
// Real users never see .env, they type the codes inside the app.
const prefill = getDevPrefill();

export default function Login() {
  const { backendReady, authLoading, signIn, configureBackend } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const passwordRef = useRef<TextInput>(null);

  // Backend form state. Hidden most of the time on purpose.
  const [url, setUrl] = useState(prefill?.url ?? "");
  const [anonKey, setAnonKey] = useState(prefill?.anonKey ?? "");
  // True when the user taps "re-enter codes" after a failure.
  const [showBackend, setShowBackend] = useState(false);
  // True only after login fails with a network-like error.
  const [backendDown, setBackendDown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Forgot password box, hidden until the link below is tapped.
  const [showReset, setShowReset] = useState(false);
  const [resetStep, setResetStep] = useState<"email" | "code">("email");
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPw, setResetPw] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Example: fresh install has backendReady false, so this is true
  // and the code fields show. Normal login has it false, so you
  // only see username and password.
  const needsBackend = !backendReady || showBackend;

  // Runs when Log in is tapped. Username resolves to the register email
  // through get_email_for_username first, then Supabase signs in.
  // Example 1: backend saved + correct login -> configure skipped,
  // signIn succeeds, you go to "/".
  // Example 2: fresh install -> configureBackend saves codes and builds
  // the client first, then signIn runs against it.
  // Example 3: saved backend is wrong or offline -> signIn throws a
  // fetch error, we set backendDown so the recovery buttons appear.
  async function onLogin() {
    setError(null);
    try {
      if (needsBackend) {
        if (!url.trim() || !anonKey.trim())
          throw new Error("Paste your Supabase URL + anon key first.");
        await configureBackend(url, anonKey);
        setShowBackend(false);
        setBackendDown(false);
      }
      await signIn(username, password);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (isBackendDownError(e)) setBackendDown(true);
    }
  }

  // Step 1 pushes a reset code to the account owner's device.
  // Answer stays generic so the box cannot probe which emails exist.
  async function onReset() {
    setResetMsg(null);
    const cfg = getBackendConfigSync();
    if (!cfg) {
      setResetMsg("Connect your backend first.");
      return;
    }
    setResetting(true);
    try {
      await requestResetCode(cfg.url, cfg.anonKey, resetEmail);
      setResetStep("code");
      setResetMsg("If that email has an account, the code is on its way.");
    } finally {
      setResetting(false);
    }
  }

  // Step 2 spends the pushed code for the new password.
  async function onConfirmReset() {
    setResetMsg(null);
    if (resetPw !== resetConfirm) {
      setResetMsg("Passwords don't match.");
      return;
    }
    const cfg = getBackendConfigSync();
    if (!cfg) {
      setResetMsg("Connect your backend first.");
      return;
    }
    setResetting(true);
    try {
      await confirmResetCode(cfg.url, cfg.anonKey, resetEmail, resetCode, resetPw);
      setResetMsg("Password updated, log in with it.");
      setResetStep("email");
      setResetCode("");
      setResetPw("");
      setResetConfirm("");
    } catch (e) {
      setResetMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setResetting(false);
    }
  }

  return (
    <AuthScreen
      eyebrow="HouseArena"
      title="Welcome back"
      subtitle="Type your username + password to jump into your household."
    >
      {/* First run: no backend saved yet, so ask for codes right away. */}
      {needsBackend ? (
        <BackendConfigFields
          url={url}
          setUrl={setUrl}
          anonKey={anonKey}
          setAnonKey={setAnonKey}
          // Let the user back out if a backend was already saved.
          onCancel={backendReady ? () => setShowBackend(false) : undefined}
        />
      ) : backendDown ? (
        // Only after a connection failure: two ways back in.
        <BackendRecoveryButtons onReenter={() => setShowBackend(true)} />
      ) : null}

      <Field
        label="Username"
        icon="person"
        fieldKey="username"
        value={username}
        onChangeText={setUsername}
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
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={onLogin}
      />

      <ErrorBanner message={error} />
      <PrimaryButton title="Log in" onPress={onLogin} loading={authLoading} />

      {!needsBackend && (
        <Pressable onPress={() => setShowReset((s) => !s)} hitSlop={8}>
          <Text style={styles.forgot}>Forgot password?</Text>
        </Pressable>
      )}
      {showReset && !needsBackend && (
        <>
          <Field
            label="Account email"
            icon="mail"
            fieldKey="reset-email"
            value={resetEmail}
            onChangeText={setResetEmail}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="done"
            onSubmitEditing={
              resetStep === "email" ? onReset : onConfirmReset
            }
          />
          {resetStep === "code" && (
            <>
              <Field
                label="Reset code"
                icon="key"
                fieldKey="reset-code"
                value={resetCode}
                onChangeText={setResetCode}
                keyboardType="number-pad"
                maxLength={6}
              />
              <Field
                label="New password"
                icon="lock-closed"
                fieldKey="reset-password"
                value={resetPw}
                onChangeText={setResetPw}
                secureTextEntry
                autoComplete="password"
                textContentType="newPassword"
              />
              <Field
                label="Confirm new password"
                icon="checkmark-circle"
                fieldKey="reset-confirm"
                value={resetConfirm}
                onChangeText={setResetConfirm}
                secureTextEntry
                autoComplete="password"
                textContentType="newPassword"
                returnKeyType="done"
                onSubmitEditing={onConfirmReset}
              />
            </>
          )}
          {resetMsg ? <Text style={styles.resetMsg}>{resetMsg}</Text> : null}
          <PrimaryButton
            title={resetStep === "email" ? "Send reset code" : "Reset password"}
            onPress={resetStep === "email" ? onReset : onConfirmReset}
            loading={resetting}
          />
        </>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>New here? </Text>
        <Link href="/register" style={styles.link}>
          Create account
        </Link>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: "row", justifyContent: "center", marginTop: 2 },
  footerText: { color: Colors.muted, fontSize: 14 },
  link: { color: Colors.primary, fontSize: 14, fontWeight: "700" },
  forgot: {
    color: Colors.subtext0,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  resetMsg: { color: Colors.success, fontSize: 13, textAlign: "center" },
});
