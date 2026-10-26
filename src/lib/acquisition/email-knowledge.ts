/**
 * Approved facts the acquisition interpreter may reuse.
 * A personal reply stays on its thread until Tyler explicitly approves a statement.
 * The physical Leadership Kit is not a PDF campaign asset.
 */

export const EMAIL_KNOWLEDGE_CATEGORIES = [
  "membership",
  "offer",
  "pat_biography",
  "tyler_biography",
  "product",
  "approved_answer",
] as const;

export type EmailKnowledgeCategory = (typeof EMAIL_KNOWLEDGE_CATEGORIES)[number];

export const EMAIL_KNOWLEDGE_SCOPES = ["general", "campaign", "offer"] as const;

export type EmailKnowledgeScope = (typeof EMAIL_KNOWLEDGE_SCOPES)[number];

export const EMAIL_KNOWLEDGE_PROMPT_LIMIT = 12;
export const EMAIL_KNOWLEDGE_SCAN_LIMIT = 40;
export const LEADERSHIP_KIT_TOPIC = "leadership_kit";

const TOPIC = /^[a-z0-9][a-z0-9_-]{0,79}$/;
const OFFER_KEY = /^[a-z0-9_]{1,64}$/;
const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Tyler-supplied Kit facts. Shipping and eligibility rules are intentionally absent. */
export const LEADERSHIP_KIT_STATEMENT = [
  "The Pat Summitt Leadership Kit is a physical collection of coaching and leadership materials.",
  "It was previously sold for $400.",
  "It is now offered free when someone subscribes to Summitt Mindset, subject to this campaign's approved fulfillment and eligibility terms.",
  "It includes one Coach's Guide, 25 Student-Athlete Handbooks, wristbands, pens, stickers, a poster, and a copy of Quotes from the Summitt.",
  "It is meant to help coaches improve team culture and teach student-athletes Pat Summitt's Definite Dozen, including communication, respect, hard work, teamwork, accountability, responsibility, and character.",
  "Tyler says coaches in all sports and at all levels have loved it. That is Tyler's experience, not a counted satisfaction rate.",
  "The Kit is not a downloadable Definite Dozen PDF.",
  "Do not add an arrival date, a delivery cost, a country, a quantity limit, whether it goes out during the trial, whether monthly and annual members qualify equally, or whether the member keeps it after cancellation.",
].join(" ");

const REUSABLE_PROMISE = /\brefunds?\b|\bmoney[\s-]?back\b|\bbilling credit\b|\bfree shipping\b|\bshipping\b|\bshipment\b|\bships\b|\bdelivery date\b|\bdiscount\b|\bcoupon\b|\b% off\b|\bpercent off\b/i;
export const LEADERSHIP_KIT_CLAIM = /\bleadership kit\b|\$400\b|\bwristbands?\b|\bstudent-athlete handbooks?\b|\bquotes from the summitt\b/i;
const APPROVED_MEMBERSHIP_AMOUNTS = new Set(["$0", "$29", "$249"]);

export type EmailKnowledgeRecord = {
  id: string;
  topic: string;
  statement: string;
  category: string;
  scope: string;
  campaignId: string | null;
  offerKey: string | null;
  status: string;
  approvedAt: string;
  supersedesId: string | null;
};

export type InterpreterKnowledge = {
  statements: Array<{ id: string; topic: string; category: string; statement: string }>;
  conflicts: string[];
  allowLeadershipKit: boolean;
  /** True when a cap would have dropped a fact or hidden whether every fact was read. */
  incomplete: boolean;
};

export function knowledgeApplies(
  row: Pick<EmailKnowledgeRecord, "status" | "scope" | "campaignId" | "offerKey">,
  args: { campaignId: string | null; offerKey: string | null },
): boolean {
  if (row.status !== "active") return false;
  if (row.scope === "general") return true;
  if (row.scope === "campaign") return Boolean(args.campaignId) && row.campaignId === args.campaignId;
  if (row.scope === "offer") return Boolean(args.offerKey) && row.offerKey === args.offerKey;
  return false;
}

function membershipAmountConflict(row: Pick<EmailKnowledgeRecord, "category" | "statement">): boolean {
  if (row.category !== "membership") return false;
  const amounts = row.statement.match(/\$\d+(?:\.\d+)?/g) ?? [];
  return amounts.some((amount) => !APPROVED_MEMBERSHIP_AMOUNTS.has(amount));
}

