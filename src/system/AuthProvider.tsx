import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { connectBackend, restoreBackend } from "./supabase";
import {
  createHousehold,
  fetchMyHouseholds,
  fetchMyProfile,
  joinHouseholdByCode,
  leaveHousehold,
  queryClient,
  signInWithUsername,
  signUpWithEmail,
} from "./db";
import type { Household, MyHousehold, Profile } from "./obj_types";

// Remembered across restarts so the app opens on the same household.
const ACTIVE_KEY = "housearena.active_household";

type AuthContextValue = {
  client: SupabaseClient | null;
  backendReady: boolean;
  sessionUserId: string | null;
  profile: Profile | null;
  households: MyHousehold[];
  activeHousehold: MyHousehold | null;
  initLoading: boolean;
  authLoading: boolean;
  // True while profile plus households load, so screens wait for data.
  dataLoading: boolean;
  // True after the user skips household setup for this login.
  setupSkipped: boolean;
  skipHouseholdSetup: () => void;
  // Last data load failure, so empty lists are not mistaken for no data.
  dataError: string | null;
  configureBackend: (url: string, anonKey: string) => Promise<void>;
  signIn: (username: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    username: string,
    password: string,
  ) => Promise<{ userId: string }>;
  createHousehold: (name: string) => Promise<Household>;
  joinHousehold: (code: string) => Promise<Household>;
  leaveActiveHousehold: () => Promise<void>;
  setActiveHousehold: (id: number) => Promise<void>;
  signOut: () => Promise<void>;
  refreshSessionData: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [households, setHouseholds] = useState<MyHousehold[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [initLoading, setInitLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [setupSkipped, setSetupSkipped] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  // Loads profile plus household list after login, signup, or app start.
  // Fetch failures are recorded instead of looking like empty data.
  const loadSessionData = useCallback(
    async (c: SupabaseClient, userId: string) => {
      setDataLoading(true);
      setDataError(null);
      try {
        let p: Profile | null = null;
        let homes: MyHousehold[] = [];
        try {
          p = await fetchMyProfile(c, userId);
        } catch (e) {
          setDataError(e instanceof Error ? e.message : String(e));
        }
        try {
          homes = await fetchMyHouseholds(c, userId);
        } catch (e) {
          setDataError(e instanceof Error ? e.message : String(e));
        }
        setProfile(p);
        setHouseholds(homes);
      // Keep the remembered household when still a member of it,
      // otherwise fall back to the first one.
      const saved = await AsyncStorage.getItem(ACTIVE_KEY).catch(() => null);
      const savedId = saved ? Number(saved) : NaN;
      const stillMember = homes.some((h) => h.household.id === savedId);
      const next = stillMember
        ? savedId
        : homes.length > 0
          ? homes[0].household.id
          : null;
      setActiveId(next);
      if (next != null)
        await AsyncStorage.setItem(ACTIVE_KEY, String(next)).catch(() => {});
      else await AsyncStorage.removeItem(ACTIVE_KEY).catch(() => {});
      } finally {
        setDataLoading(false);
      }
    },
    [],
  );

  // Restore saved backend plus session on boot.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const c = await restoreBackend();
        if (!alive) return;
        setClient(c);
        if (c) {
          const { data } = await c.auth.getSession();
          const uid = data.session?.user?.id ?? null;
          setSessionUserId(uid);
          if (uid) await loadSessionData(c, uid);
        }
      } finally {
        if (alive) setInitLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadSessionData]);

  // Keep session and data in sync. Token refreshes need no reload.
  useEffect(() => {
    if (!client) return;
    const { data: sub } = client.auth.onAuthStateChange(
      async (event, session) => {
        if (event === "TOKEN_REFRESHED") return;
        const uid = session?.user?.id ?? null;
        setSessionUserId(uid);
        if (uid) await loadSessionData(client, uid);
        else {
          setProfile(null);
          setHouseholds([]);
          setActiveId(null);
          setDataError(null);
          queryClient.clear();
        }
      },
    );
    return () => sub.subscription.unsubscribe();
  }, [client, loadSessionData]);

  const configureBackend = useCallback(async (url: string, anonKey: string) => {
    const c = await connectBackend(url, anonKey);
    setClient(c);
  }, []);

  const ensureClient = useCallback(() => {
    if (!client)
      throw new Error("Connect your Supabase backend first (URL + anon key).");
    return client;
  }, [client]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const c = ensureClient();
      setAuthLoading(true);
      try {
        await signInWithUsername(c, username, password);
        const { data } = await c.auth.getUser();
        const uid = data.user?.id ?? null;
        if (!uid) throw new Error("Login worked but no user was returned.");
        setSessionUserId(uid);
        await loadSessionData(c, uid);
      } finally {
        setAuthLoading(false);
      }
    },
    [ensureClient, loadSessionData],
  );

  const signUp = useCallback(
    async (email: string, username: string, password: string) => {
      const c = ensureClient();
      setAuthLoading(true);
      try {
        await signUpWithEmail(c, email, username, password);
        const { data } = await c.auth.getUser();
        const user = data.user;
        if (!user) {
          // No session yet means the email is not confirmed.
          throw new Error(
            "Account created. Open the confirmation mail on this phone " +
              "and tap the link, then log in with your username + password.",
          );
        }
        setSessionUserId(user.id);
        await loadSessionData(c, user.id);
        return { userId: user.id };
      } finally {
        setAuthLoading(false);
      }
    },
    [ensureClient, loadSessionData],
  );

  const createHouseholdCb = useCallback(
    async (name: string) => {
      const c = ensureClient();
      if (!sessionUserId) throw new Error("You must be logged in.");
      const home = await createHousehold(c, name);
      await loadSessionData(c, sessionUserId);
      setActiveId(home.id);
      await AsyncStorage.setItem(ACTIVE_KEY, String(home.id)).catch(() => {});
      return home;
    },
    [ensureClient, sessionUserId, loadSessionData],
  );

  const joinHousehold = useCallback(
    async (code: string) => {
      const c = ensureClient();
      if (!sessionUserId) throw new Error("You must be logged in.");
      const home = await joinHouseholdByCode(c, code);
      await loadSessionData(c, sessionUserId);
      setActiveId(home.id);
      await AsyncStorage.setItem(ACTIVE_KEY, String(home.id)).catch(() => {});
      return home;
    },
    [ensureClient, sessionUserId, loadSessionData],
  );

  const leaveActiveHousehold = useCallback(async () => {
    const c = ensureClient();
    if (!sessionUserId || activeId == null)
      throw new Error("No active household.");
    await leaveHousehold(c, activeId);
    await loadSessionData(c, sessionUserId);
  }, [ensureClient, sessionUserId, activeId, loadSessionData]);

  // Stored id is a hint only, it must belong to the current list.
  const setActiveHousehold = useCallback(
    async (id: number) => {
      if (
        households.length > 0 &&
        !households.some((h) => h.household.id === id)
      )
        throw new Error("You are not a member of that household.");
      setActiveId(id);
      await AsyncStorage.setItem(ACTIVE_KEY, String(id)).catch(() => {});
    },
    [households],
  );

  const signOut = useCallback(async () => {
    // Local scope first so an offline failure cannot leave tokens behind
    // while the UI claims a logout. Adapter purge plus legacy web keys.
    try {
      if (client) await client.auth.signOut({ scope: "local" });
    } catch {
      // State below is cleared regardless.
    }
    try {
      const keys = await AsyncStorage.getAllKeys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("sb-"))
          .map((k) => AsyncStorage.removeItem(k)),
      );
    } catch {
      // Same, state below is cleared regardless.
    }
    setSessionUserId(null);
    setProfile(null);
    setHouseholds([]);
    setActiveId(null);
    setSetupSkipped(false);
    setDataError(null);
    await AsyncStorage.removeItem(ACTIVE_KEY).catch(() => {});
    queryClient.clear();
  }, [client]);

  const refreshSessionData = useCallback(async () => {
    if (client && sessionUserId) await loadSessionData(client, sessionUserId);
  }, [client, sessionUserId, loadSessionData]);

  // Lets the user enter the app without a household for this login.
  const skipHouseholdSetup = useCallback(() => {
    setSetupSkipped(true);
  }, []);

  const activeHousehold = useMemo(
    () => households.find((h) => h.household.id === activeId) ?? null,
    [households, activeId],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      client,
      backendReady: !!client,
      sessionUserId,
      profile,
      households,
      activeHousehold,
      initLoading,
      authLoading,
      dataLoading,
      setupSkipped,
      skipHouseholdSetup,
      dataError,
      configureBackend,
      signIn,
      signUp,
      createHousehold: createHouseholdCb,
      joinHousehold,
      leaveActiveHousehold,
      setActiveHousehold,
      signOut,
      refreshSessionData,
    }),
    [
      client,
      sessionUserId,
      profile,
      households,
      activeHousehold,
      initLoading,
      authLoading,
      dataLoading,
      setupSkipped,
      skipHouseholdSetup,
      dataError,
      configureBackend,
      signIn,
      signUp,
      createHouseholdCb,
      joinHousehold,
      leaveActiveHousehold,
      setActiveHousehold,
      signOut,
      refreshSessionData,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
