import { describe, expect, it } from "vitest";
import { UPDATE_GOAL_REQUIRES_NEW_CHAPTER_USER_MESSAGE } from "@/lib/update-goal-season-copy";

describe("update-goal-season-copy", () => {
  it("defines friendly legacy cohort message", () => {
    expect(UPDATE_GOAL_REQUIRES_NEW_CHAPTER_USER_MESSAGE).toContain("new chapter");
    expect(UPDATE_GOAL_REQUIRES_NEW_CHAPTER_USER_MESSAGE).toContain("past proof stays safe");
  });
});
