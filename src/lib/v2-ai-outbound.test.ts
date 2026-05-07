import { describe, expect, it, vi } from "vitest";

// v2-ai-outbound imports modules that reference supabaseServer at module load.
// Mock so this unit test doesn't require SUPABASE_* env vars.
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
    })),
  },
}));

import { validateV2AiOutboundMessage } from "@/lib/v2-ai-outbound";

describe("validateV2AiOutboundMessage", () => {
  it("does not reject good human coaching that invites a reply without a rigid yes/no question", () => {
    const r = validateV2AiOutboundMessage({
      message: "Good. Keep it simple: protect the hour today. Tell me straight what happened.",
      serverStrategy: "standard_check",
      modelStrategy: "standard_check",
      behaviorStatement: "1 hour of distribution",
      contractProposalMode: false,
      contractProposalBindingText: null,
      identityReferenceAllowed: false,
      identityAnchorText: null,
    });
    expect(r.ok).toBe(true);
  });
});

