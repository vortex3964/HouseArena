import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import {
  getBackendConfigSync,
  isBackendDownError,
  validatePassword,
} from "../system/supabase";
import { requestResetCode, confirmResetCode } from "../system/push";
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

export default function Login() {
  const { backendReady, authLoading, signIn, configureBackend } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const passwordRef = useRef<TextInput>(null);
  const form = useBackendForm(backendReady, configureBackend);
  const loginGuard = useBusyGuard();

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

  // Runs when Log in is tapped. Email + password go straight to
  // Supabase; usernames are display-only and never identify an account.
  // Example 1: backend saved + correct login -> configure skipped,
  // signIn succeeds, you go home.
  // Example 2: fresh install -> configureBackend saves codes and builds
  // the client first, then signIn runs against it.
  // Example 3: saved backend is wrong or offline -> signIn throws a
  // fetch error, we set backendDown so the recovery buttons appear.
  async function onLogin() {
    setError(null);
    try {
      await loginGuard.run(async () => {
        if (!(await form.ensureBackend())) return;
        await signIn(email, password);
        router.replace(Routes.HOME);
      });
    } catch (e) {
      setError(toMessage(e));
      if (isBackendDownError(e)) form.setBackendDown(true);
    }
  }

  // Step 1 pushes a reset code to the account owner's device.
  // Answer stays generic so the box cannot probe which emails exist.
  async function onReset() {
    setResetMsg(null);
    const cfg = getBackendConfigSync();
    if (!cfg) {
      setResetMsg(Messages.BACKEND_CONNECT_FIRST);
      return;
    }
    setResetting(true);
    try {
      await requestResetCode(cfg.url, cfg.anonKey, resetEmail);
      setResetStep("code");
      setResetMsg("If that email has an account, the code is on its way.");
    } catch (e) {
      setResetMsg(toMessage(e));
    } finally {
      setResetting(false);
    }
  }

  // Step 2 spends the pushed code for the new password.
  async function onConfirmReset() {
    setResetMsg(null);
    if (resetPw !== resetConfirm) {
      setResetMsg(Messages.PASSWORDS_MISMATCH);
      return;
    }
    const pwErr = validatePassword(resetPw);
    if (pwErr) {
      setResetMsg(pwErr);
      return;
    }
    const cfg = getBackendConfigSync();
    if (!cfg) {
      setResetMsg(Messages.BACKEND_CONNECT_FIRST);
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
      setResetMsg(toMessage(e));
    } finally {
      setResetting(false);
    }
  }

  return (
    <AuthScreen
      eyebrow="HouseArena"
      title="Welcome back"
      subtitle="Type your email + password to jump into your household."
    >
      {/* First run: no backend saved yet, so ask for codes right away. */}
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
      <PrimaryButton
        title="Log in"
        onPress={onLogin}
        loading={authLoading || loginGuard.busy}
      />

      {!form.needsBackend && (
        <Pressable onPress={() => setShowReset((s) => !s)} hitSlop={8}>
          <Text style={styles.forgot}>Forgot password?</Text>
        </Pressable>
      )}
      {showReset && !form.needsBackend && (
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
                maxLength={Lengths.RESET_CODE}
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
        <Link href={Routes.REGISTER} style={styles.link}>
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
