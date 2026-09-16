// Deterministic fixture: two users, two households, a full board.
// Counts are chosen to prove caps: 55 tasks (page is 50),
// 35 logs in household 1 (RPC cap is 30).
import { emptyDb, iso, type FakeDb } from "./fake_supabase";

const T0 = Date.parse("2026-01-01T00:00:00Z");

export const ANA = { id: "user-ana", email: "ana@mail.com", password: "secret12", username: "ana" };
export const BOB = { id: "user-bob", email: "bob@mail.com", password: "hunter22", username: "bob" };
export const CHARLIE = { id: "user-charlie", email: "charlie@mail.com", password: "pass1234", username: "charlie" };

function profile(u: typeof ANA, points = 0, gems = 0) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    avatar_url: null,
    points,
    gems,
    strikes: 0,
    wins: 0,
    created_at: iso(T0, 0),
  };
}

export function createSeed(): FakeDb {
  const db = emptyDb();
  db.authUsers.push(
    { id: ANA.id, email: ANA.email, password: ANA.password },
    { id: BOB.id, email: BOB.email, password: BOB.password },
    { id: CHARLIE.id, email: CHARLIE.email, password: CHARLIE.password },
  );
  db.profiles.push(profile(ANA, 250, 3), profile(BOB, 120, 1), profile(CHARLIE));

  db.households.push(
    {
      id: 1,
      name: "Sunset Flat",
      invite_code: "SUNSET000001",
      created_by: ANA.id,
      created_at: iso(T0, 10),
      check_at: null,
    },
    {
      id: 2,
      name: "Beach House",
      invite_code: "BEACH0000002",
      created_by: BOB.id,
      created_at: iso(T0, 20),
      check_at: null,
    },
  );
  db.household_members.push(
    { household_id: 1, profile_id: ANA.id, role: "owner", joined_at: iso(T0, 11) },
    { household_id: 1, profile_id: BOB.id, role: "member", joined_at: iso(T0, 12) },
    { household_id: 2, profile_id: BOB.id, role: "owner", joined_at: iso(T0, 21) },
    { household_id: 2, profile_id: ANA.id, role: "member", joined_at: iso(T0, 22) },
  );

  for (let i = 1; i <= 55; i++) {
    db.tasks.push({
      id: i,
      title: `Task ${i}`,
      description: null,
      difficulty: "easy",
      points: 100 + (i % 31),
      status: "free",
      household_id: 1,
      owner: null,
      created_by: ANA.id,
      created_at: iso(T0, 100 + i),
    });
  }
  // One taken card owned by bob, for the leave-releases-tasks test.
  db.tasks.push({
    id: 56,
    title: "Bob's chore",
    description: null,
    difficulty: "medium",
    points: 220,
    status: "taken",
    household_id: 1,
    owner: BOB.id,
    created_by: ANA.id,
    created_at: iso(T0, 200),
  });
  for (let i = 57; i <= 59; i++) {
    db.tasks.push({
      id: i,
      title: `Beach task ${i}`,
      description: null,
      difficulty: "easy",
      points: 110,
      status: "free",
      household_id: 2,
      owner: null,
      created_by: BOB.id,
      created_at: iso(T0, 300 + i),
    });
  }

  for (let i = 1; i <= 35; i++) {
    db.activity_logs.push({
      id: i,
      household_id: 1,
      owner: i % 2 ? "ana" : "bob",
      details: `Log ${i}`,
      created_at: iso(T0, 1000 + i),
    });
  }
  db.activity_logs.push(
    { id: 36, household_id: 2, owner: "bob", details: "Beach log", created_at: iso(T0, 2000) },
    { id: 37, household_id: 2, owner: "ana", details: "Beach log 2", created_at: iso(T0, 2001) },
  );

  db.nextIds = { household: 3, task: 60, log: 38, user: 100 };
  return db;
}
