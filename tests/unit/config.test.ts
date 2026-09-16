import { sanitizeConfig, validateConfig } from "../../src/system/supabase";

describe("sanitizeConfig", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(
      sanitizeConfig("  https://xyz.supabase.co/// ", "  abcdef  "),
    ).toEqual({ url: "https://xyz.supabase.co", anonKey: "abcdef" });
  });
});

describe("validateConfig", () => {
  const goodKey = "a".repeat(40);
  const good = { url: "https://xyz.supabase.co", anonKey: goodKey };

  it("accepts a proper project config", () => {
    expect(validateConfig(good)).toBeNull();
  });

  it("rejects non-https, foreign hosts, and short keys", () => {
    expect(validateConfig({ ...good, url: "http://xyz.supabase.co" })).toBe(
      "Supabase URL must start with https://",
    );
    expect(validateConfig({ ...good, url: "https://evil.example.com" })).toBe(
      "That URL doesn't look like a Supabase URL.",
    );
    expect(validateConfig({ ...good, anonKey: "short" })).toBe(
      "Anon key looks too short - paste the full anon key.",
    );
  });
});
