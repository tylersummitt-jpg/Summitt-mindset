import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  extractUserRepliesSinceMorningAnchor,
  morningAnchorToPreviousOutbound,
  resolveEveningPreviewMorningAnchor,
} from "@/lib/evening-preview-context-v1";

function mockSupabase(handlers: {
  sendEvent?: Record<string, unknown> | null;
  morningDraft?: Record<string, unknown> | null;
  generation?: Record<string, unknown> | null;
}) {
  return {
    from: (table: string) => ({
      select: () => {
        if (table === "sms_daily_draft_generations") {
          return {
            eq: () => ({
              maybeSingle: async () => ({
                data: handlers.generation ?? null,
                error: null,
              }),
            }),
          };
        }
        return {
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  if (table === "sms_send_events") {
                    return { data: handlers.sendEvent ?? null, error: null };
                  }
                  if (table === "sms_daily_drafts") {
                    return { data: handlers.morningDraft ?? null, error: null };
                  }
                  return { data: null, error: null };
                },
              }),
            }),
          }),
        };
      },
    }),
  } as never;
}

describe("resolveEveningPreviewMorningAnchor", () => {
  it("prefers send_event body when sent", async () => {
    const anchor = await resolveEveningPreviewMorningAnchor({
      clerkUserId: "user_1",
      draftForDayKey: "2026-07-06",
      supabase: mockSupabase({
        sendEvent: {
          sms_body: "Morning rep: one compliment per kid.",
          status: "delivered",
          metadata: { sent_at: "2026-07-06T12:00:00.000Z" },
          created_at: "2026-07-06T12:00:00.000Z",
        },
      }),
    });
    expect(anchor.source).toBe("send_event");
    expect(anchor.sent).toBe(true);
    expect(anchor.body).toMatch(/compliment/i);
  });

  it("falls back to tto draft current body", async () => {
    const anchor = await resolveEveningPreviewMorningAnchor({
      clerkUserId: "user_1",
      draftForDayKey: "2026-07-06",
      supabase: mockSupabase({
        morningDraft: {
          final_body_sent: null,
          current_body_to_send: "Today's rep from TTO draft.",
          status: "current",
          sent_at: null,
          current_generation_id: "gen-morning",
        },
        generation: {
          machine_draft_body: "machine",
          machine_should_send: true,
          generation_metadata: {},
        },
      }),
    });
    expect(anchor.source).toBe("tto_draft_current_body");
    expect(anchor.body).toMatch(/TTO draft/i);
  });

  it("morningAnchorToPreviousOutbound sets inferred morning slot", () => {
    const outbound = morningAnchorToPreviousOutbound({
      source: "send_event",
      body: "Set today's rep.",
      sent: true,
      machineShouldSend: true,
      sentAt: null,
      slotCoachingContext: null,
    });
    expect(outbound?.inferred_slot).toBe("morning");
  });
});

describe("extractUserRepliesSinceMorningAnchor", () => {
  it("collects user messages after morning coach body", () => {
    const replies = extractUserRepliesSinceMorningAnchor({
      threadMessages: [
        { at_local: "Mon 7:00 AM", role: "coach", body: "What's your plan for today?" },
        { at_local: "Mon 7:05 AM", role: "user", body: "After lunch." },
      ],
      morningBody: "What's your plan for today?",
      sentAt: null,
    });
    expect(replies).toEqual(["After lunch."]);
  });
});
