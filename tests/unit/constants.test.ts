import { Lengths, Limits, Messages, QueryCache, Routes, Timeouts } from "../../src/global/constants";

// Guards the tunables against silent drift: caps must match the SQL
// prune/parent logic, messages must stay non-empty, orderings sane.
describe("constants", () => {
  it("keeps cache, limits, and lengths coherent", () => {
    expect(QueryCache.LIVE_STALE_TIME).toBeGreaterThan(QueryCache.STALE_TIME);
    expect(QueryCache.RETRY).toBe(1);
    expect(Limits.TASKS_PAGE).toBe(50);
    expect(Limits.MEMBERS_PAGE).toBe(50);
    expect(Limits.LOGS_CAP).toBe(30);
    expect(Lengths.USERNAME_MIN).toBeLessThan(Lengths.USERNAME);
    expect(Lengths.RESET_CODE).toBe(6);
    expect(Lengths.PASSWORD_MIN).toBe(6);
    expect(Messages.PASSWORD_TOO_SHORT).toContain("6");
    expect(Lengths.INVITE_CODE).toBe(12);
  });

  it("keeps routes and messages well-formed", () => {
    for (const r of Object.values(Routes)) expect(r.startsWith("/")).toBe(true);
    for (const m of Object.values(Messages)) {
      expect(typeof m).toBe("string");
      expect(m.length).toBeGreaterThan(0);
    }
    for (const t of Object.values(Timeouts)) expect(t).toBeGreaterThan(0);
  });
});
