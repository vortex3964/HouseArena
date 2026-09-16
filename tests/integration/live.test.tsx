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

describe("subscription setup", () => {
  it("opens one channel with three filtered bindings, none without a household", () => {
    const { unmount } = renderHook(() => useLiveHousehold(client, ANA.id, 1));
    expect(fake.calls.subscribe).toBe(1);
    const bindings = fake.bindingsFor("household-1");
    expect(bindings).toHaveLength(3);
    expect(bindings.map((b) => b.table).sort()).toEqual([
      "household_members",
      "households",
      "tasks",
    ]);
    for (const b of bindings) {
      expect(b.filter).toContain("eq.1");
    }
    unmount();
    expect(fake.calls.removeChannel).toBe(1);
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
    const { result } = useBoard();
    await waitFor(() => expect(result.current.data).toHaveLength(50));
    fake.resetCalls();

    await act(async () => {
      fake.emit("tasks", "INSERT", taskRow(100, { created_at: "2026-07-01T00:00:00Z" }));
    });
    let cached = queryClient.getQueryData<any[]>(qk.tasks(1))!;
    expect(cached).toHaveLength(51);
    expect(cached[cached.length - 1].id).toBe(100);

    await act(async () => {
      fake.emit("tasks", "UPDATE", { ...taskRow(5), points: 130, status: "taken", owner: BOB.id });
    });
    cached = queryClient.getQueryData<any[]>(qk.tasks(1))!;
    expect(cached.find((t) => t.id === 5)).toMatchObject({
      points: 130,
      status: "taken",
      title: "Task 5",
    });

    await act(async () => {
      // Full old row, as REPLICA IDENTITY FULL delivers in production.
      fake.emit("tasks", "DELETE", { ...taskRow(5), points: 130, status: "taken", owner: BOB.id });
    });
    cached = queryClient.getQueryData<any[]>(qk.tasks(1))!;
    expect(cached.some((t) => t.id === 5)).toBe(false);
    expect(cached).toHaveLength(50);
    expect(fake.calls.select).toBe(0);
  });

  it("ignores other households", async () => {
    const { result } = useBoard();
    await waitFor(() => expect(result.current.data).toHaveLength(50));
    await act(async () => {
      fake.emit("tasks", "INSERT", { ...taskRow(101), household_id: 2 });
    });
    expect(queryClient.getQueryData<any[]>(qk.tasks(1))).toHaveLength(50);
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
    await act(async () => {
      fake.emit("activity_logs", "INSERT", {
        id: 100,
        household_id: 1,
        owner: "ana",
        details: "After blur",
        created_at: "2026-09-01T00:00:00Z",
      });
    });
    // Channel gone: nothing merged, nothing refetched.
    expect(queryClient.getQueryData<any[]>(qk.logs(1))).toHaveLength(30);
    expect(fake.calls.select).toBe(0);
    hook.unmount();
  });

  it("prepends newest and trims to the 30 cap", async () => {
    const { result } = renderHook(
      () => {
        const logs = useHouseholdLogs(client, 1);
        useLiveLogs(client, 1);
        return logs;
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(30));
    fake.resetCalls();
    await act(async () => {
      fake.emit("activity_logs", "INSERT", {
        id: 100,
        household_id: 1,
        owner: "ana",
        details: "Fresh",
        created_at: "2026-09-01T00:00:00Z",
      });
    });
    const cached = queryClient.getQueryData<any[]>(qk.logs(1))!;
    expect(cached).toHaveLength(30);
    expect(cached[0].id).toBe(100);
    expect(fake.calls.select).toBe(0);
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
    const { result } = useMembers();
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    fake.resetCalls();

    await act(async () => {
      fake.emit("household_members", "UPDATE", {
        household_id: 1,
        profile_id: BOB.id,
        role: "admin",
        joined_at: "2026-01-01T00:00:12Z",
      });
    });
    let cached = queryClient.getQueryData<any[]>(qk.members(1))!;
    expect(cached.find((m) => m.profile_id === BOB.id)?.role).toBe("admin");

    await act(async () => {
      fake.emit("household_members", "DELETE", { household_id: 1, profile_id: BOB.id });
    });
    cached = queryClient.getQueryData<any[]>(qk.members(1))!;
    expect(cached.map((m) => m.profile_id)).toEqual([ANA.id]);
    expect(fake.calls.select).toBe(0);
  });

  it("refetches once on a fresh join to get the profile row", async () => {
    const { result } = useMembers();
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    // The row must exist in the DB for the refetch to return it.
    fake.tables.household_members.push({
      household_id: 1,
      profile_id: "user-charlie",
      role: "member",
      joined_at: "2026-08-01T00:00:00Z",
    });
    fake.resetCalls();
    await act(async () => {
      fake.emit("household_members", "INSERT", {
        household_id: 1,
        profile_id: "user-charlie",
        role: "member",
        joined_at: "2026-08-01T00:00:00Z",
      });
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData<any[]>(qk.members(1))?.some((m) => m.profile_id === "user-charlie"),
      ).toBe(true),
    );
    expect(fake.calls.select).toBe(1);
    const joined = queryClient
      .getQueryData<any[]>(qk.members(1))!
      .find((m) => m.profile_id === "user-charlie")!;
    expect(joined.profile?.username).toBe("charlie");
  });
});

describe("household meta channel", () => {
  it("patches renames and removes deleted homes from our list", async () => {
    renderHook(() => useLiveHousehold(client, ANA.id, 1));
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
    ]);
    await act(async () => {
      fake.emit("households", "UPDATE", { id: 1, name: "Sunset Loft" });
    });
    expect(queryClient.getQueryData<any[]>(qk.myHouseholds(ANA.id))![0].household.name).toBe(
      "Sunset Loft",
    );
    await act(async () => {
      fake.emit("households", "DELETE", { id: 1 });
    });
    expect(queryClient.getQueryData<any[]>(qk.myHouseholds(ANA.id))).toEqual([]);
  });
});
