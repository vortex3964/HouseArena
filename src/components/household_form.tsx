import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { useAuth } from "../system/AuthProvider";
import { toMessage } from "../system/errors";
import { Lengths, Routes } from "../global/constants";
import { Colors } from "../global/theme";
import {
  AuthScreen,
  ErrorBanner,
  Field,
  PrimaryButton,
} from "./auth_ui";
import { useBusyGuard } from "./backend_form";

// Create-or-join form used by register's household step and the
// standalone household setup screen. Same fields, same rules.
export function HouseholdForm({
  onSkip,
  notifyBackendDown,
}: {
  onSkip?: () => void;
  notifyBackendDown?: (e: unknown) => void;
}) {
  const { authLoading, createHousehold, joinHousehold } = useAuth();
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const guard = useBusyGuard();

  // Owner path, creates a household and makes you its owner.
  async function onCreate() {
    setError(null);
    try {
      await guard.run(async () => {
        await createHousehold(householdName);
        router.replace(Routes.HOME);
      });
    } catch (e) {
      setError(toMessage(e));
      notifyBackendDown?.(e);
    }
  }

  // Member path, joins with the invite code from another member.
  async function onJoin() {
    setError(null);
    try {
      await guard.run(async () => {
        await joinHousehold(inviteCode);
        router.replace(Routes.HOME);
      });
    } catch (e) {
      setError(toMessage(e));
      notifyBackendDown?.(e);
    }
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
        fieldKey="household-name"
        value={householdName}
        onChangeText={setHouseholdName}
        maxLength={Lengths.HOUSEHOLD_NAME}
        returnKeyType="done"
        onSubmitEditing={onCreate}
      />
      <PrimaryButton
        title="Create household"
        onPress={onCreate}
        loading={authLoading || guard.busy}
      />
      <Field
        label="Invite code"
        icon="ticket"
        fieldKey="invite-code"
        value={inviteCode}
        onChangeText={(v) => setInviteCode(v.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={Lengths.INVITE_CODE}
        returnKeyType="done"
        onSubmitEditing={onJoin}
      />
      <PrimaryButton
        title="Join with code"
        onPress={onJoin}
        loading={authLoading || guard.busy}
      />
      <ErrorBanner message={error} />
      {onSkip && (
        <Pressable onPress={onSkip} hitSlop={8}>
          <Text style={styles.skip}>Skip for now</Text>
        </Pressable>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  skip: {
    color: Colors.subtext0,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
});
