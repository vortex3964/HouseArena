import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  qk,
  queryClient,
  useHouseholdLogs,
  useHouseholdMembers,
  useHouseholdTasks,
} from "../../src/system/db";
import { useLiveHousehold, useLiveLogs } from "../../src/system/live";
import { FakeClient } from "../fake/fake_supabase";
import { ANA, BOB, createSeed } from "../fake/seed";

let fake: FakeClient;
let client: SupabaseClient;

// TanStack's notifyManager batches observer notifications through
// setTimeout(0), so a bare fake.emit() schedules a React update that fires
// after act() exits -> act() warning. Flushing macrotasks inside act()
// lets every scheduled notify settle while still inside act().
async function flushNotifies() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function emitInAct(
  table: string,
  event: "INSERT" | "UPDATE" | "DELETE",
  row: any,
) {
  await act(async () => {
    fake.emit(table, event, row);
    await flushNotifies();
  });
}

async function setCacheInAct(fn: () => void) {
  await act(async () => {
    fn();
    await flushNotifies();
  });
}

const wrapper = ({ children }: any) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

function taskRow(id: number, extra: Record<string, any> = {}) {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    difficulty: "easy",
    points: 120,
    status: "free",
    household_id: 1,
    owner: null,
    created_by: ANA.id,
    created_at: `2026-06-01T00:00:${String(id).padStart(2, "0")}Z`,
    ...extra,
  };
}

beforeEach(() => {
  queryClient.clear();
  fake = new FakeClient(createSeed());
  client = fake as unknown as SupabaseClient;
});

afterEach(async () => {
  await queryClient.cancelQueries();
  queryClient.clear();
});

describe("subscription setup", () => {
  it("opens one channel with four filtered bindings, none without a household", () => {
    const { unmount } = renderHook(() =>
      useLiveHousehold(client, ANA.id, 1, [ANA.id, BOB.id]),
    );
    expect(fake.calls.subscribe).toBe(1);
    const bindings = fake.bindingsFor("household-1");
    expect(bindings).toHaveLength(4);
    expect(bindings.map((b) => b.table).sort()).toEqual([
      "household_members",
      "households",
      "profiles",
      "tasks",
    ]);
    for (const b of bindings) {
      if (b.table === "profiles") {
        expect(b.filter).toContain(ANA.id);
        expect(b.filter).toContain(BOB.id);
      } else {
        expect(b.filter).toContain("eq.1");
      }
    }
    unmount();
    expect(fake.calls.removeChannel).toBe(1);
  });

  it("skips the profiles binding until member ids are known", () => {
    const { unmount } = renderHook(() => useLiveHousehold(client, ANA.id, 1));
    const bindings = fake.bindingsFor("household-1");
    expect(bindings.map((b) => b.table).sort()).toEqual([
      "household_members",
      "households",
      "tasks",
    ]);
    unmount();
  });

  it("subscribes to nothing without client or household", () => {
    const a = renderHook(() => useLiveHousehold(null, ANA.id, 1));
    const b = renderHook(() => useLiveHousehold(client, ANA.id, null));
    expect(fake.calls.subscribe).toBe(0);
    a.unmount();
    b.unmount();
  });
});

describe("tasks channel", () => {
  function useBoard() {
    return renderHook(
      () => {
        const tasks = useHouseholdTasks(client, 1);
        useLiveHousehold(client, ANA.id, 1);
        return tasks;
      },
      { wrapper },
    );
  }

  it("serves the initial page, then merges inserts/edits/deletes with 0 selects", async () => {
    const { result, unmount } = useBoard();
    await waitFor(() => expect(result.current.data).toHaveLength(50));
    fake.resetCalls();

    await emitInAct("tasks", "INSERT", taskRow(100, { created_at: "2026-07-01T00:00:00Z" }));
    let cached = queryClient.getQueryData<any[]>(qk.tasks(1))!;
    expect(cached).toHaveLength(51);
    expect(cached[cached.length - 1].id).toBe(100);

    await emitInAct("tasks", "UPDATE", {
      ...taskRow(5),
      points: 130,
      status: "taken",
      owner: BOB.id,
    });
    cached = queryClient.getQueryData<any[]>(qk.tasks(1))!;
    expect(cached.find((t) => t.id === 5)).toMatchObject({
      points: 130,
      status: "taken",
      title: "Task 5",
    });

    await emitInAct("tasks", "DELETE", {
      // Full old row, as REPLICA IDENTITY FULL delivers in production.
      ...taskRow(5),
      points: 130,
      status: "taken",
      owner: BOB.id,
    });
    cached = queryClient.getQueryData<any[]>(qk.tasks(1))!;
    expect(cached.some((t) => t.id === 5)).toBe(false);
    expect(cached).toHaveLength(50);
    expect(fake.calls.select).toBe(0);
    unmount();
  });

  it("ignores other households", async () => {
    const { result, unmount } = useBoard();
    await waitFor(() => expect(result.current.data).toHaveLength(50));
    await emitInAct("tasks", "INSERT", { ...taskRow(101), household_id: 2 });
    expect(queryClient.getQueryData<any[]>(qk.tasks(1))).toHaveLength(50);
    unmount();
  });
});

