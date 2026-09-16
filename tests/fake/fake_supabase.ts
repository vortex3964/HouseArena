// Temp local DB for tests: an in-memory Supabase double.
// Implements exactly the surface the app uses (from/rpc/auth/channel),
// with JS twins of the SQL functions that matter for CRUD logic.
// Permissive on purpose: it stores rows, it does not simulate RLS.

export type FakeCalls = {
  select: number;
  rpc: number;
  upsert: number;
  subscribe: number;
  removeChannel: number;
  auth: Record<string, number>;
};

export interface FakeDb {
  profiles: any[];
  households: any[];
  household_members: any[];
  tasks: any[];
  activity_logs: any[];
  push_devices: any[];
  authUsers: any[];
  nextIds: { household: number; task: number; log: number; user: number };
}

export function emptyDb(): FakeDb {
  return {
    profiles: [],
    households: [],
    household_members: [],
    tasks: [],
    activity_logs: [],
    push_devices: [],
    authUsers: [],
    nextIds: { household: 1, task: 1, log: 1, user: 1 },
  };
}

function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const FK: Record<string, string> = {
  households: "household_id",
  profiles: "profile_id",
};

class FakeQuery {
  private filters: Array<[string, any]> = [];
  private sortCol: string | null = null;
  private sortAsc = true;
  private limitN: number | null = null;
  private singleMode: "maybe" | null = null;
  private cols: string | null = null;
  private upsertRow: any = null;
  private upsertKeys: string[] = [];

  constructor(
    private fake: FakeClient,
    private table: keyof FakeDb,
  ) {}

  select(cols: string) {
    this.cols = cols;
    return this;
  }

  eq(col: string, val: any) {
    this.filters.push([col, val]);
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.sortCol = col;
    this.sortAsc = opts?.ascending ?? true;
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybe";
    return this;
  }

  upsert(row: any, opts?: { onConflict?: string }) {
    this.upsertRow = row;
    this.upsertKeys = (opts?.onConflict ?? "").split(",").map((s) => s.trim());
    return this;
  }

  private project(row: any): any {
    if (!this.cols) return { ...row };
    const out: any = {};
    for (const token of splitTopLevel(this.cols)) {
      const nested = token.match(/^(\w+):(\w+)\((.*)\)$/);
      if (nested) {
        const [, alias, table, inner] = nested;
        const fk = FK[table];
        const target = (this.fake.tables as any)[table].find(
          (r: any) => r.id === row[fk],
        );
        if (!target) {
          out[alias] = null;
          continue;
        }
        const picked: any = {};
        for (const c of splitTopLevel(inner)) picked[c] = target[c];
        out[alias] = picked;
        continue;
      }
      out[token] = row[token];
    }
    return out;
  }

  private runSelect() {
    this.fake.calls.select++;
    let rows = [...(this.fake.tables[this.table] as any[])];
    for (const [col, val] of this.filters)
      rows = rows.filter((r) => r[col] === val);
    if (this.sortCol) {
      const col = this.sortCol;
      const asc = this.sortAsc;
      rows.sort((a, b) => {
        if (a[col] === b[col]) return 0;
        return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1);
      });
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN);
    const projected = rows.map((r) => this.project(r));
    if (this.singleMode === "maybe")
      return { data: projected[0] ?? null, error: null };
    return { data: projected, error: null };
  }

  private runUpsert() {
    this.fake.calls.upsert++;
    const rows = this.fake.tables[this.table] as any[];
    const hit = rows.find((r) =>
      this.upsertKeys.every((k) => r[k] === this.upsertRow[k]),
    );
    if (hit) Object.assign(hit, this.upsertRow);
    else rows.push({ ...this.upsertRow });
    return { data: [this.upsertRow], error: null };
  }

  then(
    resolve: (v: any) => void,
    reject?: (e: any) => void,
  ): Promise<any> {
    try {
      resolve(this.upsertRow ? this.runUpsert() : this.runSelect());
    } catch (e) {
      if (reject) reject(e);
      else throw e;
    }
    return Promise.resolve();
  }
}

export interface FakeBinding {
  event: string;
  table: string;
  filter: string;
  cb: (payload: any) => void;
}

export interface FakeChannel {
  name: string;
  bindings: FakeBinding[];
  on: (event: string, filter: any, cb: (payload: any) => void) => FakeChannel;
  subscribe: () => FakeChannel;
}

