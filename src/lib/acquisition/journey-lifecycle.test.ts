import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fulfillmentEligible } from "@/lib/acquisition/campaign-activation";
import {
  chooseOpenJourney,
  journeyCloses,
  journeyLocalStop,
  signalIsPersonGlobal,
} from "@/lib/acquisition/journey-lifecycle";
import { salesEmailMustStop } from "@/lib/acquisition/model";

const PROSPECT_ACTIONS = [
  "7e6e0c3c-3e2a-4bbf-b455-7fc10f7d58eb",
  "24903120-178a-400f-bd43-019cb9ecacad",
  "0b629c19-f8d4-4b30-941f-ac8018228e99",
] as const;

describe("independent acquisition journeys", () => {
  it("keeps a second campaign on its own open journey and reenters only after close", () => {
    expect(chooseOpenJourney(["journey-a"])).toEqual({ action: "reuse", journeyId: "journey-a" });
    expect(chooseOpenJourney([])).toEqual({ action: "create" });
    expect(chooseOpenJourney(["journey-old", "journey-new"])).toEqual({ action: "ambiguous" });
  });

  it("closes a decline only for that journey and keeps global stops person-wide", () => {
    expect(journeyLocalStop("not_interested", false)).toBe(true);
    expect(journeyLocalStop("asset_requested", false)).toBe(false);
    expect(journeyLocalStop("asset_requested", true)).toBe(true);
    expect(signalIsPersonGlobal("not_interested")).toBe(false);
    expect(signalIsPersonGlobal("unsubscribed")).toBe(true);
    expect(signalIsPersonGlobal("complained")).toBe(true);
    expect(signalIsPersonGlobal("bounced")).toBe(true);
    expect(signalIsPersonGlobal("trial_started")).toBe(true);
    expect(signalIsPersonGlobal("paid_member")).toBe(true);
    expect(signalIsPersonGlobal("trial_expired")).toBe(true);
    expect(salesEmailMustStop("not_interested")).toBe(false);
    expect(salesEmailMustStop("unsubscribed")).toBe(true);
    expect(salesEmailMustStop("suppressed")).toBe(true);
  });

  it("closes after an accepted PDF only when no required follow-up remains", () => {
    expect(journeyCloses({
      reason: "fulfillment",
      followUp: "pinned",
      justAccepted: "send_asset",
      outstanding: [],
    })).toBe(true);
    expect(journeyCloses({
      reason: "fulfillment",
      followUp: "pinned",
      justAccepted: "send_asset",
      outstanding: ["send_video"],
    })).toBe(false);
    expect(journeyCloses({
      reason: "fulfillment",
      followUp: "pinned",
      justAccepted: "send_video",
      outstanding: [],
    })).toBe(true);
    expect(journeyCloses({
      reason: "fulfillment",
      followUp: "legacy",
      justAccepted: "send_asset",
      outstanding: [],
    })).toBe(false);
    expect(journeyCloses({
      reason: "fulfillment",
      followUp: "legacy",
      justAccepted: "send_video",
      outstanding: [],
    })).toBe(false);
    expect(journeyCloses({
      reason: "fulfillment",
      followUp: "legacy",
      justAccepted: "send_trial_followup",
      outstanding: [],
    })).toBe(true);
    expect(journeyCloses({
      reason: "fulfillment",
      followUp: "unknown",
      justAccepted: "send_asset",
      outstanding: [],
    })).toBe(false);
    expect(journeyCloses({
      reason: "not_interested",
      followUp: "pinned",
      justAccepted: null,
      outstanding: ["send_video"],
    })).toBe(true);
  });

  it("keeps pause, activation, legacy actions, and accepted history unchanged", () => {
    const migration = readFileSync("supabase/migrations/20261027120000_acquisition_journey_lifecycle.sql", "utf8");
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const activation = readFileSync("src/lib/acquisition/campaign-activation.server.ts", "utf8");
    const activationTests = readFileSync("src/lib/acquisition/campaign-activation.test.ts", "utf8");
    expect(activation).not.toContain("closed_at");
    expect(migration).toContain("acquisition_actions_person_id_action_type_key still present");
    expect(migration).toContain("acquisition_actions_legacy_person_type_uq missing");
    expect(migration).toContain("acquisition_actions_journey_type_uq missing");
    expect(migration).toContain("acquisition_journey_backfill_ambiguous");
    expect(migration).toContain("acquisition_open_journey_conflict");
    expect(migration).toContain("acquisition_journeys_open_person_campaign_uq");
    expect(migration).toContain("AND closed_at IS NULL");
    expect(migration).toContain("v_ownership := 'ambiguous'");
    expect(migration).toContain("'journey_created', v_created");
    expect(migration).toContain("GRANT UPDATE (lifecycle_state, closed_at) ON TABLE public.acquisition_journeys TO service_role");
    expect(migration).not.toContain("GRANT UPDATE ON TABLE public.acquisition_journeys TO service_role");
    expect(migration).toContain("indexdef ILIKE '%journey_id IS NULL%'");
    expect(migration).toContain("indexdef ILIKE '%journey_id IS NOT NULL%'");
    expect(migration).not.toMatch(/UPDATE\s+public\.acquisition_actions/);
    expect(migration).not.toMatch(/SET\s+closed_at/);
    expect(migration).not.toContain("DROP CONSTRAINT");
    expect(store).toContain("cancelJourneyPending");
    expect(store).toContain("cancelLegacyPending");
    expect(store).toContain('event.signal === "not_interested"');
    expect(store).toContain("ownership === \"ambiguous\"");
    expect(store).toContain("stored.created && stored.journeyId");
    expect(store).toContain("`acquisition:${personId}:${journeyId}:${action}`");
    expect(store).toContain("salesEmailMustStop(updated.lifecycle_state)");
    const unsubscribe = store.slice(store.indexOf("export async function unsubscribeAcquisition"));
    expect(unsubscribe).toContain("cancelPending(person.id)");
    for (const id of PROSPECT_ACTIONS) expect(activationTests).toContain(id);
    expect(fulfillmentEligible({
      activations: [{ id: "856a5ef5-88c6-44c6-b001-a5b020d641f7", activatedAt: "2026-10-27T12:00:00.000Z" }],
      campaignId: "364dad9d-cbb5-4d33-b4d5-0ac083f0ebe5",
      scheduledAt: "2026-10-26T15:29:51.726Z",
    })).toBe(false);
    expect(fulfillmentEligible({
      activations: [{ id: "856a5ef5-88c6-44c6-b001-a5b020d641f7", activatedAt: null }],
      campaignId: "856a5ef5-88c6-44c6-b001-a5b020d641f7",
      scheduledAt: "2026-10-27T18:00:00.000Z",
    })).toBe(false);
  });
});
