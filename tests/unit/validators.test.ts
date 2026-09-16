import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "../../src/system/supabase";

describe("validateUsername", () => {
  it("accepts a normal name and trims padding", () => {
    expect(validateUsername("ana")).toBeNull();
    expect(validateUsername("  ana_99  ")).toBeNull();
  });

  it("rejects short, long, and illegal names", () => {
    expect(validateUsername("ab")).toBe("Username needs at least 3 characters.");
    expect(validateUsername("a".repeat(21))).toBe(
      "Username must be 20 characters or less.",
    );
    expect(validateUsername("a b")).toBe("Only letters, numbers, _ and - allowed.");
    expect(validateUsername("a@b")).toBe("Only letters, numbers, _ and - allowed.");
    expect(validateUsername("   ")).toBe("Username needs at least 3 characters.");
  });
});

describe("validatePassword", () => {
  it("enforces the 6 character minimum", () => {
    expect(validatePassword("12345")).toBe("Password needs at least 6 characters.");
    expect(validatePassword("123456")).toBeNull();
  });
});

describe("validateEmail", () => {
  it("requires a present, shaped address", () => {
    expect(validateEmail("")).toBe("Type your email.");
    expect(validateEmail("   ")).toBe("Type your email.");
    expect(validateEmail("nope")).toBe("That email does not look right.");
    expect(validateEmail("a@b")).toBe("That email does not look right.");
  });

  it("accepts real shapes and trims", () => {
    expect(validateEmail("ana@mail.com")).toBeNull();
    expect(validateEmail("  Ana@Mail.com  ")).toBeNull();
  });
});
