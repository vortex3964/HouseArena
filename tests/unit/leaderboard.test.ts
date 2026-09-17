import { rankUsers, type LeaderboardUser } from "../../src/components/leaderboard";

function user(id: string, extra: Partial<LeaderboardUser> = {}): LeaderboardUser {
  return { id, name: id, points: 0, avatarUrl: null, ...extra };
}

describe("rankUsers", () => {
  it("sorts points desc and numbers ranks from 1", () => {
    const ranked = rankUsers([
      user("b", { points: 10 }),
      user("a", { points: 30 }),
      user("c", { points: 20 }),
    ]);
    expect(ranked.map((u) => u.id)).toEqual(["a", "c", "b"]);
    expect(ranked.map((u) => u.rank)).toEqual([1, 2, 3]);
  });

  it("returns an empty list for no users", () => {
    expect(rankUsers([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [user("b", { points: 10 }), user("a", { points: 30 })];
    rankUsers(input);
    expect(input.map((u) => u.id)).toEqual(["b", "a"]);
  });
});
