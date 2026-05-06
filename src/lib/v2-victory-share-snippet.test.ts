import { describe, expect, it } from "vitest";

import {
  buildShareSnippetFromMoment,
  type VictoryRoomViewForShare,
} from "@/lib/v2-victory-share-snippet";

describe("buildShareSnippetFromMoment (Phase 1 trust cleanup)", () => {
  it("does not include internal/system terms in plainText", () => {
    const view: VictoryRoomViewForShare = {
      hasActiveV2Commitment: true,
      profile: {
        preferred_name: "Brooke",
        identity_anchor_text: "I keep my word when it’s hard.",
      },
      commitment: { id: "c1", title: "Morning writing" },
      effectiveCoachingAsk: "Write 20 minutes before noon.",
      chapterRecord: {
        openedAt: null,
        firstProofAt: null,
        latestProofAt: null,
        proofCategoryLabels: [],
        earlierSeasonCount: 0,
      },
      moments: [
        {
          id: "m1",
          occurredAt: "2026-05-01T12:00:00Z",
          headline: "Stayed engaged",
          body: "You stayed engaged instead of disappearing.",
          groundedInEventTypes: ["user_partial"],
        },
      ],
      comebackLines: [],
      optionalMemoryProjectionLine: null,
      archiveMoments: [],
      priorChapters: [],
      cornerstoneMoments: [],
      share_identity_line: "Brooke",
    };

    const snippet = buildShareSnippetFromMoment(view, "m1");
    expect(snippet).not.toBeNull();
    expect(snippet!.plainText).toContain("You stayed engaged instead of disappearing.");
    expect(snippet!.plainText).toContain("Current bar: Write 20 minutes before noon.");
    expect(snippet!.plainText).toContain("From my Victory Room · Summitt");

    const forbidden = [
      "spine",
      "event_type",
      "user_partial",
      "sms_memory_signal",
      "payload_json",
      "v2_commitment_event",
    ];
    for (const term of forbidden) {
      expect(snippet!.plainText.toLowerCase()).not.toContain(term);
    }
  });
});

