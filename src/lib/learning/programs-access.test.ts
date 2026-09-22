import { describe, expect, it } from "vitest";
import { programsAccessRedirect } from "./programs-access";

describe("programs access", () => {
  it("sends signed-out members to the existing sign-in path", () => {
    expect(
      programsAccessRedirect({ userId: null, metadata: {}, isNativeApp: false })
    ).toBe("/sign-in");
    expect(
      programsAccessRedirect({ userId: undefined, metadata: null, isNativeApp: true })
    ).toBe("/app/sign-in");
  });

  it("sends signed-in inactive members to the existing membership path", () => {
    expect(
      programsAccessRedirect({
        userId: "user_a",
        metadata: { summittSubscribed: false },
        isNativeApp: false,
      })
    ).toBe("/subscribe");
    expect(
      programsAccessRedirect({
        userId: "user_a",
        metadata: {},
        isNativeApp: true,
      })
    ).toBe("/app/membership");
  });

  it("allows the same active membership signals Film Room uses", () => {
    expect(
      programsAccessRedirect({
        userId: "user_a",
        metadata: { summittSubscribed: true },
        isNativeApp: false,
      })
    ).toBeNull();
    expect(
      programsAccessRedirect({
        userId: "user_a",
        metadata: { summittSubscribed: "true" },
        isNativeApp: false,
      })
    ).toBeNull();
    expect(
      programsAccessRedirect({
        userId: "user_a",
        metadata: { summittPlan: "monthly" },
        isNativeApp: true,
      })
    ).toBeNull();
    expect(
      programsAccessRedirect({
        userId: "user_a",
        metadata: { summittPlan: "annual" },
        isNativeApp: false,
      })
    ).toBeNull();
  });
});
