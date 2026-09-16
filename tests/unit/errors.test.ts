import { toMessage } from "../../src/system/errors";
import {
  friendlyAuthError,
  isBackendDownError,
} from "../../src/system/supabase";

describe("toMessage", () => {
  it("unwraps Errors and stringifies the rest", () => {
    expect(toMessage(new Error("boom"))).toBe("boom");
    expect(toMessage("plain")).toBe("plain");
    expect(toMessage(42)).toBe("42");
  });
});

describe("friendlyAuthError", () => {
  it("maps known auth failures to user text", () => {
    expect(friendlyAuthError(new Error("Invalid login credentials"))).toBe(
      "No account matches that username + password.",
    );
    expect(friendlyAuthError(new Error("User already registered"))).toBe(
      "That username is taken - try logging in.",
    );
    expect(friendlyAuthError(new Error("Email not confirmed"))).toContain("Confirm");
    expect(friendlyAuthError(new Error("fetch failed"))).toBe(
      "Can't reach Supabase - check the URL/key and connection.",
    );
  });

  it("passes unknown and non-Error values through", () => {
    expect(friendlyAuthError(new Error("weird 500"))).toBe("weird 500");
    expect(friendlyAuthError("raw string")).toBe("raw string");
  });

  it("handles plain { message } objects like PostgREST returns", () => {
    expect(friendlyAuthError({ message: "Invalid login credentials" })).toBe(
      "No account matches that username + password.",
    );
    expect(friendlyAuthError({ message: "something broke" })).toBe("something broke");
    expect(friendlyAuthError({ code: 500 })).toBe("[object Object]");
  });
});

describe("isBackendDownError", () => {
  it("spots network-like failures only", () => {
    expect(isBackendDownError(new Error("Network request failed"))).toBe(true);
    expect(isBackendDownError(new Error("fetch failed"))).toBe(true);
    expect(isBackendDownError(new Error("No account matches that username + password."))).toBe(
      false,
    );
    expect(isBackendDownError(new Error("That username is taken"))).toBe(false);
    expect(isBackendDownError({ message: "fetch failed" })).toBe(true);
    expect(isBackendDownError({ message: "No account matches" })).toBe(false);
  });
});