/** Active, applicable, non-conflicting facts. Conflicting topics are named and omitted. */
export function prepareInterpreterKnowledge(
  rows: readonly EmailKnowledgeRecord[],
  args: { campaignId: string | null; offerKey: string | null },
): InterpreterKnowledge {
  const applicable = rows.filter((row) => knowledgeApplies(row, args));
  const byTopic = new Map<string, EmailKnowledgeRecord[]>();
  for (const row of applicable) {
    const group = byTopic.get(row.topic) ?? [];
    group.push(row);
    byTopic.set(row.topic, group);
  }
  const conflicts: string[] = [];
  const usable: EmailKnowledgeRecord[] = [];
  for (const [topic, group] of byTopic) {
    const wordings = new Set(group.map((row) => row.statement.trim()));
    const unsafe = group.some((row) => REUSABLE_PROMISE.test(row.statement) || membershipAmountConflict(row));
    if (wordings.size > 1 || unsafe) {
      conflicts.push(topic);
      continue;
    }
    const newest = [...group].sort((left, right) => right.approvedAt.localeCompare(left.approvedAt))[0];
    if (newest) usable.push(newest);
  }
  usable.sort((left, right) => right.approvedAt.localeCompare(left.approvedAt));
  if (usable.length > EMAIL_KNOWLEDGE_PROMPT_LIMIT) {
    return { statements: [], conflicts, allowLeadershipKit: false, incomplete: true };
  }
  const statements = usable.map((row) => ({
    id: row.id,
    topic: row.topic,
    category: row.category,
    statement: row.statement,
  }));
  return {
    statements,
    conflicts,
    allowLeadershipKit: statements.some((row) => row.topic === LEADERSHIP_KIT_TOPIC),
    incomplete: false,
  };
}

export type KnowledgeDraft = {
  topic: string;
  statement: string;
  category: EmailKnowledgeCategory;
  scope: EmailKnowledgeScope;
  campaignId: string | null;
  offerKey: string | null;
  explicitApproval: boolean;
};

export function reviewReusableKnowledge(draft: KnowledgeDraft): { ok: true; draft: KnowledgeDraft } | { ok: false; error: string } {
  const topic = draft.topic.trim().toLowerCase();
  const statement = draft.statement.replace(/\u0000/g, "").trim();
  if (!draft.explicitApproval) return { ok: false, error: "Tyler has to approve this before it can be reused." };
  if (!TOPIC.test(topic)) return { ok: false, error: "Use a short topic id, such as trial_length." };
  if (!statement || statement.length > 2000) return { ok: false, error: "The statement must be 1 to 2000 characters." };
  if (/https?:\/\//i.test(statement) || /\bwww\./i.test(statement)) return { ok: false, error: "A reusable fact cannot contain a web address." };
  if (!EMAIL_KNOWLEDGE_CATEGORIES.includes(draft.category)) return { ok: false, error: "Choose a knowledge category." };
  if (REUSABLE_PROMISE.test(statement)) {
    return { ok: false, error: "A refund, credit, discount, or shipping promise cannot become reusable knowledge." };
  }
  if (draft.category === "membership" && membershipAmountConflict({ category: draft.category, statement })) {
    return { ok: false, error: "Membership knowledge can use only the approved $0, $29, and $249 prices." };
  }
  const campaignId = draft.campaignId?.trim() || null;
  const offerKey = draft.offerKey?.trim() || null;
  if (draft.scope === "general" && (topic === LEADERSHIP_KIT_TOPIC || LEADERSHIP_KIT_CLAIM.test(statement))) {
    return { ok: false, error: "The Leadership Kit can be approved only for one campaign or one offer." };
  }
  if (draft.scope === "general") {
    if (campaignId || offerKey) return { ok: false, error: "General knowledge cannot name a campaign or an offer." };
    return { ok: true, draft: { ...draft, topic, statement, campaignId: null, offerKey: null } };
  }
  if (draft.scope === "campaign") {
    if (!campaignId || !CAMPAIGN_ID.test(campaignId) || offerKey) {
      return { ok: false, error: "Campaign knowledge needs that campaign id and no offer key." };
    }
    return { ok: true, draft: { ...draft, topic, statement, campaignId, offerKey: null } };
  }
  if (draft.scope === "offer") {
    if (!offerKey || !OFFER_KEY.test(offerKey) || campaignId) {
      return { ok: false, error: "Offer knowledge needs that offer key and no campaign id." };
    }
    return { ok: true, draft: { ...draft, topic, statement, campaignId: null, offerKey } };
  }
  return { ok: false, error: "Choose who this fact applies to." };
}

export function repeatedKnowledgeTopics(rows: readonly { topic: string; status: string }[]): Array<{ topic: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "active") continue;
    counts.set(row.topic, (counts.get(row.topic) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((left, right) => right.count - left.count || left.topic.localeCompare(right.topic));
}
