import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  findNodeHandle,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Colors } from "../global/theme";

// Shared scroller so any Field can bring itself above the keyboard.
type AuthScroll = {
  getScrollHandle: () => number | null;
  smoothScroll: (y: number) => void;
};
const AuthScrollCtx = createContext<AuthScroll | null>(null);

// Screen shell

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
  const scrollRef = useRef<ScrollView>(null);
  const [kbHeight, setKbHeight] = useState(0);

  // Track keyboard height so the last fields can scroll above it.
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) =>
      setKbHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const getScrollHandle = useCallback(
    () =>
      scrollRef.current ? findNodeHandle(scrollRef.current) : null,
    [],
  );
  const smoothScroll = useCallback((y: number) => {
    scrollRef.current?.scrollTo({ y, animated: true });
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // iOS shifts the layout, Android resizes the window instead
      // (see softwareKeyboardLayoutMode in app.json).
      enabled={Platform.OS === "ios"}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <AuthScrollCtx.Provider value={{ getScrollHandle, smoothScroll }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: 24 + kbHeight },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Image
            source={require("../../assets/images/appImages/logo.png")}
            style={styles.badge}
          />
          <Text style={styles.eyebrow}>{eyebrow}</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
          <View style={styles.card}>{children}</View>
        </ScrollView>
      </AuthScrollCtx.Provider>
    </KeyboardAvoidingView>
  );
}

// Hook that scrolls a wrapped input above the keyboard on focus.
// Returns a ref for the wrapper View plus an onFocus handler.
export function useFieldScroller() {
  const scroller = useContext(AuthScrollCtx);
  const wrapRef = useRef<View>(null);

  const onFocusInput = useCallback(() => {
    // Web scrolls focused inputs into view by itself, and its
    // findNodeHandle throws instead of measuring, so skip it there.
    if (Platform.OS === "web") return;
    const node = findNodeHandle(wrapRef.current);
    const parent = scroller?.getScrollHandle();
    if (node != null && parent != null) {
      UIManager.measureLayout(node, parent, () => {}, (_x, y) =>
        scroller?.smoothScroll(Math.max(0, y - 96)),
      );
    }
  }, [scroller]);

  return { wrapRef, onFocusInput };
}

// Labeled input row with an icon, used for every text field.
export function Field({
  label,
  icon,
  fieldKey,
  onFocus,
  ref,
  ...props
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  fieldKey?: string;
  ref?: React.Ref<TextInput>;
} & React.ComponentProps<typeof TextInput>) {
  const { wrapRef, onFocusInput } = useFieldScroller();

  // Scroll the tapped field above the keyboard when it gains focus.
  function handleFocus(e: Parameters<NonNullable<typeof onFocus>>[0]) {
    if (fieldKey) onFocusInput();
    onFocus?.(e);
  }

  return (
    <View ref={wrapRef} collapsable={false} style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <Ionicons name={icon} size={18} color={Colors.muted} />
        <TextInput
          ref={ref}
          style={styles.input}
          placeholderTextColor={Colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          {...props}
          onFocus={handleFocus}
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
// once, by hand. Shown only when no backend is saved yet.
export function BackendConfigFields({
  url,
  setUrl,
  anonKey,
  setAnonKey,
  onCancel,
}: {
  url: string;
  setUrl: (v: string) => void;
  anonKey: string;
  setAnonKey: (v: string) => void;
  onCancel?: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const { wrapRef, onFocusInput } = useFieldScroller();
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
        fieldKey="backend-url"
        value={url}
        onChangeText={setUrl}
        autoCapitalize="none"
        keyboardType="url"
        autoComplete="off"
      />
      <View ref={wrapRef} collapsable={false} style={styles.fieldWrap}>
        <Text style={styles.label}>Anon key</Text>
        <View style={styles.inputRow}>
          <Ionicons name="key" size={18} color={Colors.muted} />
          <TextInput
            style={styles.input}
            value={anonKey}
            onChangeText={setAnonKey}
            onFocus={onFocusInput}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
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
      {onCancel && (
        <View style={styles.backendActions}>
          <Pressable onPress={onCancel} style={styles.backendBtn} hitSlop={8}>
            <Ionicons name="close" size={16} color={Colors.muted} />
            <Text style={styles.backendBtnText}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// Small recovery box. Rendered only after a backend failure so the normal
// login screen stays clean. Its button re-opens the manual code fields.
export function BackendRecoveryButtons({
  onReenter,
}: {
  onReenter: () => void;
}) {
  return (
    <View style={styles.backendBox}>
      <View style={styles.backendHeader}>
        <Ionicons name="cloud-offline" size={16} color={Colors.warning} />
        <Text style={styles.backendTitle}>Cannot reach backend</Text>
      </View>
      <Text style={styles.backendHint}>
        The saved connection failed. Re-enter the backend codes below.
      </Text>
      <View style={styles.backendActions}>
        <Pressable onPress={onReenter} style={styles.backendBtn} hitSlop={8}>
          <Ionicons name="create" size={16} color={Colors.secondary} />
          <Text style={styles.backendBtnText}>Re-enter backend codes</Text>
        </Pressable>
      </View>
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
    marginBottom: 18,
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
