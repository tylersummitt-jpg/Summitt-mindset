import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

vi.mock("@/lib/onboarding-subscription-metadata", () => ({
  isSubscribedFromPublicMetadata: () => true,
}));

vi.mock("@/lib/onboarding-sms-consent", () => ({
  hasValidSmsConsent: () => true,
}));

import { getOnboardingSobStatus } from "@/lib/onboarding-sob-gates";

function chainMaybeSingle(result: { data: unknown }) {
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

describe("goal resubmit resets review before SMS", () => {
  const commitmentRoute = readFileSync(
    join(process.cwd(), "src/app/api/onboarding/commitment/route.ts"),
    "utf8"
  );
  const persistSrc = readFileSync(
    join(process.cwd(), "src/lib/onboarding-persist-commitment.ts"),
    "utf8"
  );
  const persistenceMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260601120000_sob_onboarding_persistence.sql"),
    "utf8"
  );

  it("commitment API deletes proposed commitments before insert", () => {
    expect(commitmentRoute).toContain('.delete()');
    expect(commitmentRoute).toContain('.eq("status", "proposed")');
  });

  it("v2_commitment_intake cascades when proposed commitment is deleted", () => {
    expect(persistenceMigration).toContain(
      "commitment_id UUID PRIMARY KEY REFERENCES v2_commitment (id) ON DELETE CASCADE"
    );
  });

  it("fresh intake insert does not set review_acknowledged_at", () => {
    expect(persistSrc).toContain('from("v2_commitment_intake").insert');
    expect(persistSrc).not.toContain("review_acknowledged_at");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gate returns needs_review after goal resubmit (fresh intake, null acknowledgment)", async () => {
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
        return commitmentFromMock({ id: "prop-new" }, null);
      }
      if (table === "v2_commitment_intake") {
        return chainMaybeSingle({ data: { review_acknowledged_at: null } });
      }
      return chainMaybeSingle({ data: null });
    });

    const gate = await getOnboardingSobStatus("user_1", { onboardingCompleted: false });
    expect(gate.status).toBe("needs_review");
    expect(gate.redirectTo).toBe("/onboarding/review");
  });
});
