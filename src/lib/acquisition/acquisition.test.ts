import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ACQUISITION_ASSET_FILES,
  ACQUISITION_FILE_KEYS,
  knownAssetOrNull,
  readAcquisitionAsset,
  readAcquisitionAssetReport,
} from "@/lib/acquisition/assets";
import { planInstantlyBackfill } from "@/lib/acquisition/backfill";
import { buildAcquisitionDashboard } from "@/lib/acquisition/dashboard";
import { INSTANTLY_WEBHOOK_EVENTS, instantlyPersonMetadata, normalizeInstantlyWebhook } from "@/lib/acquisition/instantly";
import {
  backfillMayApply,
  evaluateWarmSend,
  newAcquisitionToken,
  normalizeAcquisitionEmail,
  parseAcquisitionAsset,
  reduceLiveSignal,
  settleAcceptedSend,
  settleFailedSend,
} from "@/lib/acquisition/model";
import { runAcquisitionPass, type PassAction, type PassPerson, type PassSendRequest } from "@/lib/acquisition/pass";

function person(overrides: Partial<PassPerson> = {}): PassPerson {
  return {
    id: "person-1",
    email: "coach@school.edu",
    firstName: "Pat",
    lifecycle: "asset_requested",
    requestedAsset: "definite_dozen",
    clerkUserId: null,
    ...overrides,
  };
}

function action(overrides: Partial<PassAction> = {}): PassAction {
  return {
    id: "action-1",
    personId: "person-1",
    actionType: "send_asset",
    attemptCount: 0,
    idempotencyKey: "acquisition:person-1:send_asset",
    ...overrides,
  };
}

function instantly(eventType: string, extra: Record<string, unknown> = {}) {
  return normalizeInstantlyWebhook({
    timestamp: "2026-10-21T16:00:00.000Z",
    event_type: eventType,
    workspace: "ws",
    campaign_id: "camp-1",
    campaign_name: "Tennessee",
    lead_email: "Coach@School.edu",
    email_account: "tyler@summittmindset.com",
    email_id: `${eventType}-1`,
    reply_text: "I am interested in the playbook and the trial",
    reply_text_snippet: "I am interested",
    ...extra,
  });
}

