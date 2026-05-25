import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

import { loadIdentityEditDraft } from "@/lib/load-identity-edit-draft";

describe("loadIdentityEditDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads profile, active version fields, and onboarding+edit important people", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "user_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    preferred_name: "Alex",
                    identity_anchor_text: "I keep my word.",
                    active_identity_version_id: "ver_1",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "user_identity_version") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: () =>
                    Promise.resolve({
                      data: {
                        ingredient_ids: ["dad", "discipline"],
                        other_text: "builder",
                        intake_origin: "generated",
                        use_mine_anyway: false,
                        clarity_score: 80,
                      },
                      error: null,
                    }),
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
              in: () => ({
                eq: () => ({
                  is: () =>
                    Promise.resolve({
                      data: [
                        { display_name: "Sam", relationship_type: "child", source: "onboarding" },
                        { display_name: "Jordan", relationship_type: "spouse_partner", source: "edit" },
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

    const draft = await loadIdentityEditDraft("user_1");

    expect(draft.preferredName).toBe("Alex");
    expect(draft.identityAnchorText).toBe("I keep my word.");
    expect(draft.activeIdentityVersionId).toBe("ver_1");
    expect(draft.ingredientIds).toEqual(["dad", "discipline"]);
    expect(draft.otherText).toBe("builder");
    expect(draft.intakeOrigin).toBe("generated");
    expect(draft.importantPeople).toHaveLength(2);
    expect(fromMock).toHaveBeenCalledWith("user_profiles");
    expect(fromMock).toHaveBeenCalledWith("user_identity_version");
    expect(fromMock).toHaveBeenCalledWith("important_people");
  });
});
