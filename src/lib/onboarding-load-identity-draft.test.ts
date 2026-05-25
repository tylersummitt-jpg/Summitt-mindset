import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPeopleSummaryMirror } from "@/lib/onboarding-people-summary";

const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe("loadIdentityOnboardingDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads active identity version fields and onboarding important people", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_identity_version") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      ingredient_ids: ["parent", "discipline"],
                      other_text: "  Calm under pressure  ",
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "important_people") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: () =>
                    Promise.resolve({
                      data: [
                        { display_name: "Sam", relationship_type: "child" },
                        { display_name: "Jordan", relationship_type: "spouse_partner" },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { loadIdentityOnboardingDraft } = await import("./onboarding-load-identity-draft");
    const draft = await loadIdentityOnboardingDraft("user_1", "ver-1");

    expect(draft.ingredientIds).toEqual(["parent", "discipline"]);
    expect(draft.otherText).toBe("Calm under pressure");
    expect(draft.importantPeople).toEqual([
      { display_name: "Sam", relationship_type: "child" },
      { display_name: "Jordan", relationship_type: "spouse_partner" },
    ]);

    const mirror = buildPeopleSummaryMirror(
      draft.importantPeople.map((p) => ({ relationship_type: p.relationship_type }))
    );
    expect(mirror).not.toContain("Sam");
    expect(mirror).not.toContain("Jordan");
  });

  it("returns empty draft when no active identity version", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "important_people") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { loadIdentityOnboardingDraft } = await import("./onboarding-load-identity-draft");
    const draft = await loadIdentityOnboardingDraft("user_1", null);
    expect(draft.ingredientIds).toEqual([]);
    expect(draft.otherText).toBeNull();
    expect(draft.importantPeople).toEqual([]);
  });
});
