import { variantFor } from "../../src/components/task_board";
import type { Task } from "../../src/system/obj_types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    household_id: 7,
    title: "Dishes",
    description: null,
    difficulty: "easy",
    points: 10,
    status: "free",
    owner: null,
    created_by: "u1",
    created_at: "2026-01-01T00:00:00Z",
    completed_at: null,
    ...overrides,
  } as Task;
}

describe("variantFor", () => {
  it("maps free to available", () => {
    expect(variantFor(makeTask({ status: "free" }), "me")).toBe("available");
  });

  it("maps completed to done", () => {
    expect(variantFor(makeTask({ status: "completed" }), "me")).toBe("done");
  });

  it("maps taken to claimed", () => {
    expect(variantFor(makeTask({ status: "taken", owner: "me" }), "me")).toBe("claimed");
  });

  it("splits in_review by ownership", () => {
    expect(variantFor(makeTask({ status: "in_review", owner: "me" }), "me")).toBe("claimed");
    expect(variantFor(makeTask({ status: "in_review", owner: "other" }), "me")).toBe("review");
  });
});
