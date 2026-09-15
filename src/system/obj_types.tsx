// App-level DB types mirroring Db/Schema.sql v2.
// One user can belong to many households through household_members.

export type TaskDifficulty = "easy" | "medium" | "hard";
export type TaskStatus = "free" | "taken" | "completed";
export type MemberRole = "owner" | "admin" | "member";

export type Profile = {
  id: string;
  username: string;
  email: string | null;
  avatar_url: string | null;
  points: number;
  gems: number;
  strikes: number;
  wins: number;
  created_at: string;
};

export type Task = {
  id: number;
  title: string;
  description: string | null;
  difficulty: TaskDifficulty;
  points: number;
  status: TaskStatus;
  household_id: number;
  owner: string | null;
  created_at: string;
};

export type Household = {
  id: number;
  name: string;
  invite_code: string;
  created_by: string | null;
  created_at: string;
  check_date: string | null;
};

export type HouseholdMember = {
  household_id: number;
  profile_id: string;
  role: MemberRole;
  joined_at: string;
  profile?: Profile;
};

// One row of the "my households" list: membership plus household details.
export type MyHousehold = {
  role: MemberRole;
  joined_at: string;
  household: Household;
};

export type ActivityLog = {
  id: number;
  household_id: number;
  owner: string | null;
  details: string | null;
  created_at: string;
};
