import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "../../src/system/AuthProvider";
import * as supabaseModule from "../../src/system/supabase";
import { qk, queryClient } from "../../src/system/db";
import { FakeClient } from "../fake/fake_supabase";
import { ANA, BOB, createSeed } from "../fake/seed";

let fake: FakeClient;
const asClient = () => fake as unknown as SupabaseClient;
const wrapper = ({ children }: any) => <AuthProvider>{children}</AuthProvider>;

// Every renderHook mounts an AuthProvider with Fake realtime channels and
// TanStack cache entries. Track them so afterEach can unmount + clear,
// leaving no observers, channels, or gc/stale timers for the next test.
const mounted: Array<{ unmount: () => void }> = [];

function track<T extends { unmount: () => void }>(hook: T): T {
  mounted.push(hook);
  return hook;
}

async function flushNotifies() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  queryClient.clear();
  fake = new FakeClient(createSeed());
  jest
    .spyOn(supabaseModule, "restoreBackend")
    .mockImplementation(async () => null);
  jest
    .spyOn(supabaseModule, "connectBackend")
    .mockImplementation(async () => asClient());
  // The module singleton mirrors what initSupabaseClient would hold in
  // production, so the stale-closure fallback resolves to the fake.
  jest.spyOn(supabaseModule, "getSupabase").mockImplementation(() => asClient());
});

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    try {
      m.unmount();
    } catch {}
  }
  // Flush any trailing notifyManager (setTimeout 0) updates inside act()
  // so they never fire after the test.
  await act(async () => {
    await flushNotifies();
  });
  await queryClient.cancelQueries();
  queryClient.clear();
  jest.restoreAllMocks();
});

describe("boot", () => {
  it("settles with no backend and no session", async () => {
    const { result } = track(renderHook(() => useAuth(), { wrapper }));
    await waitFor(() => expect(result.current.initLoading).toBe(false));
    expect(result.current.sessionUserId).toBeNull();
    expect(result.current.backendReady).toBe(false);
  });

  it("restores an existing session from storage on boot", async () => {
    (supabaseModule.restoreBackend as jest.Mock).mockImplementation(async () => asClient());
    fake.signInAs(ANA.id);
    const { result } = track(renderHook(() => useAuth(), { wrapper }));
    await waitFor(() => expect(result.current.sessionUserId).toBe(ANA.id));
    await waitFor(() => expect(result.current.profile?.username).toBe("ana"));
    expect(result.current.households).toHaveLength(2);
  });

  it("connecting a backend flips readiness", async () => {
    const { result } = track(renderHook(() => useAuth(), { wrapper }));
    await waitFor(() => expect(result.current.initLoading).toBe(false));
    await act(async () => {
      await result.current.configureBackend("https://x.supabase.co", "k".repeat(40));
    });
    expect(result.current.backendReady).toBe(true);
  });
});

describe("signIn", () => {
  it("loads profile, households, and active id on 0 rpc + 2 selects", async () => {
    const { result } = track(renderHook(() => useAuth(), { wrapper }));
    await waitFor(() => expect(result.current.initLoading).toBe(false));
    await act(async () => {
      await result.current.configureBackend("https://x.supabase.co", "k".repeat(40));
    });
    fake.resetCalls();
    await act(async () => {
      await result.current.signIn(ANA.email, "secret12");
    });
    await waitFor(() => expect(result.current.profile?.username).toBe("ana"));
    expect(result.current.sessionUserId).toBe(ANA.id);
    expect(result.current.households).toHaveLength(2);
    expect(result.current.activeHousehold?.household.id).toBe(1);
    // Direct email sign-in, no lookup rpc: exactly one profile + one
    // households fetch, even though the SIGNED_IN event fires
    // concurrently (dedup guard).
    expect(fake.calls.rpc).toBe(0);
    expect(fake.calls.select).toBe(2);
  });

  it("rejects bad credentials without touching session state", async () => {
    const { result } = track(renderHook(() => useAuth(), { wrapper }));
    await waitFor(() => expect(result.current.initLoading).toBe(false));
    await act(async () => {
      await result.current.configureBackend("https://x.supabase.co", "k".repeat(40));
    });
    await act(async () => {
      await expect(result.current.signIn(ANA.email, "wrongpass")).rejects.toThrow(
        "No account matches",
      );
    });
    expect(result.current.sessionUserId).toBeNull();
    expect(result.current.profile).toBeNull();
  });
});

describe("live profile", () => {
  it("merges own UPDATEs with zero selects and ignores foreign rows", async () => {
    const { result } = track(renderHook(() => useAuth(), { wrapper }));
    await waitFor(() => expect(result.current.initLoading).toBe(false));
    await act(async () => {
      await result.current.configureBackend("https://x.supabase.co", "k".repeat(40));
      await result.current.signIn(ANA.email, "secret12");
    });
    await waitFor(() => expect(result.current.profile?.username).toBe("ana"));
    expect(fake.bindingsFor(`profile-${ANA.id}`)).toHaveLength(1);
    expect(fake.bindingsFor(`profile-${ANA.id}`)[0].filter).toBe(`id=eq.${ANA.id}`);

    fake.resetCalls();
    await act(async () => {
      fake.emit("profiles", "UPDATE", { id: ANA.id, points: 999, gems: 9 });
      await flushNotifies();
    });
    await waitFor(() => expect(result.current.profile?.points).toBe(999));
    expect(result.current.profile?.gems).toBe(9);
    expect(result.current.profile?.username).toBe("ana");
    expect(fake.calls.select).toBe(0);

    await act(async () => {
      fake.emit("profiles", "UPDATE", { id: BOB.id, points: 1 });
      await flushNotifies();
    });
    expect(result.current.profile?.points).toBe(999);
  });
});

describe("household mutations", () => {
  async function signedIn() {
    const hook = track(renderHook(() => useAuth(), { wrapper }));
    await waitFor(() => expect(hook.result.current.initLoading).toBe(false));
    await act(async () => {
      await hook.result.current.configureBackend("https://x.supabase.co", "k".repeat(40));
      await hook.result.current.signIn(ANA.email, "secret12");
    });
    await waitFor(() => expect(hook.result.current.profile?.username).toBe("ana"));
    return hook;
  }

  it("creates with caller as owner and activates it", async () => {
    const { result } = await signedIn();
    let home: any;
    await act(async () => {
      home = await result.current.createHousehold("Cabin Crew");
    });
    expect(result.current.households).toHaveLength(3);
    expect(result.current.activeHousehold?.household.id).toBe(home.id);
  });

  it("joins by code and leaves with fallback to the first home", async () => {
    const { result } = await signedIn();
    await act(async () => {
      await result.current.setActiveHousehold(2);
    });
    expect(result.current.activeHousehold?.household.id).toBe(2);
    await act(async () => {
      await result.current.leaveActiveHousehold();
    });
    expect(result.current.households.map((h) => h.household.id)).toEqual([1]);
    expect(result.current.activeHousehold?.household.id).toBe(1);
  });

  it("signOut clears everything and unsubscribes", async () => {
    const { result, unmount } = await signedIn();
    expect(fake.calls.subscribe).toBeGreaterThan(0);
    await act(async () => {
      await result.current.signOut();
    });
    expect(result.current.sessionUserId).toBeNull();
    expect(result.current.profile).toBeNull();
    expect(result.current.households).toEqual([]);
    expect(queryClient.getQueryData(qk.myProfile(ANA.id))).toBeUndefined();
    expect(fake.calls.removeChannel).toBeGreaterThan(0);
    unmount();
  });
});