describe("acquisition person and state", () => {
  it("dedupes email by the same normalization checkout uses", () => {
    expect(normalizeAcquisitionEmail(" Coach@School.edu ")).toBe("coach@school.edu");
    expect(normalizeAcquisitionEmail("coach@school.edu")).toBe(normalizeAcquisitionEmail("COACH@school.edu"));
    expect(normalizeAcquisitionEmail("not-an-email")).toBeNull();
  });

  it("advances legal signals and rejects regressive ones", () => {
    expect(reduceLiveSignal("cold_active", "interested")).toEqual({ outcome: "advance", state: "asset_requested" });
    expect(reduceLiveSignal("asset_requested", "asset_accepted")).toEqual({ outcome: "advance", state: "asset_sent" });
    expect(reduceLiveSignal("asset_sent", "video_accepted")).toEqual({ outcome: "advance", state: "warm_video_sent" });
    expect(reduceLiveSignal("warm_video_sent", "trial_followup_accepted")).toEqual({ outcome: "advance", state: "trial_invited" });
    expect(reduceLiveSignal("trial_invited", "trial_started")).toEqual({ outcome: "advance", state: "trial_started" });
    expect(reduceLiveSignal("trial_started", "paid_member")).toEqual({ outcome: "advance", state: "paid_member" });
    expect(reduceLiveSignal("trial_started", "trial_expired")).toEqual({ outcome: "advance", state: "trial_expired" });
    expect(reduceLiveSignal("paid_member", "interested").outcome).toBe("rejected");
    expect(reduceLiveSignal("paid_member", "trial_started").outcome).toBe("rejected");
    expect(reduceLiveSignal("asset_sent", "interested").outcome).toBe("rejected");
    expect(reduceLiveSignal("trial_started", "video_accepted").outcome).toBe("rejected");
    expect(reduceLiveSignal("asset_requested", "observe")).toEqual({ outcome: "unchanged", state: "asset_requested" });
  });

  it("does not let a weaker historical row overwrite a warmer person", () => {
    expect(backfillMayApply("paid_member", "cold_active")).toBe("skip_stronger");
    expect(backfillMayApply("asset_sent", "asset_requested")).toBe("skip_stronger");
    expect(backfillMayApply("cold_active", "asset_requested")).toBe("apply");
    expect(backfillMayApply("cold_no_response", "cold_active")).toBe("skip_stronger");
    expect(backfillMayApply(null, "cold_active")).toBe("create");
  });

  it("keeps automation off in the migration and does not turn it on in code", () => {
    const migration = readFileSync("supabase/migrations/20261021200000_acquisition_funnel.sql", "utf8");
    expect(migration).toContain("DEFAULT 'off'");
    expect(migration).toContain("VALUES ('default', 'off')");
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    expect(store).not.toMatch(/automation_status:\s*["']active["']/);
    expect(store).not.toMatch(/automation_status:\s*["']pilot["']/);
    expect(store).toContain('update({ status: "uncertain", claim_until: null');
    expect(store).toContain('video?.status !== "ready"');
    expect(readFileSync("src/app/admin/subscriber-growth/page.tsx", "utf8")).not.toContain("acquisition");
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(middleware).toContain('"/api/acquisition/instantly"');
    expect(middleware).toContain('"/api/acquisition/resend"');
    expect(middleware).toContain('"/api/acquisition/unsubscribe"');
    expect(middleware).not.toContain('"/api/admin/acquisition');
    expect(readFileSync("src/lib/acquisition/store.ts", "utf8")).not.toMatch(/kit\.com|convertkit|CONVERTKIT/i);
    const apply = store.slice(
      store.indexOf("export async function applyInstantlyBackfill"),
      store.indexOf("export async function refreshInstantlySenderSignals"),
    );
    expect(apply).not.toContain("scheduleAction");
    expect(apply).toContain("schedules_warm_email: false");
  });
});

describe("acquisition instantly events", () => {
  it("normalizes every documented webhook without keyword interest", () => {
    for (const eventType of INSTANTLY_WEBHOOK_EVENTS) {
      const normalized = instantly(eventType);
      expect(normalized.kind === "ignore").toBe(false);
    }
    const reply = instantly("reply_received");
    expect(reply.kind).toBe("person");
    if (reply.kind === "person") {
      expect(reply.signal).toBe("reply_received");
      expect(reply.email).toBe("Coach@School.edu");
      expect(reply.preview).toBe("I am interested");
      expect(JSON.stringify(reply)).not.toContain("playbook and the trial");
    }
    const interested = instantly("lead_interested");
    expect(interested.kind).toBe("person");
    if (interested.kind === "person") expect(interested.signal).toBe("interested");
    const bounced = instantly("email_bounced");
    if (bounced.kind === "person") expect(bounced.signal).toBe("bounced");
    const unsubscribed = instantly("lead_unsubscribed");
    if (unsubscribed.kind === "person") expect(unsubscribed.signal).toBe("unsubscribed");
    const completed = instantly("campaign_completed");
    if (completed.kind === "person") expect(completed.signal).toBe("campaign_completed");
    expect(normalizeInstantlyWebhook({ event_type: "made_up_event", lead_email: "a@b.co", timestamp: "2026-10-21T16:00:00.000Z" })).toMatchObject({
      kind: "person",
      signal: "observe",
      eventType: "unrecognized",
      rawEventType: "made_up_event",
    });
    expect(instantly("reply_received").kind).toBe("person");
    const again = instantly("reply_received");
    const first = instantly("reply_received");
    if (again.kind === "person" && first.kind === "person") {
      expect(again.providerEventId).toBe(first.providerEventId);
    }
  });

  it("keeps an unknown Instantly event informational and records its raw name", () => {
    const unknown = normalizeInstantlyWebhook({
      event_type: "  custom_workspace_label  ",
      lead_email: "coach@school.edu",
      timestamp: "2026-10-21T16:00:00.000Z",
      campaign_id: "camp-1",
    });
    expect(unknown.kind).toBe("person");
    if (unknown.kind !== "person") return;
    expect(unknown.eventType).toBe("unrecognized");
    expect(unknown.signal).toBe("observe");
    expect(instantlyPersonMetadata(unknown)).toEqual({ instantly_event_type: "custom_workspace_label" });
    expect(reduceLiveSignal("cold_active", unknown.signal)).toEqual({ outcome: "unchanged", state: "cold_active" });
    expect(reduceLiveSignal("asset_requested", unknown.signal)).toEqual({ outcome: "unchanged", state: "asset_requested" });

    const known = instantly("lead_interested");
    expect(known.kind).toBe("person");
    if (known.kind !== "person") return;
    expect(known.eventType).toBe("lead_interested");
    expect(known.signal).toBe("interested");
    expect(instantlyPersonMetadata(known).instantly_event_type).toBeUndefined();
    expect(reduceLiveSignal("cold_active", known.signal)).toEqual({ outcome: "advance", state: "asset_requested" });
    expect(reduceLiveSignal("reply_needs_review", known.signal)).toEqual({ outcome: "advance", state: "asset_requested" });
  });

  it("ignores a duplicate provider event id without a second advance", () => {
    const seen = new Set<string>();
    let state: "cold_active" | "asset_requested" = "cold_active";
    let advances = 0;
    for (let i = 0; i < 2; i += 1) {
      const event = instantly("lead_interested");
      if (event.kind !== "person") throw new Error("expected person");
      if (seen.has(event.providerEventId)) continue;
      seen.add(event.providerEventId);
      const reduced = reduceLiveSignal(state, event.signal);
      if (reduced.outcome === "advance") {
        state = "asset_requested";
        advances += 1;
      }
    }
    expect(advances).toBe(1);
    expect(state).toBe("asset_requested");
  });
});

describe("acquisition warm sends", () => {
  async function pass(overrides: {
    automation?: "off" | "pilot" | "active";
    people?: PassPerson[];
    claimed?: Set<string>;
    suppressed?: boolean | null;
    subscribed?: boolean | null;
    bytes?: Buffer | null;
    video?: string | null;
    outcome?: "accepted" | "temporary_failure" | "permanent_failure" | "unknown";
    due?: PassAction[];
  }) {
    const sends: PassSendRequest[] = [];
    const effects: string[] = [];
    const claimed = overrides.claimed ?? new Set<string>();
    const rows = new Map((overrides.people ?? [person()]).map((row) => [row.id, row]));
    const result = await runAcquisitionPass({
      now: new Date("2026-10-21T16:00:00.000Z"),
      automation: overrides.automation ?? "pilot",
      dailyCap: 25,
      acceptedToday: 0,
      due: overrides.due ?? [action()],
      claim: async (row) => {
        if (claimed.has(row.id)) return false;
        claimed.add(row.id);
        return true;
      },
      person: async (id) => rows.get(id) ?? null,
      suppression: async () => overrides.suppressed ?? false,
      clerkSubscribed: async () => overrides.subscribed ?? false,
      assetBytes: async () => (overrides.bytes === undefined ? Buffer.from("%PDF-1.4") : overrides.bytes),
      videoToken: async () => (overrides.video === undefined ? "video-token" : overrides.video),
      unsubscribeToken: () => "unsubscribe-token-unsubscribe-token",
      send: async (request) => {
        sends.push(request);
        return { outcome: overrides.outcome ?? "accepted", providerMessageId: "msg-1" };
      },
      apply: async (effect) => {
        effects.push(effect.kind === "accept" ? `accept:${effect.settle.status}:${effect.settle.schedule ?? "none"}` : `${effect.kind}:${"status" in effect ? effect.status : ""}`);
      },
    });
    return { result, sends, effects, claimed };
  }

  it("does not send while automation is off", async () => {
    const ran = await pass({ automation: "off" });
    expect(ran.sends).toHaveLength(0);
    expect(ran.result.skipped).toBe("automation_off");
  });

  it("claims an action once", async () => {
    const claimed = new Set<string>();
    const first = await pass({ claimed });
    const second = await pass({ claimed });
    expect(first.sends).toHaveLength(1);
    expect(second.sends).toHaveLength(0);
  });

  it("blocks unsubscribe, complaint, and bounce before send", async () => {
    for (const suppressed of [true]) {
      const ran = await pass({ suppressed });
      expect(ran.sends).toHaveLength(0);
      expect(ran.effects[0]).toContain("suppressed");
    }
    expect(evaluateWarmSend({
      automation: "active",
      state: "asset_requested",
      action: "send_asset",
      suppressed: true,
      clerkSubscribed: false,
      acceptedToday: 0,
      dailyCap: 25,
    })).toBe("suppressed");
  });

  it("cancels a pending sales action when the person is already trialing", async () => {
    const ran = await pass({ people: [person({ lifecycle: "trial_started" })] });
    expect(ran.sends).toHaveLength(0);
    expect(ran.effects.join(" ")).toContain("canceled");
    const subscribed = await pass({ subscribed: true });
    expect(subscribed.sends).toHaveLength(0);
  });

  it("advances only when the asset send is accepted and schedules the video after that", async () => {
    const accepted = await pass({});
    expect(accepted.sends[0]?.assetBytes?.subarray(0, 4).toString()).toBe("%PDF");
    expect(accepted.effects[0]).toBe("accept:accepted:send_video");
    expect(settleAcceptedSend("send_asset", "asset_requested").schedule).toBe("send_video");
    const failed = await pass({ outcome: "permanent_failure" });
    expect(failed.effects[0]).toContain("failed");
    expect(settleAcceptedSend("send_asset", "cold_active").status).toBe("canceled");
    const missing = await pass({ bytes: null });
    expect(missing.sends).toHaveLength(0);
    expect(missing.effects[0]).toContain("blocked");
  });

  it("retries a temporary failure once and then stops", () => {
    expect(settleFailedSend({ state: "asset_requested", attemptCount: 0, kind: "temporary" }).status).toBe("scheduled");
    expect(settleFailedSend({ state: "asset_requested", attemptCount: 1, kind: "temporary" }).status).toBe("failed");
    expect(settleFailedSend({ state: "asset_requested", attemptCount: 0, kind: "uncertain" }).status).toBe("uncertain");
  });

  it("schedules the video only from asset_sent", async () => {
    const ran = await pass({
      people: [person({ lifecycle: "asset_sent", requestedAsset: "playbook" })],
      due: [action({ actionType: "send_video" })],
      video: "recipient-token-recipient-token-1234",
    });
    expect(ran.sends[0]?.videoToken).toBe("recipient-token-recipient-token-1234");
    expect(ran.effects[0]).toBe("accept:accepted:send_trial_followup");
    const early = await pass({
      people: [person({ lifecycle: "asset_requested" })],
      due: [action({ actionType: "send_video" })],
    });
    expect(early.sends).toHaveLength(0);
  });
});

describe("acquisition video, stripe, assets, and dashboard", () => {
  it("gives each person a unique token and does not put email in it", () => {
    const first = newAcquisitionToken();
    const second = newAcquisitionToken();
    expect(first).not.toBe(second);
    expect(first).not.toContain("@");
    expect(first.length).toBeGreaterThanOrEqual(32);
    const migration = readFileSync("supabase/migrations/20261021200000_acquisition_funnel.sql", "utf8");
    expect(migration).toContain("UNIQUE (person_id, personal_video_id)");
    expect(migration).not.toContain("vimeo_video_id TEXT NOT NULL UNIQUE");
    const page = readFileSync("src/app/for/[token]/page.tsx", "utf8");
    const body = page.slice(page.indexOf("export default"));
    expect(body.indexOf("getPersonalVideoByToken")).toBeLessThan(body.indexOf("resolveAcquisitionRecipient"));
    expect(page).toContain('"/checkout/start"');
  });

  it("does not treat a CTA click as a trial", () => {
    expect(reduceLiveSignal("warm_video_sent", "observe")).toEqual({ outcome: "unchanged", state: "warm_video_sent" });
    const engagement = readFileSync("src/components/personal-video-engagement.tsx", "utf8");
    expect(engagement).toContain("personal_video_cta_clicked");
    expect(engagement).not.toContain("noteAcquisitionTrial");
  });

  it("links trial and paid only through explicit signals", () => {
    expect(reduceLiveSignal("warm_video_sent", "trial_started").state).toBe("trial_started");
    expect(reduceLiveSignal("trial_started", "paid_member").state).toBe("paid_member");
    expect(reduceLiveSignal("warm_video_sent", "observe").state).toBe("warm_video_sent");
    const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
    expect(webhook).toContain("checkFirstPaidInvoiceForSubscription");
    expect(webhook).toContain("noteAcquisitionPaid");
    expect(webhook).not.toContain("summittSubscribed = true");
  });

  it("reads the three authoritative PDFs and leaves legacy requested_asset unchanged", async () => {
    for (const key of ACQUISITION_FILE_KEYS) {
      const bytes = await readAcquisitionAsset(key);
      expect(ACQUISITION_ASSET_FILES[key].relativePath).toMatch(/^data\/acquisition-assets\/pat-summitt-.*\.pdf$/);
      expect(bytes).not.toBeNull();
      expect(bytes!.subarray(0, 4).toString("utf8")).toBe("%PDF");
      expect(bytes!.length).toBeGreaterThan(5);
    }
    expect(ACQUISITION_ASSET_FILES.playbook.relativePath).toBe(
      "data/acquisition-assets/pat-summitt-basketball-special-situations-playbook.pdf"
    );
    expect(ACQUISITION_ASSET_FILES.definite_dozen.relativePath).toBe(
      "data/acquisition-assets/pat-summitt-definite-dozen-team-discussion-guide.pdf"
    );
    expect(ACQUISITION_ASSET_FILES.definite_dozen_ad.relativePath).toBe(
      "data/acquisition-assets/pat-summitt-definite-dozen-athletic-director-discussion-guide.pdf"
    );

    const report = await readAcquisitionAssetReport();
    for (const key of ACQUISITION_FILE_KEYS) {
      expect(report[key]).toMatchObject({ asset: key, readable: true, pdfHeaderValid: true });
      expect(report[key].byteLength).toBeGreaterThan(5);
    }

    expect(parseAcquisitionAsset("playbook")).toBe("playbook");
    expect(parseAcquisitionAsset("definite_dozen")).toBe("definite_dozen");
    expect(parseAcquisitionAsset("definite_dozen_ad")).toBeNull();
    expect(knownAssetOrNull("definite_dozen_ad")).toBeNull();
    const migration = readFileSync("supabase/migrations/20261021200000_acquisition_funnel.sql", "utf8");
    expect(migration).toContain("requested_asset IN ('definite_dozen', 'playbook')");
    expect(migration).not.toContain("definite_dozen_ad");

    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const cron = store.slice(store.indexOf("export async function runAcquisitionCron"));
    const offReport = cron.indexOf("readAcquisitionAssetReport");
    expect(offReport).toBeGreaterThan(-1);
    expect(offReport).toBeLessThan(cron.indexOf("acquisition_actions"));
    expect(offReport).toBeLessThan(cron.indexOf("new Resend"));
    expect(cron).toContain('skipped: "automation_off"');
    expect(cron).toContain("accepted: 0");
    expect(store).toContain("attachments: [{ filename: copy.filename, content: copy.content }]");
    expect(store).not.toContain("offer_key");
    expect(store).not.toContain("pilot_action_ids");
    expect(store).not.toContain("definite_dozen_ad");

    const config = readFileSync("next.config.ts", "utf8");
    expect(config).toContain('"/api/cron/acquisition"');
    for (const key of ACQUISITION_FILE_KEYS) {
      expect(config).toContain(`./${ACQUISITION_ASSET_FILES[key].relativePath}`);
    }
  });

  it("counts the funnel from canonical rows and keeps needs-tyler at zero when nothing is waiting", () => {
    const dashboard = buildAcquisitionDashboard({
      automation: "off",
      people: [
        { id: "1", firstName: "A", lastName: null, lifecycle: "cold_active", requestedAsset: null },
        { id: "2", firstName: "B", lastName: null, lifecycle: "paid_member", requestedAsset: null },
      ],
      actions: [],
      videoEvents: [
        { personId: "1", eventType: "personal_video_visited" },
        { personId: "1", eventType: "personal_video_cta_clicked" },
      ],
      senders: [{ senderEmail: "box@summittmindset.com", connectionStatus: "1", detail: null, observedAt: "2026-10-21T16:00:00.000Z" }],
    });
    expect(dashboard.counts?.cold_prospects).toBe(2);
    expect(dashboard.counts?.cold_active).toBe(1);
    expect(dashboard.counts?.paid_member).toBe(1);
    expect(dashboard.counts?.cta_clicked).toBe(1);
    expect(dashboard.counts?.trial_started).toBe(0);
    expect(dashboard.needsTyler).toEqual([]);
    expect(dashboard.automation).toBe("off");
  });

  it("plans an Instantly backfill without writing and keeps interested leads", () => {
    const plan = planInstantlyBackfill({
      leads: [
        { id: "lead-1", email: "Coach@School.edu", first_name: "Pat", status: 1, lt_interest_status: 1, campaign: "camp" },
        { id: "lead-1b", email: "coach@school.edu", status: 1, lt_interest_status: 1 },
        { id: "lead-2", email: "paid@school.edu", status: 1, lt_interest_status: null, timestamp_last_contact: "2026-02-01T00:00:00.000Z", email_reply_count: 0 },
        { id: "lead-3", email: "nope@school.edu", status: -1, lt_interest_status: 1 },
      ],
      currentByEmail: new Map([["paid@school.edu", "paid_member"]]),
    });
    expect(plan.interested).toBe(1);
    expect(plan.wouldCreate).toBe(2);
    expect(plan.wouldSkipStronger).toBe(1);
    expect(plan.proposals.map((row) => row.email).sort()).toEqual(["coach@school.edu", "nope@school.edu"]);
    expect(plan.proposals.find((row) => row.email === "coach@school.edu")?.lifecycle).toBe("asset_requested");
    expect(plan.proposals.find((row) => row.email === "nope@school.edu")?.lifecycle).toBe("suppressed");
    expect(plan.schedulesWarmEmail).toBe(false);
    expect(plan.proposals.find((row) => row.email === "coach@school.edu")?.historicalFulfillment).toBe("unknown");
    expect(plan.proposals.every((row) => row.schedulesWarmEmail === false)).toBe(true);
  });

  it("keeps the stronger Instantly row when one email appears twice", () => {
    const plan = planInstantlyBackfill({
      leads: [
        { id: "cold-first", email: "Mix@School.edu", status: 1, lt_interest_status: null },
        { id: "interested-second", email: "mix@school.edu", status: 1, lt_interest_status: 1 },
        { id: "interested-first", email: "bounce@school.edu", status: 1, lt_interest_status: 1 },
        { id: "bounce-second", email: "bounce@school.edu", status: -1, lt_interest_status: 1 },
      ],
      currentByEmail: new Map(),
    });
    expect(plan.proposals.find((row) => row.email === "mix@school.edu")?.lifecycle).toBe("asset_requested");
    expect(plan.proposals.find((row) => row.email === "bounce@school.edu")?.lifecycle).toBe("suppressed");
    expect(plan.interested).toBe(1);
  });
});
