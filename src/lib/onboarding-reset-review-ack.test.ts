import { beforeEach, describe, expect, it, vi } from "vitest";

const fromMock = vi.fn();
const updateMock = vi.fn();

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

describe("clearProposedCommitmentReviewAcknowledgment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets review_acknowledged_at null on proposed commitment intake", async () => {
    updateMock.mockReturnValue({
      eq: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    });

    fromMock.mockImplementation((table: string) => {
      if (table === "v2_commitment") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: { id: "prop-1" }, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "v2_commitment_intake") {
        return { update: updateMock };
      }
      return {};
    });

    const { clearProposedCommitmentReviewAcknowledgment } = await import(
      "./onboarding-reset-review-ack"
    );
    await clearProposedCommitmentReviewAcknowledgment("user_1");

    expect(updateMock).toHaveBeenCalled();
    const payload = updateMock.mock.calls[0][0];
    expect(payload.review_acknowledged_at).toBeNull();
  });

  it("no-ops when no proposed commitment exists", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "v2_commitment") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: () => Promise.resolve({ data: null, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const { clearProposedCommitmentReviewAcknowledgment } = await import(
      "./onboarding-reset-review-ack"
    );
    await clearProposedCommitmentReviewAcknowledgment("user_1");
    expect(updateMock).not.toHaveBeenCalled();
  });
});
