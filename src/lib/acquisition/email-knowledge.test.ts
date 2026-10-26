import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  LEADERSHIP_KIT_STATEMENT,
  LEADERSHIP_KIT_TOPIC,
  prepareInterpreterKnowledge,
  reviewReusableKnowledge,
  type EmailKnowledgeRecord,
} from "@/lib/acquisition/email-knowledge";

const CAMPAIGN = "856a5ef5-88c6-44c6-b001-a5b020d641f7";

function row(patch: Partial<EmailKnowledgeRecord> & Pick<EmailKnowledgeRecord, "id" | "topic" | "statement">): EmailKnowledgeRecord {
  return {
    category: "product",
    scope: "general",
    campaignId: null,
    offerKey: null,
    status: "active",
    approvedAt: "2026-10-26T00:00:00.000Z",
    supersedesId: null,
    ...patch,
  };
}

describe("approved email knowledge", () => {
  it("uses active applicable facts and withholds another campaign, a retired fact, and a conflict", () => {
    const kit = row({
      id: "kit",
      topic: LEADERSHIP_KIT_TOPIC,
      category: "offer",
      scope: "campaign",
      campaignId: CAMPAIGN,
      statement: LEADERSHIP_KIT_STATEMENT,
      approvedAt: "2026-10-26T12:00:00.000Z",
    });
    const prepared = prepareInterpreterKnowledge([
      kit,
      row({ id: "old", topic: "trial_length", statement: "The trial is 14 days.", status: "retired", approvedAt: "2026-10-26T13:00:00.000Z" }),
      row({ id: "trial", topic: "trial_length", statement: "The trial is seven days.", approvedAt: "2026-10-26T11:00:00.000Z" }),
      row({ id: "a", topic: "refund_policy", statement: "Refunds are reviewed.", approvedAt: "2026-10-26T10:00:00.000Z" }),
      row({ id: "b", topic: "refund_policy", statement: "Refunds are automatic.", approvedAt: "2026-10-26T09:00:00.000Z" }),
    ], { campaignId: CAMPAIGN, offerKey: null });
    expect(prepared.statements.map((item) => item.id)).toEqual(["kit", "trial"]);
    expect(prepared.allowLeadershipKit).toBe(true);
    expect(prepared.conflicts).toEqual(["refund_policy"]);
    const otherCampaign = prepareInterpreterKnowledge([kit], { campaignId: "other-campaign", offerKey: null });
    expect(otherCampaign.statements).toEqual([]);
    expect(otherCampaign.allowLeadershipKit).toBe(false);
    expect(prepared.incomplete).toBe(false);
    const crowded = prepareInterpreterKnowledge(
      Array.from({ length: 13 }, (_, index) => row({
        id: `fact-${index}`,
        topic: `fact_${index}`,
        statement: `Approved fact ${index}.`,
        approvedAt: `2026-10-26T00:${String(index).padStart(2, "0")}:00.000Z`,
      })),
      { campaignId: null, offerKey: null },
    );
    expect(crowded.incomplete).toBe(true);
    expect(crowded.statements).toEqual([]);
    expect(LEADERSHIP_KIT_STATEMENT.toLowerCase()).not.toContain("free shipping");
    expect(LEADERSHIP_KIT_STATEMENT.toLowerCase()).not.toContain("delivery date");
  });

  it("does not let a one-off refund or a general Kit claim become reusable policy", () => {
    expect(reviewReusableKnowledge({
      topic: "refund_policy",
      statement: "We will refund the first charge.",
      category: "membership",
      scope: "general",
      campaignId: null,
      offerKey: null,
      explicitApproval: true,
    }).ok).toBe(false);
    expect(reviewReusableKnowledge({
      topic: LEADERSHIP_KIT_TOPIC,
      statement: LEADERSHIP_KIT_STATEMENT,
      category: "offer",
      scope: "general",
      campaignId: null,
      offerKey: null,
      explicitApproval: true,
    }).ok).toBe(false);
    const approved = reviewReusableKnowledge({
      topic: LEADERSHIP_KIT_TOPIC,
      statement: LEADERSHIP_KIT_STATEMENT,
      category: "offer",
      scope: "campaign",
      campaignId: CAMPAIGN,
      offerKey: null,
      explicitApproval: false,
    });
    expect(approved.ok).toBe(false);
    const saved = reviewReusableKnowledge({
      topic: LEADERSHIP_KIT_TOPIC,
      statement: LEADERSHIP_KIT_STATEMENT,
      category: "offer",
      scope: "campaign",
      campaignId: CAMPAIGN,
      offerKey: null,
      explicitApproval: true,
    });
    expect(saved.ok).toBe(true);
    const renamedKit = reviewReusableKnowledge({
      topic: "team_gift",
      statement: "The Leadership Kit includes wristbands and was $400.",
      category: "product",
      scope: "general",
      campaignId: null,
      offerKey: null,
      explicitApproval: true,
    });
    expect(renamedKit.ok).toBe(false);
    const campaignRefund = reviewReusableKnowledge({
      topic: "refund_review",
      statement: "If you've already been charged and would like to request a refund, reply here.",
      category: "approved_answer",
      scope: "campaign",
      campaignId: CAMPAIGN,
      offerKey: null,
      explicitApproval: true,
    });
    expect(campaignRefund.ok).toBe(false);
    expect(reviewReusableKnowledge({
      topic: "special_rate",
      statement: "Coaches can take 20 percent off.",
      category: "membership",
      scope: "general",
      campaignId: null,
      offerKey: null,
      explicitApproval: true,
    }).ok).toBe(false);
  });

  it("keeps approval behind Tyler's session and does not seed the Kit into the migration", () => {
    const migration = readFileSync("supabase/migrations/20261026140000_acquisition_email_knowledge.sql", "utf8");
    const page = readFileSync("src/app/admin/distribution/email-knowledge/page.tsx", "utf8");
    const route = readFileSync("src/app/api/admin/acquisition/email-knowledge/route.ts", "utf8");
    const promote = readFileSync("src/app/api/admin/acquisition/email-answers/[id]/knowledge/route.ts", "utf8");
    const server = readFileSync("src/lib/acquisition/email-knowledge.server.ts", "utf8");
    const assets = readFileSync("src/lib/acquisition/assets.ts", "utf8");
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(migration).toContain("CREATE TABLE public.acquisition_email_knowledge");
    expect(migration).toContain("knowledge_unreadable");
    expect(migration).toContain("acquisition_email_answers_knowledge_fk");
    expect(migration).not.toContain(LEADERSHIP_KIT_TOPIC);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/);
    expect(migration).not.toMatch(/\bINSERT\s+INTO\b/);
    expect(page.indexOf("isTylerOwnerSession")).toBeLessThan(page.indexOf("EmailKnowledgeDashboard"));
    const listHandler = route.slice(route.indexOf("export async function GET"));
    const promoteHandler = promote.slice(promote.indexOf("export async function POST"));
    expect(listHandler.indexOf("isTylerOwnerSession")).toBeLessThan(listHandler.indexOf("listEmailKnowledge"));
    expect(promoteHandler.indexOf("isTylerOwnerSession")).toBeLessThan(promoteHandler.indexOf("approveReusableKnowledge"));
    expect(server).toContain("knowledge_entry_id");
    expect(server).toContain('data.status !== "sent"');
    expect(server).not.toContain("postInstantlyThreadReply");
    expect(server).not.toContain("acquisition_settings");
    expect(server).toContain('source_request_id: null');
    expect(server).toContain('status: "retired"');
    expect(server).toContain("An edited version is already active");
    expect(server).not.toContain("sms_inbound");
    expect(server).not.toContain("stripe");
    const store = readFileSync("src/lib/acquisition/store.ts", "utf8");
    const failure = store.slice(store.indexOf("if (!loadedKnowledge.ok)"), store.indexOf("const approvedKnowledge"));
    expect(failure).toContain("knowledge_unreadable");
    expect(failure).not.toContain("needs_human");
    expect(assets).not.toContain("leadership_kit");
    expect(middleware).not.toContain("email-knowledge");
  });
});
