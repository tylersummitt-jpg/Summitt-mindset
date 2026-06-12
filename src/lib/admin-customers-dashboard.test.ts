import { describe, expect, it } from "vitest";

import {
  formatSubscriptionLabel,
  formatTextStatusLabel,
  isCurrentSubscribedMember,
  normalizeAdminCustomerNotesPatch,
  resolveQuotesBookSentAtPatch,
} from "@/lib/admin-customers-dashboard-pure";

describe("admin-customers-dashboard", () => {
  describe("isCurrentSubscribedMember", () => {
    it("requires summittSubscribed === true strictly", () => {
      expect(isCurrentSubscribedMember({ summittSubscribed: true })).toBe(true);
      expect(isCurrentSubscribedMember({ summittSubscribed: "true" })).toBe(false);
      expect(isCurrentSubscribedMember({ summittPlan: "monthly" })).toBe(false);
      expect(isCurrentSubscribedMember(null)).toBe(false);
    });
  });

  describe("formatSubscriptionLabel", () => {
    it("includes plan when present", () => {
      expect(formatSubscriptionLabel({ summittPlan: "annual" })).toBe("Active (annual)");
      expect(formatSubscriptionLabel({ summittPlan: "monthly" })).toBe("Active (monthly)");
      expect(formatSubscriptionLabel({})).toBe("Active");
    });
  });

  describe("formatTextStatusLabel", () => {
    it("maps known statuses", () => {
      expect(formatTextStatusLabel("paused")).toBe("Paused");
      expect(formatTextStatusLabel("not_configured")).toBe("Not configured");
    });
  });

  describe("normalizeAdminCustomerNotesPatch", () => {
    it("accepts valid payload", () => {
      const r = normalizeAdminCustomerNotesPatch({
        tylerNotes: "  Called today ",
        sentQuotesBook: true,
        otherItemsSent: " shirt ",
      });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value.tylerNotes).toBe("Called today");
        expect(r.value.otherItemsSent).toBe("shirt");
      }
    });

    it("rejects invalid sentQuotesBook", () => {
      const r = normalizeAdminCustomerNotesPatch({
        tylerNotes: "",
        sentQuotesBook: "yes",
      });
      expect(r.ok).toBe(false);
    });
  });

  describe("resolveQuotesBookSentAtPatch", () => {
    const now = "2026-06-25T12:00:00.000Z";

    it("sets timestamp on false to true", () => {
      expect(
        resolveQuotesBookSentAtPatch({
          previousSent: false,
          nextSent: true,
          previousSentAt: null,
          nowIso: now,
        })
      ).toBe(now);
    });

    it("clears timestamp when unchecked", () => {
      expect(
        resolveQuotesBookSentAtPatch({
          previousSent: true,
          nextSent: false,
          previousSentAt: now,
          nowIso: now,
        })
      ).toBeNull();
    });

    it("preserves timestamp when already sent", () => {
      const prior = "2026-01-01T00:00:00.000Z";
      expect(
        resolveQuotesBookSentAtPatch({
          previousSent: true,
          nextSent: true,
          previousSentAt: prior,
          nowIso: now,
        })
      ).toBe(prior);
    });
  });
});
