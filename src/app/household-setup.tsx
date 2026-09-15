import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import { Colors } from "../global/theme";
import {
  AuthScreen,
  ErrorBanner,
  Field,
  PrimaryButton,
} from "../components/auth_ui";

// Shown to logged-in users with zero households.
// Same three paths as the register household step.
export default function HouseholdSetup() {
  const { authLoading, createHousehold, joinHousehold, skipHouseholdSetup } =
    useAuth();
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Owner path, creates a household and makes you its owner.
  async function onCreate() {
    setError(null);
    try {
      await createHousehold(householdName);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Member path, joins with the 6-letter code from another member.
  async function onJoin() {
    setError(null);
    try {
      await joinHousehold(inviteCode);
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Enters the app without a household, asked again next login.
  function onSkip() {
    skipHouseholdSetup();
    router.replace("/");
  }

  return (
    <AuthScreen
      eyebrow="Almost done"
      title="Join a household"
      subtitle="Create your own, join with an invite code, or skip for later."
    >
      <Field
        label="New household name"
        icon="home"
        value={householdName}
        onChangeText={setHouseholdName}
        maxLength={50}
      />
      <PrimaryButton
        title="Create household"
        onPress={onCreate}
        loading={authLoading}
      />
      <Text style={styles.dividerText}>or</Text>
      <Field
        label="Invite code"
        icon="ticket"
        value={inviteCode}
        onChangeText={(v) => setInviteCode(v.toUpperCase())}
        autoCapitalize="characters"
        maxLength={12}
      />
      <PrimaryButton
        title="Join with code"
        onPress={onJoin}
        loading={authLoading}
      />
      <ErrorBanner message={error} />
      <Pressable onPress={onSkip} hitSlop={8}>
        <Text style={styles.skip}>Skip for now</Text>
      </Pressable>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  dividerText: {
    color: Colors.muted,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  skip: {
    color: Colors.subtext0,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
