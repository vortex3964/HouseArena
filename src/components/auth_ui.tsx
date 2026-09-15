import { useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";

// Screen shell - badge, title, and card wrapper shared by login/register.

export function AuthScreen({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.badge}>
          <Ionicons name="home" size={26} color={Colors.onPrimary} />
        </View>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <View style={styles.card}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Labeled input row with an icon, used for every text field.

export function Field({
  label,
  icon,
  ...props
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <Ionicons name={icon} size={18} color={Colors.muted} />
        <TextInput
          style={styles.input}
          placeholderTextColor={Colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          {...props}
        />
      </View>
    </View>
  );
}

// Big primary button with a loading state.

export function PrimaryButton({
  title,
  onPress,
  loading,
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        styles.button,
        off && styles.buttonDisabled,
        pressed && !off && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonText}>{loading ? "Please wait…" : title}</Text>
    </Pressable>
  );
}

// Small red box that shows a form error, hidden when there is none.

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBox}>
      <Ionicons name="alert-circle" size={16} color={Colors.danger} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

// Backend credentials box. The owner pastes the Supabase URL and anon key
// once, by hand. QR scan will fill the same two fields later.
// Shown only when no backend is saved yet, or when the saved one fails.
export function BackendConfigFields({
  url,
  setUrl,
  anonKey,
  setAnonKey,
  onCancel,
  onQrPress,
}: {
  url: string;
  setUrl: (v: string) => void;
  anonKey: string;
  setAnonKey: (v: string) => void;
  onCancel?: () => void;
  onQrPress?: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  return (
    <View style={styles.backendBox}>
      <View style={styles.backendHeader}>
        <Ionicons name="server" size={16} color={Colors.secondary} />
        <Text style={styles.backendTitle}>Backend connection</Text>
      </View>
      <Text style={styles.backendHint}>
        Paste your Supabase URL + anon key once. Saved on this device.
      </Text>
      <Field
        label="Supabase URL"
        icon="link"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        keyboardType="url"
      />
      <View style={styles.fieldWrap}>
        <Text style={styles.label}>Anon key</Text>
        <View style={styles.inputRow}>
          <Ionicons name="key" size={18} color={Colors.muted} />
          <TextInput
            style={styles.input}
            value={anonKey}
            onChangeText={setAnonKey}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={!showKey}
            multiline={false}
          />
          <Pressable onPress={() => setShowKey((s) => !s)} hitSlop={8}>
            <Ionicons
              name={showKey ? "eye-off" : "eye"}
              size={18}
              color={Colors.muted}
            />
          </Pressable>
        </View>
      </View>
      {/* TODO: wire QR scan here with expo-camera. It should parse
          {"url": ..., "anonKey": ...} and call setUrl + setAnonKey. */}
      <View style={styles.backendActions}>
        <Pressable
          onPress={onQrPress}
          disabled={!onQrPress}
          style={[styles.backendBtn, !onQrPress && styles.backendBtnDisabled]}
        >
          <Ionicons name="qr-code" size={16} color={Colors.secondary} />
          <Text style={styles.backendBtnText}>Scan QR code</Text>
        </Pressable>
        {onCancel && (
          <Pressable onPress={onCancel} style={styles.backendBtn} hitSlop={8}>
            <Ionicons name="close" size={16} color={Colors.muted} />
            <Text style={styles.backendBtnText}>Cancel</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// Small recovery box. Rendered only after a backend failure so the normal
// login screen stays clean. One button re-opens the manual code fields,
// the other is reserved for QR scan.
export function BackendRecoveryButtons({
  onReenter,
  onQrPress,
}: {
  onReenter: () => void;
  onQrPress?: () => void;
}) {
  return (
    <View style={styles.backendBox}>
      <View style={styles.backendHeader}>
        <Ionicons name="cloud-offline" size={16} color={Colors.warning} />
        <Text style={styles.backendTitle}>Cannot reach backend</Text>
      </View>
      <Text style={styles.backendHint}>
        The saved connection failed. Re-enter the codes or scan the owner QR.
      </Text>
      <View style={styles.backendActions}>
        <Pressable onPress={onReenter} style={styles.backendBtn} hitSlop={8}>
          <Ionicons name="create" size={16} color={Colors.secondary} />
          <Text style={styles.backendBtnText}>Re-enter backend codes</Text>
        </Pressable>
        <Pressable
          onPress={onQrPress}
          disabled={!onQrPress}
          style={[styles.backendBtn, !onQrPress && styles.backendBtnDisabled]}
          hitSlop={8}
        >
          <Ionicons name="qr-code" size={16} color={Colors.secondary} />
          <Text style={styles.backendBtnText}>Scan QR instead</Text>
        </Pressable>
      </View>
      {/* TODO: implement QR scan screen with expo-camera, then pass onQrPress. */}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bgDeep },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 32,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    shadowColor: Colors.primary,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 6,
  },
  eyebrow: {
    color: Colors.secondary,
    fontWeight: "700",
    letterSpacing: 2,
    fontSize: 12,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  title: { color: Colors.text, fontSize: 30, fontWeight: "800", marginBottom: 6 },
  subtitle: { color: Colors.subtext0, fontSize: 14, marginBottom: 20 },
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 22,
    padding: 18,
    gap: 14,
  },
  fieldWrap: { gap: 6 },
  label: { color: Colors.subtext1, fontSize: 13, fontWeight: "600" },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  input: { flex: 1, color: Colors.text, fontSize: 15 },
  errorBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    backgroundColor: "rgba(243,139,168,0.10)",
    borderWidth: 1,
    borderColor: "rgba(243,139,168,0.35)",
    borderRadius: 12,
    padding: 10,
  },
  errorText: { flex: 1, color: Colors.danger, fontSize: 13 },
  backendBox: {
    backgroundColor: Colors.bgSoft,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 16,
    padding: 12,
    gap: 10,
  },
  backendHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  backendTitle: { color: Colors.text, fontWeight: "700", fontSize: 14 },
  backendHint: { color: Colors.muted, fontSize: 12 },
  backendActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  backendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.bg,
  },
  backendBtnDisabled: { opacity: 0.45 },
  backendBtnText: { color: Colors.text, fontSize: 13, fontWeight: "600" },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: Colors.onPrimary, fontWeight: "800", fontSize: 16 },
});
