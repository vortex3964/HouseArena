import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Link, router } from "expo-router";
import { useURL } from "expo-linking";
import { useAuth } from "../../system/AuthProvider";
import { Colors } from "../../global/theme";
import { AuthScreen, ErrorBanner } from "../../components/auth_ui";

// Landing screen for email confirmation links. Supabase verifies the
// address, then reopens the app here with a code (or tokens) attached.
// This screen trades them for a real session, then moves on.
export default function AuthCallback() {
  const { client } = useAuth();
  const url = useURL();
  const [handled, setHandled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url || handled) return;
    setHandled(true);
    (async () => {
      try {
        if (!client)
          throw new Error("Connect your backend first, then open the link again.");
        // Tokens may hide in the query (?code=) or the hash (#access_token=).
        const query = url.split("?")[1] ?? "";
        const [search = "", hash = ""] = query.split("#");
        const q = new URLSearchParams(search);
        const h = new URLSearchParams(hash);
        if (q.get("error") || h.get("error")) {
          throw new Error(
            q.get("error_description") ??
              h.get("error_description") ??
              "This confirmation link is expired or already used. Register again or log in.",
          );
        }
        const code = q.get("code");
        const accessToken = h.get("access_token");
        const refreshToken = h.get("refresh_token");
        if (code) {
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (accessToken && refreshToken) {
          const { error } = await client.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
        } else {
          throw new Error("This link has nothing to confirm. Try logging in.");
        }
        router.replace("/");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [url, handled, client]);

  return (
    <AuthScreen
      eyebrow="HouseArena"
      title="Confirming email"
      subtitle="One moment while your address is verified."
    >
      {error ? (
        <>
          <ErrorBanner message={error} />
          <View style={styles.footer}>
            <Link href="/login" style={styles.link}>
              Back to login
            </Link>
          </View>
        </>
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.hint}>Finishing sign in…</Text>
        </View>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  loading: { alignItems: "center", gap: 12, paddingVertical: 12 },
  hint: { color: Colors.subtext0, fontSize: 14 },
  footer: { alignItems: "center" },
  link: { color: Colors.primary, fontSize: 14, fontWeight: "700" },
});