describe("logs channel", () => {
  function useFeed(householdId: number | null) {
    return renderHook(
      ({ id }: { id: number | null }) => {
        const logs = useHouseholdLogs(client, id);
        useLiveLogs(client, id);
        return logs;
      },
      { wrapper, initialProps: { id: householdId } },
    );
  }

  it("opens its own filtered channel, none without a household", () => {
    const { unmount } = useFeed(1);
    expect(fake.calls.subscribe).toBe(1);
    const bindings = fake.bindingsFor("logs-1");
    expect(bindings).toHaveLength(1);
    expect(bindings[0].table).toBe("activity_logs");
    expect(bindings[0].filter).toBe("household_id=eq.1");
    unmount();
    expect(fake.calls.removeChannel).toBe(1);

    const second = useFeed(null);
    expect(fake.calls.subscribe).toBe(1);
    second.unmount();
  });

  it("stops everything when the tab is left (id flips to null)", async () => {
    const hook = useFeed(1);
    await waitFor(() => expect(hook.result.current.data).toHaveLength(30));
    hook.rerender({ id: null });
    const removes = fake.calls.removeChannel;
    expect(removes).toBeGreaterThan(0);
    fake.resetCalls();
    await emitInAct("activity_logs", "INSERT", {
      id: 100,
      household_id: 1,
      owner: "ana",
      details: "After blur",
      created_at: "2026-09-01T00:00:00Z",
    });
    // Channel gone: nothing merged, nothing refetched.
    expect(queryClient.getQueryData<any[]>(qk.logs(1))).toHaveLength(30);
    expect(fake.calls.select).toBe(0);
    hook.unmount();
  });

  it("prepends newest and trims to the 30 cap", async () => {
    const { result, unmount } = renderHook(
      () => {
        const logs = useHouseholdLogs(client, 1);
        useLiveLogs(client, 1);
        return logs;
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(30));
    fake.resetCalls();
    await emitInAct("activity_logs", "INSERT", {
      id: 100,
      household_id: 1,
      owner: "ana",
      details: "Fresh",
      created_at: "2026-09-01T00:00:00Z",
    });
    const cached = queryClient.getQueryData<any[]>(qk.logs(1))!;
    expect(cached).toHaveLength(30);
    expect(cached[0].id).toBe(100);
    expect(fake.calls.select).toBe(0);
    unmount();
  });
});

describe("members channel", () => {
  function useMembers() {
    return renderHook(
      () => {
        const members = useHouseholdMembers(client, 1);
        useLiveHousehold(client, ANA.id, 1);
        return members;
      },
      { wrapper },
    );
  }

  it("patches role edits and removes leavers with 0 selects", async () => {
    const { result, unmount } = useMembers();
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    fake.resetCalls();

    await emitInAct("household_members", "UPDATE", {
      household_id: 1,
      profile_id: BOB.id,
      role: "admin",
      joined_at: "2026-01-01T00:00:12Z",
    });
    let cached = queryClient.getQueryData<any[]>(qk.members(1))!;
    expect(cached.find((m) => m.profile_id === BOB.id)?.role).toBe("admin");

    await emitInAct("household_members", "DELETE", {
      household_id: 1,
      profile_id: BOB.id,
    });
    cached = queryClient.getQueryData<any[]>(qk.members(1))!;
    expect(cached.map((m) => m.profile_id)).toEqual([ANA.id]);
    expect(fake.calls.select).toBe(0);
    unmount();
  });

  it("refetches once on a fresh join to get the profile row", async () => {
    const { result, unmount } = useMembers();
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    // The row must exist in the DB for the refetch to return it.
    fake.tables.household_members.push({
      household_id: 1,
      profile_id: "user-charlie",
      role: "member",
      joined_at: "2026-08-01T00:00:00Z",
    });
    fake.resetCalls();
    await emitInAct("household_members", "INSERT", {
      household_id: 1,
      profile_id: "user-charlie",
      role: "member",
      joined_at: "2026-08-01T00:00:00Z",
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<any[]>(qk.members(1))?.some((m) => m.profile_id === "user-charlie"),
      ).toBe(true),
    );
    // Let the invalidated refetch's observer notification settle inside act().
    await act(async () => {
      await flushNotifies();
    });
    expect(fake.calls.select).toBe(1);
    const joined = queryClient
      .getQueryData<any[]>(qk.members(1))!
      .find((m) => m.profile_id === "user-charlie")!;
    expect(joined.profile?.username).toBe("charlie");
    unmount();
  });
});

describe("profiles channel", () => {
  function useMembersLive() {
    return renderHook(
      () => {
        const members = useHouseholdMembers(client, 1);
        useLiveHousehold(client, ANA.id, 1, [ANA.id, BOB.id]);
        return members;
      },
      { wrapper },
    );
  }

  it("patches points, names and photos into the members cache, 0 selects", async () => {
    const { result, unmount } = useMembersLive();
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    const before = queryClient.getQueryData<any[]>(qk.members(1))!;
    const beforeBob = before.find((m) => m.profile_id === BOB.id)?.profile.points;
    fake.resetCalls();

    await emitInAct("profiles", "UPDATE", {
      id: BOB.id,
      username: "bobby",
      avatar_url: `${BOB.id}/new.jpg`,
      points: 400,
    });
    const cached = queryClient.getQueryData<any[]>(qk.members(1))!;
    expect(beforeBob).not.toBe(400);
    expect(cached.find((m) => m.profile_id === BOB.id)?.profile).toMatchObject({
      username: "bobby",
      avatar_url: `${BOB.id}/new.jpg`,
      points: 400,
    });
    // Untouched member keeps its row.
    expect(cached.find((m) => m.profile_id === ANA.id)?.profile.points).toBe(
      before.find((m) => m.profile_id === ANA.id)?.profile.points,
    );
    expect(fake.calls.select).toBe(0);
    unmount();
  });

  it("ignores profile updates for non-members", async () => {
    const { result, unmount } = useMembersLive();
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    fake.resetCalls();
    await emitInAct("profiles", "UPDATE", {
      id: "user-stranger",
      username: "stranger",
      points: 9999,
    });
    const cached = queryClient.getQueryData<any[]>(qk.members(1))!;
    expect(cached).toHaveLength(2);
    expect(cached.some((m) => m.profile_id === "user-stranger")).toBe(false);
    unmount();
  });
});

describe("household meta channel", () => {
  it("patches renames and removes deleted homes from our list", async () => {
    const { unmount } = renderHook(() => useLiveHousehold(client, ANA.id, 1));
    await setCacheInAct(() =>
      queryClient.setQueryData(qk.myHouseholds(ANA.id), [
        {
          role: "owner",
          joined_at: "2026-01-01T00:00:11Z",
          household: {
            id: 1,
            name: "Sunset Flat",
            invite_code: "SUNSET000001",
            created_by: ANA.id,
            created_at: "2026-01-01T00:00:10Z",
            check_at: null,
          },
        },
      ]),
    );
    await emitInAct("households", "UPDATE", { id: 1, name: "Sunset Loft" });
    expect(queryClient.getQueryData<any[]>(qk.myHouseholds(ANA.id))![0].household.name).toBe(
      "Sunset Loft",
    );
    await emitInAct("households", "DELETE", { id: 1 });
    expect(queryClient.getQueryData<any[]>(qk.myHouseholds(ANA.id))).toEqual([]);
    unmount();
  });
});
