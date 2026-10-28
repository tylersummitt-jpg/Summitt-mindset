import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  instantlyDeliveryStop,
  instantlyLeadListBody,
  instantlyRetryWaitMs,
  readInstantlyLead,
  videoUrlPatchBody,
  videoUrlUpdateVerified,
  writeAndVerifyVideoUrl,
} from "@/lib/acquisition/instantly-existing-leads";

const LEAD = "01a18031-5134-7065-8f98-cd6405bbc547";

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("existing Instantly lead updates", () => {
  it("reads names from the lead and the payload and notices when either name is missing", () => {
    const lead = readInstantlyLead({
      id: LEAD,
      email: "Coach@School.edu",
      first_name: "",
      last_name: "Summitt",
      campaign: "camp-1",
      status: 3,
      payload: { firstName: "Pat", companyName: "East High" },
    });
    expect(lead).toMatchObject({
      email: "coach@school.edu",
      firstName: "Pat",
      lastName: "Summitt",
      missingFirst: false,
      missingLast: false,
      videoUrl: null,
      status: 3,
    });
    const unnamed = readInstantlyLead({
      id: LEAD,
      email: "coach@school.edu",
      payload: { firstName: " ", last_name: "" },
    });
    expect(unnamed?.missingFirst).toBe(true);
    expect(unnamed?.missingLast).toBe(true);
    expect(instantlyDeliveryStop(3)).toBeNull();
    expect(instantlyDeliveryStop(-1)).toBe("bounced");
    expect(instantlyDeliveryStop(-2)).toBe("unsubscribed");
  });

  it("patches only video_url and refuses a reply that drops another personalization field", async () => {
    expect(videoUrlPatchBody("https://summittmindset.com/for/tok?aj=signed")).toEqual({
      custom_variables: { video_url: "https://summittmindset.com/for/tok?aj=signed" },
    });
    expect(instantlyLeadListBody("camp-1", LEAD)).toEqual({ campaign: "camp-1", limit: 100, starting_after: LEAD });
    const before = { firstName: "Pat", companyName: "East High" };
    expect(videoUrlUpdateVerified({
      before,
      after: { payload: { firstName: "Pat", companyName: "East High", video_url: "https://summittmindset.com/for/tok?aj=1" } },
      expectedUrl: "https://summittmindset.com/for/tok?aj=1",
    })).toEqual({ ok: true, replaced: false });
    expect(videoUrlUpdateVerified({
      before: { ...before, video_url: "https://old.example/v" },
      after: { payload: { firstName: "Pat", companyName: "East High", video_url: "https://summittmindset.com/for/tok?aj=1" } },
      expectedUrl: "https://summittmindset.com/for/tok?aj=1",
    })).toEqual({ ok: true, replaced: true });
    expect(videoUrlUpdateVerified({
      before,
      after: { payload: { video_url: "https://summittmindset.com/for/tok?aj=1" } },
      expectedUrl: "https://summittmindset.com/for/tok?aj=1",
    }).ok).toBe(false);

    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      if (calls.length === 1) return response(429, { message: "Rate limit exceeded" });
      return response(200, { payload: { video_url: "https://summittmindset.com/for/tok?aj=1" } });
    }) as typeof fetch;
    const written = await writeAndVerifyVideoUrl({
      leadId: LEAD,
      expectedUrl: "https://summittmindset.com/for/tok?aj=1",
      before: {},
      apiKey: "test-key",
      fetchImpl,
      sleep: async () => {},
    });
    expect(written).toEqual({ ok: true, replaced: false });
    expect(calls).toEqual([
      `https://api.instantly.ai/api/v2/leads/${LEAD}`,
      `https://api.instantly.ai/api/v2/leads/${LEAD}`,
    ]);
    expect(instantlyRetryWaitMs(0)).toBe(2000);
    expect(instantlyRetryWaitMs(4)).toBeNull();

    const stripped = (async () => response(200, { payload: { video_url: "https://summittmindset.com/for/tok?aj=1" } })) as typeof fetch;
    const halted = await writeAndVerifyVideoUrl({
      leadId: LEAD,
      expectedUrl: "https://summittmindset.com/for/tok?aj=1",
      before: { firstName: "Pat" },
      apiKey: "test-key",
      fetchImpl: stripped,
      sleep: async () => {},
    });
    expect(halted).toEqual({
      ok: false,
      reason: "An existing personalization field changed during the video_url update.",
      halt: true,
    });
  });

  it("stops the batch when Instantly refuses the key and does not activate, delete, or send", () => {
    const server = readFileSync(new URL("./instantly-existing-leads.server.ts", import.meta.url), "utf8");
    const route = readFileSync(new URL("../../app/api/admin/acquisition/video-first-existing-leads/route.ts", import.meta.url), "utf8");
    const panel = readFileSync(new URL("../../app/admin/distribution/campaign-playbooks/video-first-lead-panel.tsx", import.meta.url), "utf8");
    expect(server).toContain("INSTANTLY_LEAD_LIST_URL");
    expect(server).toContain("currentQuietVideoPlaybook");
    expect(server).not.toMatch(/activate|emails\/reply|automation_status|conversation_sending|method:\s*"DELETE"/);
    expect(route).toContain("isTylerOwnerSession");
    expect(route).toContain("maxDuration = 300");
    expect(panel).toContain("Prepare existing Instantly leads");
    expect(panel).toContain("/api/admin/acquisition/video-first-existing-leads");
  });
});