function iso(base: number, step: number): string {
  return new Date(base + step * 1000).toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export class FakeClient {
  tables: FakeDb;
  calls: FakeCalls = {
    select: 0,
    rpc: 0,
    upsert: 0,
    subscribe: 0,
    removeChannel: 0,
    auth: {},
  };
  currentUserId: string | null = null;
  channels: FakeChannel[] = [];
  private listeners = new Set<(event: string, session: any) => void>();

  constructor(tables?: FakeDb) {
    this.tables = tables ?? emptyDb();
    const self = this;
    this.auth = {
      signUp: async (args: any) => self.authSignUp(args),
      signInWithPassword: async (args: any) => self.authSignIn(args),
      signOut: async (_args?: any) => self.authSignOut(),
      getSession: async () => self.authGetSession(),
      onAuthStateChange: (cb: (event: string, session: any) => void) => {
        self.listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => self.listeners.delete(cb) } } };
      },
    };
  }

  auth: {
    signUp: (args: any) => Promise<any>;
    signInWithPassword: (args: any) => Promise<any>;
    signOut: (args?: any) => Promise<any>;
    getSession: () => Promise<any>;
    onAuthStateChange: (cb: (event: string, session: any) => void) => any;
  };

  resetCalls() {
    this.calls = {
      select: 0,
      rpc: 0,
      upsert: 0,
      subscribe: 0,
      removeChannel: 0,
      auth: {},
    };
  }

  private bumpAuth(name: string) {
    this.calls.auth[name] = (this.calls.auth[name] ?? 0) + 1;
  }

  private fire(event: string, session: any) {
    for (const cb of [...this.listeners]) cb(event, session);
  }

  private sessionFor(id: string) {
    const u = this.tables.authUsers.find((x) => x.id === id);
    return u ? { user: { id: u.id, email: u.email }, access_token: "fake-at" } : null;
  }

  private async authSignUp(args: any) {
    this.bumpAuth("signUp");
    const email = String(args.email ?? "").trim().toLowerCase();
    const password = String(args.password ?? "");
    const username = String(args.options?.data?.username ?? email.split("@")[0]).trim();
    if (this.tables.authUsers.some((u) => u.email === email)) {
      // AuthError extends Error in production; rpc errors stay plain
      // { message } objects exactly like PostgREST returns.
      return {
        data: { user: null, session: null },
        error: new Error("User already registered"),
      };
    }
    const id = `user-${this.tables.nextIds.user++}`;
    this.tables.authUsers.push({ id, email, password });
    let finalName = username;
    if (this.tables.profiles.some((p) => p.username === finalName)) {
      finalName = `${username.slice(0, 15)}_${this.tables.nextIds.user}`;
    }
    // Mirrors handle_new_user: profile row appears with the signup.
    this.tables.profiles.push({
      id,
      username: finalName,
      email,
      avatar_url: null,
      points: 0,
      gems: 0,
      strikes: 0,
      wins: 0,
      created_at: nowIso(),
    });
    this.currentUserId = id;
    const session = this.sessionFor(id)!;
    this.fire("SIGNED_IN", session);
    return { data: { user: { id, email }, session }, error: null };
  }

  private async authSignIn(args: any) {
    this.bumpAuth("signInWithPassword");
    const email = String(args.email ?? "").trim().toLowerCase();
    const u = this.tables.authUsers.find((x) => x.email === email);
    if (!u || u.password !== String(args.password ?? "")) {
      return {
        data: { user: null, session: null },
        error: new Error("Invalid login credentials"),
      };
    }
    this.currentUserId = u.id;
    const session = this.sessionFor(u.id)!;
    this.fire("SIGNED_IN", session);
    return { data: { user: { id: u.id, email: u.email }, session }, error: null };
  }

  private async authSignOut() {
    this.bumpAuth("signOut");
    this.currentUserId = null;
    this.fire("SIGNED_OUT", null);
    return { error: null };
  }

  private async authGetSession() {
    this.bumpAuth("getSession");
    return {
      data: { session: this.currentUserId ? this.sessionFor(this.currentUserId) : null },
      error: null,
    };
  }

  /** Test-only escape hatch: act as a user without their password. */
  signInAs(userId: string) {
    this.currentUserId = userId;
  }

  from(table: keyof FakeDb) {
    return new FakeQuery(this, table);
  }

  async rpc(name: string, params: any = {}) {
    this.calls.rpc++;
    switch (name) {
      case "get_email_for_username": {
        const want = String(params.p_username ?? "").trim().toLowerCase();
        const hit = this.tables.profiles.find(
          (p) => String(p.username).toLowerCase() === want,
        );
        return { data: hit ? hit.email : null, error: null };
      }
      case "create_household": {
        const clean = String(params.p_name ?? "").trim();
        if (clean.length < 2)
          return { data: null, error: { message: "Household name is too short." } };
        if (clean.length > 50)
          return { data: null, error: { message: "Household name max 50 characters." } };
        const id = this.tables.nextIds.household++;
        const home = {
          id,
          name: clean,
          invite_code: `INV${String(id).padStart(9, "0")}`,
          created_by: this.currentUserId,
          created_at: nowIso(),
          check_date: null,
        };
        this.tables.households.push(home);
        this.tables.household_members.push({
          household_id: id,
          profile_id: this.currentUserId,
          role: "owner",
          joined_at: nowIso(),
        });
        return { data: home, error: null };
      }
      case "join_household_by_code": {
        const code = String(params.p_code ?? "").trim().toUpperCase();
        const home = this.tables.households.find((h) => h.invite_code === code);
        if (!home)
          return { data: null, error: { message: "No household uses that code" } };
        if (
          !this.tables.household_members.some(
            (m) => m.household_id === home.id && m.profile_id === this.currentUserId,
          )
        ) {
          this.tables.household_members.push({
            household_id: home.id,
            profile_id: this.currentUserId,
            role: "member",
            joined_at: nowIso(),
          });
        }
        return { data: home, error: null };
      }
      case "leave_household": {
        const hid = params.p_household_id;
        this.tables.household_members = this.tables.household_members.filter(
          (m) => !(m.household_id === hid && m.profile_id === this.currentUserId),
        );
        // Mirrors release_tasks_on_leave: taken cards go free again.
        for (const t of this.tables.tasks) {
          if (
            t.household_id === hid &&
            t.owner === this.currentUserId &&
            t.status === "taken"
          ) {
            t.status = "free";
            t.owner = null;
          }
        }
        if (!this.tables.household_members.some((m) => m.household_id === hid)) {
          this.tables.households = this.tables.households.filter((h) => h.id !== hid);
          this.tables.tasks = this.tables.tasks.filter((t) => t.household_id !== hid);
          this.tables.activity_logs = this.tables.activity_logs.filter(
            (l) => l.household_id !== hid,
          );
        }
        return { data: null, error: null };
      }
      case "get_household_logs": {
        const hid = params.p_household_id;
        const rows = this.tables.activity_logs
          .filter((l) => l.household_id === hid)
          .sort((a, b) => (a.created_at > b.created_at ? -1 : 1))
          .slice(0, 30);
        return { data: rows, error: null };
      }
      case "submit_for_review": {
        const task = this.tables.tasks.find((t) => t.id === params.p_task_id);
        if (!this.currentUserId) {
          return { data: null, error: { message: "Not authenticated" } };
        }
        if (!task) {
          return {
            data: null,
            error: { message: `Task ${params.p_task_id} does not exist` },
          };
        }
        if (
          !this.tables.household_members.some(
            (m) => m.household_id === task.household_id && m.profile_id === this.currentUserId,
          )
        ) {
          return { data: null, error: { message: "Not a member of this household" } };
        }
        if (task.owner !== this.currentUserId || task.status !== "taken") {
          return {
            data: null,
            error: {
              message: `Task ${task.id} cannot be reviewed by this user (not owned or not taken)`,
            },
          };
        }
        task.status = "in_review";
        return { data: { ...task }, error: null };
      }
      case "log_activity": {
        const hid = params.p_household_id;
        if (
          !this.tables.household_members.some(
            (m) => m.household_id === hid && m.profile_id === this.currentUserId,
          )
        ) {
          return { data: null, error: { message: "Not a member of this household" } };
        }
        const me = this.tables.profiles.find((p) => p.id === this.currentUserId);
        const entry = {
          id: this.tables.nextIds.log++,
          household_id: hid,
          owner: me ? me.username : null,
          details: String(params.p_details ?? "").trim().slice(0, 500),
          created_at: new Date().toISOString(),
        };
        this.tables.activity_logs.push(entry);
        return { data: entry, error: null };
      }
      default:
        return { data: null, error: { message: `unknown rpc ${name}` } };
    }
  }

  channel(name: string): FakeChannel {
    const ch: FakeChannel = {
      name,
      bindings: [],
      on(event: string, filter: any, cb: (payload: any) => void) {
        // NOTE: `event` here is the channel event name ("postgres_changes");
        // the row-level INSERT/UPDATE/DELETE selector lives on filter.event.
        ch.bindings.push({ event: filter.event ?? event, table: filter.table, filter: filter.filter, cb });
        return ch;
      },
      subscribe: () => {
        this.calls.subscribe++;
        return ch;
      },
    };
    this.channels.push(ch);
    return ch;
  }

  removeChannel(ch: FakeChannel) {
    this.calls.removeChannel++;
    this.channels = this.channels.filter((c) => c !== ch);
  }

  /** Push a realtime event through every matching binding, like the server. */
  emit(table: string, eventType: "INSERT" | "UPDATE" | "DELETE", row: any) {
    for (const ch of this.channels) {
      for (const b of ch.bindings) {
        if (b.table !== table) continue;
        if (b.event !== "*" && b.event !== eventType) continue;
        const m = String(b.filter ?? "").match(/^(\w+)=eq\.(.+)$/);
        if (m) {
          const probe = eventType === "DELETE" ? row : row;
          if (String(probe[m[1]]) !== m[2]) continue;
        }
        b.cb({ eventType, new: eventType === "DELETE" ? {} : row, old: row });
      }
    }
  }

  bindingsFor(channelName: string): FakeBinding[] {
    return this.channels.find((c) => c.name === channelName)?.bindings ?? [];
  }
}

export { iso };
