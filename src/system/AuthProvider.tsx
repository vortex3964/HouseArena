import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearAuthStorage,
  connectBackend,
  dropClient,
  getSupabase,
  restoreBackend,
  withTimeout,
} from "./supabase";
import { registerPushToken } from "./push";
import { toMessage } from "./errors";
import { Messages, Timeouts } from "../global/constants";
import { resolveActiveId, saveActiveId } from "./active_household";
import {
  createHousehold,
  fetchMyHouseholds,
  fetchMyProfile,
  joinHouseholdByCode,
  leaveHousehold,
  qk,
  queryClient,
  signInWithUsername,
  signUpWithEmail,
} from "./db";
import type { Household, MyHousehold, Profile } from "./obj_types";

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
  // Last boot failure, rendered with a retry button instead of a spinner.
  bootError: string | null;
  retryBoot: () => void;
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
  const [bootError, setBootError] = useState<string | null>(null);
  const [bootNonce, setBootNonce] = useState(0);

  // Loads profile plus household list after login, signup, or app start.
  // Fetch failures are recorded instead of looking like empty data.
  // Results are seeded into the TanStack cache so hooks read warm data.
  // Concurrent duplicate loads collapse into one, and a load that gets
  // superseded by logout, switch, or retry drops its results instead of
  // overwriting fresh state.
  const inflightUid = useRef<string | null>(null);
  const loadSeq = useRef(0);
  const loadSessionData = useCallback(
    async (c: SupabaseClient, userId: string) => {
      if (inflightUid.current === userId) return;
      inflightUid.current = userId;
      const seq = ++loadSeq.current;
      setDataLoading(true);
      setDataError(null);
      try {
        const [pRes, hRes] = await Promise.allSettled([
          withTimeout(fetchMyProfile(c, userId), Timeouts.PROFILE_LOAD, "Profile load"),
          withTimeout(fetchMyHouseholds(c, userId), Timeouts.HOUSEHOLDS_LOAD, "Households load"),
        ]);
        if (seq !== loadSeq.current) return;
        const p = pRes.status === "fulfilled" ? pRes.value : null;
        const homes = hRes.status === "fulfilled" ? hRes.value : [];
        if (pRes.status === "rejected") setDataError(toMessage(pRes.reason));
        if (hRes.status === "rejected")
          setDataError((prev) =>
            prev ? `${prev} | ${toMessage(hRes.reason)}` : toMessage(hRes.reason),
          );
        setProfile(p);
        setHouseholds(homes);
        queryClient.setQueryData(qk.myProfile(userId), p);
        queryClient.setQueryData(qk.myHouseholds(userId), homes);
        // Device token for push, best effort, never blocks the session.
        registerPushToken(c, userId).catch(() => {});
        setActiveId(await resolveActiveId(homes));
      } finally {
        if (inflightUid.current === userId) inflightUid.current = null;
        if (seq === loadSeq.current) setDataLoading(false);
      }
    },
    [],
  );

  // Restore saved backend plus session on boot. Any stall becomes
  // a retryable error, never an infinite spinner.
  useEffect(() => {
    let alive = true;
    (async () => {
      setInitLoading(true);
      setBootError(null);
      try {
        const c = await withTimeout(
          restoreBackend(),
          Timeouts.BOOT_RESTORE,
          "Backend restore",
        );
        if (!alive) return;
        setClient(c);
        if (c) {
          const { data } = await withTimeout(
            c.auth.getSession(),
            Timeouts.SESSION_RESTORE,
            "Session restore",
          );
          const uid = data.session?.user?.id ?? null;
          setSessionUserId(uid);
          if (uid) await loadSessionData(c, uid);
        }
      } catch (e) {
        if (alive) setBootError(toMessage(e));
      } finally {
        if (alive) setInitLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadSessionData, bootNonce]);

  const retryBoot = useCallback(() => {
    setBootNonce((n) => n + 1);
  }, []);

  // Keep session and data in sync. Boot owns the initial load,
  // refreshes need none, and password changes touch neither profile
  // nor households, so all three events are skipped here.
  useEffect(() => {
    if (!client) return;
    const { data: sub } = client.auth.onAuthStateChange(
      async (event, session) => {
        if (
          event === "TOKEN_REFRESHED" ||
          event === "INITIAL_SESSION" ||
          event === "USER_UPDATED"
        )
          return;
        const uid = session?.user?.id ?? null;
        setSessionUserId(uid);
        if (uid) await loadSessionData(client, uid);
        else {
          loadSeq.current++;
          setProfile(null);
          setHouseholds([]);
          setActiveId(null);
          setSetupSkipped(false);
          setDataError(null);
          setDataLoading(false);
          queryClient.clear();
        }
      },
    );
    return () => sub.subscription.unsubscribe();
  }, [client, loadSessionData]);

  // Live points and gems. One channel filtered to our own profile row,
  // payload merged straight into state, so point changes arrive with
  // zero extra SELECTs. Unsubscribed on logout or account switch.
  useEffect(() => {
    if (!client || !sessionUserId) return;
    const channel = client
      .channel(`profile-${sessionUserId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${sessionUserId}`,
        },
        (payload) => {
          const next = payload.new as Profile;
          setProfile((prev) => (prev ? { ...prev, ...next } : next));
          queryClient.setQueryData<Profile | null>(
            qk.myProfile(sessionUserId),
            (old) => (old ? { ...old, ...next } : next),
          );
        },
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [client, sessionUserId]);

  const configureBackend = useCallback(async (url: string, anonKey: string) => {
    const c = await connectBackend(url, anonKey);
    setClient(c);
  }, []);

  const ensureClient = useCallback(() => {
    // Module fallback covers a stale render closure (e.g. configure then
    // sign in back-to-back before React commits): the module always holds
    // the latest created client, and sign-out clears it via dropClient.
    const c = client ?? getSupabase();
    if (!c) throw new Error(Messages.BACKEND_AUTH_FIRST);
    return c;
  }, [client]);

  // Explicit load after auth: the listener's concurrent SIGNED_IN load
  // collapses into this one via the dedup guard, so exactly one runs.
  // dataLoading is set synchronously with the user id so the gate
  // shows a spinner instead of bouncing through household setup.
  const signIn = useCallback(
    async (username: string, password: string) => {
      const c = ensureClient();
      setAuthLoading(true);
      try {
        const uid = await signInWithUsername(c, username, password);
        setSessionUserId(uid);
        setDataLoading(true);
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
        const { session } = await signUpWithEmail(c, email, username, password);
        const user = session?.user ?? null;
        if (!user) {
          // No session yet means the email is not confirmed.
          throw new Error(
            "Account created. Open the confirmation mail on this phone " +
              "and tap the link, then log in with your username + password.",
          );
        }
        setSessionUserId(user.id);
        setDataLoading(true);
        await loadSessionData(c, user.id);
        return { userId: user.id };
      } finally {
        setAuthLoading(false);
      }
    },
    [ensureClient, loadSessionData],
  );

  // Household changes never touch points or gems, so only the
  // household list is reloaded here instead of the full session data.
  const refreshHouseholds = useCallback(
    async (c: SupabaseClient, userId: string) => {
      const homes = await fetchMyHouseholds(c, userId);
      setHouseholds(homes);
      queryClient.setQueryData(qk.myHouseholds(userId), homes);
      return homes;
    },
    [],
  );

  const createHouseholdCb = useCallback(
    async (name: string) => {
      const c = ensureClient();
      if (!sessionUserId) throw new Error(Messages.LOGIN_REQUIRED);
      const home = await createHousehold(c, name);
      await refreshHouseholds(c, sessionUserId);
      setActiveId(home.id);
      await saveActiveId(home.id);
      return home;
    },
    [ensureClient, sessionUserId, refreshHouseholds],
  );

  const joinHousehold = useCallback(
    async (code: string) => {
      const c = ensureClient();
      if (!sessionUserId) throw new Error(Messages.LOGIN_REQUIRED);
      const home = await joinHouseholdByCode(c, code);
      await refreshHouseholds(c, sessionUserId);
      setActiveId(home.id);
      await saveActiveId(home.id);
      return home;
    },
    [ensureClient, sessionUserId, refreshHouseholds],
  );

  const leaveActiveHousehold = useCallback(async () => {
    const c = ensureClient();
    if (!sessionUserId || activeId == null)
      throw new Error(Messages.NO_ACTIVE_HOUSEHOLD);
    await leaveHousehold(c, activeId);
    const homes = await refreshHouseholds(c, sessionUserId);
    const next = homes.length > 0 ? homes[0].household.id : null;
    setActiveId(next);
    await saveActiveId(next);
  }, [ensureClient, sessionUserId, activeId, refreshHouseholds]);

  // Stored id is a hint only, it must belong to the current list.
  const setActiveHousehold = useCallback(
    async (id: number) => {
      if (
        households.length > 0 &&
        !households.some((h) => h.household.id === id)
      )
        throw new Error("You are not a member of that household.");
      setActiveId(id);
      await saveActiveId(id);
    },
    [households],
  );

  const signOut = useCallback(async () => {
    loadSeq.current++;
    setDataLoading(false);
    // Local scope first so an offline failure cannot leave tokens behind
    // while the UI claims a logout. Adapter purge plus chunk wipe plus
    // legacy web keys. State below is cleared regardless.
    try {
      if (client)
        await withTimeout(
          client.auth.signOut({ scope: "local" }),
          Timeouts.SIGN_OUT,
          "Sign out",
        );
    } catch {
      // State below is cleared regardless.
    } finally {
      await clearAuthStorage().catch(() => {});
    }
    // Web only: native sessions live in SecureStore chunks (wiped above),
    // so sb- keys exist solely in the web AsyncStorage adapter.
    if (Platform.OS === "web") {
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
    }
    setSessionUserId(null);
    setProfile(null);
    setHouseholds([]);
    setActiveId(null);
    setSetupSkipped(false);
    setDataError(null);
    dropClient();
    await saveActiveId(null);
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
      bootError,
      retryBoot,
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
      bootError,
      retryBoot,
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
