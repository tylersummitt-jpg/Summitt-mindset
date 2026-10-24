import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  INSTANTLY_API_KEYS_URL,
  INSTANTLY_EMAIL_LIST_URL,
  readInstantlyReceivedEmailDiagnostic,
  sanitizeProviderError,
} from "@/lib/acquisition/instantly-email-read";

const ownerMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/require-tyler-admin", () => ({
  isTylerOwnerSession: () => ownerMock(),
}));

const SECRET = "live-key-must-not-appear";
const BODY = "Please send the playbook to the whole coaching staff this week.";
const SUBJECT = "Re: special situations for Friday";
const LEAD = "coach@school.edu";
const ACCOUNT = "outreach@summittmindset.com";
const EMAIL_ID = "01234567-89ab-cdef-0123-456789abcdef";
const THREAD_ID = "abcdefab-cdef-0123-4567-89abcdef0123";

function receivedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: EMAIL_ID,
    thread_id: THREAD_ID,
    subject: SUBJECT,
    eaccount: ACCOUNT,
    lead: LEAD,
    campaign_id: "camp-1111-2222-3333-444455556666",
    timestamp_email: "2026-10-24T14:00:00.000Z",
    ue_type: 2,
    from_address_email: "Pat Coach <coach@school.edu>",
    to_address_email_list: ACCOUNT,
    content_preview: BODY.slice(0, 20),
    body: { text: BODY, html: `<p>${BODY}</p>` },
    body_fallback_reason: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("Instantly email diagnostic redaction", () => {
  it("reports field types and hides the message, addresses, subject, ids, and key", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url) === INSTANTLY_API_KEYS_URL) {
        return jsonResponse({
          items: [{ key: SECRET, name: "Production", scopes: ["emails:read", "accounts:read"] }],
        });
      }
      return jsonResponse({ items: [receivedItem()] });
    });
    const report = await readInstantlyReceivedEmailDiagnostic({ apiKey: SECRET, fetchImpl });
    expect(report.emailRead).toBe("verified");
    expect(report.emailReadStatus).toBe(200);
    expect(report.replyPermission).toBe("denied");
    expect(report.exactReplyTarget).toBe(true);
    expect(report.fullTextAvailable).toBe(true);
    expect(report.bodyTextLength).toBe(BODY.length);
    expect(report.bodyHtmlPresent).toBe(true);
    expect(report.threadIdPresent).toBe(true);
    expect(report.receivedType).toBe(2);
    expect(report.fields.subject).toEqual({ present: true, type: "string", length: SUBJECT.length });
    expect(report.fields.lead).toEqual({ present: true, type: "string", length: LEAD.length });
    expect(report.fields.eaccount.type).toBe("string");
    expect(report.fields.body.type).toBe("object");
    const printed = JSON.stringify(report);
    for (const privateValue of [SECRET, BODY, SUBJECT, LEAD, ACCOUNT, EMAIL_ID, THREAD_ID, "Pat Coach", "Production"]) {
      expect(printed).not.toContain(privateValue);
    }
    expect(fetchImpl.mock.calls.map((call) => call[1]?.method)).toEqual(["GET", "GET"]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(INSTANTLY_EMAIL_LIST_URL);
    expect(String(fetchImpl.mock.calls[0]?.[0])).not.toContain("/emails/reply");
  });

  it("does not treat a shortened or spaced id as a reply target", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({
      items: [receivedItem({ id: `${"a".repeat(81)}`, thread_id: "not a thread" })],
    }));
    const report = await readInstantlyReceivedEmailDiagnostic({ apiKey: SECRET, fetchImpl });
    expect(report.exactReplyTarget).toBe(false);
    expect(report.threadIdPresent).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reads the full email by id only when the list body is an excerpt", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).includes("/emails/reply")) throw new Error("reply post");
      if (String(url) === INSTANTLY_EMAIL_LIST_URL) {
        return jsonResponse({
          items: [receivedItem({
            body: { text: "excerpt" },
            body_fallback_reason: "too_large",
          })],
        });
      }
      if (String(url) === `https://api.instantly.ai/api/v2/emails/${EMAIL_ID}`) {
        return jsonResponse(receivedItem());
      }
      return jsonResponse({ items: [{ key: SECRET, scopes: ["emails:all"] }] });
    });
    const report = await readInstantlyReceivedEmailDiagnostic({ apiKey: SECRET, fetchImpl });
    expect(report.fullTextAvailable).toBe(true);
    expect(report.bodyTextLength).toBe(BODY.length);
    expect(report.bodyFallback).toBeNull();
    expect(report.replyPermission).toBe("verified");
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).includes("/emails/reply"))).toBe(false);
  });

  it("fails closed on a provider denial, a network error, and a missing key", async () => {
    const denied = vi.fn<typeof fetch>(async (url) => {
      if (String(url) === INSTANTLY_API_KEYS_URL) return jsonResponse({ message: "Missing scope" }, 403);
      return jsonResponse({ message: `Missing scope for ${LEAD}` }, 403);
    });
    const deniedReport = await readInstantlyReceivedEmailDiagnostic({ apiKey: SECRET, fetchImpl: denied });
    expect(deniedReport.emailRead).toBe("denied");
    expect(deniedReport.emailReadStatus).toBe(403);
    expect(deniedReport.replyPermission).toBe("unknown");
    expect(deniedReport.providerError).toBe("Missing scope for [redacted]");
    expect(JSON.stringify(deniedReport)).not.toContain(LEAD);

    const thrown = vi.fn<typeof fetch>(async () => {
      throw new Error(`socket ${SECRET}`);
    });
    const failed = await readInstantlyReceivedEmailDiagnostic({ apiKey: SECRET, fetchImpl: thrown });
    expect(failed.emailRead).toBe("unknown");
    expect(failed.providerError).toBe("timeout_or_network");
    expect(JSON.stringify(failed)).not.toContain(SECRET);
    expect(thrown).toHaveBeenCalledTimes(1);

    const absent = vi.fn<typeof fetch>();
    const missing = await readInstantlyReceivedEmailDiagnostic({ apiKey: "  ", fetchImpl: absent });
    expect(missing.providerError).toBe("missing_credentials");
    expect(absent).not.toHaveBeenCalled();
    expect(sanitizeProviderError("Bearer live-key-must-not-appear")).toBeNull();
  });
});

describe("Instantly email diagnostic route", () => {
  beforeEach(() => {
    ownerMock.mockReset();
    vi.unstubAllGlobals();
    delete process.env.INSTANTLY_API_KEY;
  });

  it("rejects a signed-out or non-owner session before calling Instantly", async () => {
    ownerMock.mockResolvedValue(false);
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);
    process.env.INSTANTLY_API_KEY = SECRET;
    const { GET } = await import("@/app/api/admin/acquisition/instantly-email-read/route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(fetchImpl).not.toHaveBeenCalled();
    const route = readFileSync("src/app/api/admin/acquisition/instantly-email-read/route.ts", "utf8");
    const handler = route.slice(route.indexOf("export async function GET"));
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(handler.indexOf("isTylerOwnerSession")).toBeLessThan(handler.indexOf("readInstantlyReceivedEmailDiagnostic"));
    expect(route).not.toContain("emails/reply");
    expect(middleware).not.toContain("instantly-email-read");
    expect(middleware).not.toContain("/api/admin/acquisition/instantly-email-read");
  });
});
