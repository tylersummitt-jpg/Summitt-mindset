import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getOnboardingSobStatus,
  MEMBER_APP_HOME_PATH,
  ONBOARDING_PATH_RANK,
  resolveOnboardingSobRedirect,
} from "@/lib/onboarding-sob-gates";

const fromMock = vi.fn();
const maybeSingleMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

vi.mock("@/lib/onboarding-subscription-metadata", () => ({
  isSubscribedFromPublicMetadata: () => true,
}));

vi.mock("@/lib/onboarding-sms-consent", () => ({
  hasValidSmsConsent: (md: Record<string, unknown>) =>
    md.smsEnabled === true &&
    typeof md.phoneNumber === "string" &&
    md.phoneNumber.length > 0 &&
    md.smsDisclosureAccepted === true,
}));

function chainMaybeSingle(result: { data: unknown; error?: null }) {
  const maybeSingle = () => Promise.resolve(result);
  const limit = () => ({ maybeSingle });
  const order = () => ({ limit, maybeSingle });
  const eq2 = () => ({ order, limit, maybeSingle });
  const eq1 = () => ({ eq: eq2, order, limit, maybeSingle });
  return {
    select: () => ({ eq: eq1, maybeSingle }),
    maybeSingle,
  };
}

function commitmentFromMock(proposed: unknown, active: unknown) {
  return {
    select: () => ({
      eq: () => ({
        eq: (_key: string, status: string) => {
          if (status === "proposed") {
            return {
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: proposed }),
                }),
              }),
            };
          }
          return {
            maybeSingle: () => Promise.resolve({ data: active }),
          };
        },
      }),
    }),
  };
}

describe("resolveOnboardingSobRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects SMS skip-ahead to review when review not acknowledged", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return chainMaybeSingle({
          data: {
            preferred_name: "Alex",
            identity_anchor_text: "I am becoming steadier.",
            active_identity_version_id: "v1",
          },
        });
      }
      if (table === "v2_commitment") {
        return commitmentFromMock({ id: "prop-1" }, null);
      }
      if (table === "v2_commitment_intake") {
        return chainMaybeSingle({ data: { review_acknowledged_at: null } });
      }
      return chainMaybeSingle({ data: null });
    });

    const md = { onboardingCompleted: false };
    const dest = await resolveOnboardingSobRedirect("user_1", md, "/onboarding/sms");
    expect(dest).toBe("/onboarding/review");
  });

  it("allows review page when review is required", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return chainMaybeSingle({
          data: {
            preferred_name: "Alex",
            identity_anchor_text: "I am becoming steadier.",
            active_identity_version_id: "v1",
          },
        });
      }
      if (table === "v2_commitment") {
        return commitmentFromMock({ id: "prop-1" }, null);
      }
      if (table === "v2_commitment_intake") {
        return chainMaybeSingle({ data: { review_acknowledged_at: null } });
      }
      return chainMaybeSingle({ data: null });
    });

    const dest = await resolveOnboardingSobRedirect("user_1", { onboardingCompleted: false }, "/onboarding/review");
    expect(dest).toBeNull();
  });

  it("redirects partial users away from welcome hub", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return chainMaybeSingle({
          data: {
            preferred_name: "Alex",
            identity_anchor_text: "I am becoming steadier.",
            active_identity_version_id: "v1",
          },
        });
      }
      if (table === "v2_commitment") {
        return commitmentFromMock(null, null);
      }
      return chainMaybeSingle({ data: null });
    });

    const dest = await resolveOnboardingSobRedirect("user_1", { onboardingCompleted: false }, "/onboarding");
    expect(dest).toBe("/onboarding/commitment");
  });

  it("completed users on onboarding routes go to Victory Room", async () => {
    const dest = await resolveOnboardingSobRedirect(
      "user_1",
      { onboardingCompleted: true },
      "/onboarding/sms"
    );
    expect(dest).toBe(MEMBER_APP_HOME_PATH);
  });

  it("getOnboardingSobStatus complete redirect points to Victory Room", async () => {
    const gate = await getOnboardingSobStatus("user_1", {
      onboardingCompleted: true,
      smsEnabled: true,
      phoneNumber: "+15551234567",
      smsDisclosureAccepted: true,
    });
    expect(gate.status).toBe("complete");
    expect(gate.redirectTo).toBe(MEMBER_APP_HOME_PATH);
  });
});

describe("ONBOARDING_PATH_RANK", () => {
  it("orders review before sms", () => {
    expect(ONBOARDING_PATH_RANK["/onboarding/review"]).toBeLessThan(
      ONBOARDING_PATH_RANK["/onboarding/sms"]
    );
  });
});

describe("getOnboardingSobStatus types", () => {
  it("source does not define needs_why status", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/lib/onboarding-sob-gates.ts"), "utf8");
    expect(src).not.toMatch(/\|\s*"needs_why"/);
  });
});
