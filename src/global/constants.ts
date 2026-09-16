// Single source for tunables shared across screens and system modules.
// Mirror changes in supabase/functions (Deno, cannot import this file)
// when touching auth limits there: reset code length, password minimum,
// throttle window.
export const Timeouts = {
  SECURE_STORE_OP: 8000,
  SESSION_STORE_OP: 15000,
  PROFILE_LOAD: 15000,
  HOUSEHOLDS_LOAD: 15000,
  BOOT_RESTORE: 25000,
  SESSION_RESTORE: 12000,
  SIGN_OUT: 8000,
} as const;

export const QueryCache = {
  STALE_TIME: 30_000,
  GC_TIME: 5 * 60_000,
  RETRY: 1,
  // Live board keys merge realtime payloads, so remounts and refocuses
  // must not refetch behind the subscription's back.
  LIVE_STALE_TIME: 5 * 60_000,
} as const;

export const Limits = {
  TASKS_PAGE: 50,
  MEMBERS_PAGE: 50,
  LOGS_CAP: 30,
} as const;

export const Lengths = {
  HOUSEHOLD_NAME: 50,
  INVITE_CODE: 12,
  USERNAME: 20,
  USERNAME_MIN: 3,
  TASK_TITLE: 60,
  RESET_CODE: 6,
  PASSWORD_MIN: 6,
} as const;

// Allowed points per task difficulty. Mirrors the
// points_match_difficulty CHECK in Db/Schema.sql — validate
// client-side so users get a friendly error, not a raw
// Postgres constraint violation.
export const PointsBands = {
  easy: { min: 100, max: 130 },
  medium: { min: 200, max: 260 },
  hard: { min: 300, max: 400 },
} as const;

export const Routes = {
  HOME: "/",
  LOGIN: "/login",
  REGISTER: "/register",
  HOUSEHOLD_SETUP: "/household-setup",
  SETTINGS: "/settings",
} as const;

export const Messages = {
  PASSWORDS_MISMATCH: "Passwords don't match.",
  PASSWORD_TOO_SHORT: "Password needs at least 6 characters.",
  BACKEND_CODES_FIRST: "Paste your Supabase URL + anon key first.",
  BACKEND_CONNECT_FIRST: "Connect your backend first.",
  BACKEND_AUTH_FIRST: "Connect your Supabase backend first (URL + anon key).",
  LOGIN_REQUIRED: "You must be logged in.",
  NO_ACTIVE_HOUSEHOLD: "No active household.",
  TYPE_EMAIL_FIRST: "Type your email first.",
} as const;
