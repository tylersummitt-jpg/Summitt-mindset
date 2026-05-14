/**
 * Phase 4.2A — Weekly outbound V3 relationship lane (module only; not wired to cron).
 * OpenAI authors visible weekly SMS from structured facts; fail-closed, no deterministic coaching fallback.
 */

import OpenAI from "openai";

import { matchesMalformedDidRawPhraseHappenToday } from "@/lib/north-star-coach-sms";
import { detectFinalVoiceBlockedReasons } from "@/lib/v3-sms-voice-ownership";
import { V3_BRAIN_VERSION } from "@/lib/v3-sms-brain";

/** Aligns with {@link detectFinalVoiceBlockedReasons} `too_long` guard for post-FVG compatibility. */
const WEEKLY_V3_LANE_MAX_CHARS = 320;

export type WeeklyV3RoutePurpose =
  | "weekly_proof_v2"
  | "weekly_legacy_reflection"
  | "weekly_legacy_fallback_summary";

export type WeeklyV3ReplySource = "v3_weekly_relationship_lane";

export type WeeklyV3CommitmentFacts = {
  active_commitment_id: string | null;
  behavior_statement: string | null;
  effective_ask: string | null;
  commitment_state: string | null;
  identity_anchor?: string | null;
};

export type WeeklyV3ThreadFacts = {
  latest_outbound_preview: string | null;
  latest_inbound_preview: string | null;
  recent_transcript_lines: string[];
  latest_open_question: string | null;
  do_not_repeat_hints: string[];
  coaching_memory_snippet: string | null;
};

export type WeeklyV3ProofFacts = {
  week_start: string;
  week_end: string;
  completed_count: number;
  missed_count: number;
  partial_count: number;
  blocker_count: number;
  proof_moment_hints: string[];
  win_hints: string[];
  comeback_hints: string[];
  repeated_blocker_hints: string[];
  notable_pattern: string | null;
  silent_week: boolean;
  rough_week: boolean;
  strong_week: boolean;
  /** Metadata-only previews; must not appear verbatim in final body. */
  old_weekly_proof_body_preview: string | null;
  deterministic_weekly_body_preview: string | null;
  legacy_reflection_preview: string | null;
  legacy_template_preview: string | null;
};

export type WeeklyV3OutboundFacts = {
  user: {
    clerk_user_id: string;
    preferred_name: string | null;
    timezone: string;
    local_date: string;
    local_time: string;
    sms_engagement_summary?: string | null;
  };
  commitment: WeeklyV3CommitmentFacts;
  thread: WeeklyV3ThreadFacts;
  weekly_proof: WeeklyV3ProofFacts;
  route: {
    route_purpose: WeeklyV3RoutePurpose;
    fully_on_v2: boolean;
    reason_for_send: "sunday_weekly_touchpoint";
    legacy_weekly_branch: boolean;
  };
};

export type WeeklyV3RelationshipLaneInput = {
  facts: WeeklyV3OutboundFacts;
  /** Labels for upstream fact modules (never treated as authored voice). */
  telemetry_fact_sources: string[];
};

export type WeeklyV3RelationshipLaneResult = {
  body: string;
  shouldSend: boolean;
  noSendReason: string | null;
  replySource: WeeklyV3ReplySource;
  routePurpose: WeeklyV3RoutePurpose;
  voiceConfidence: number | null;
  usedFacts: string[];
  safetyNotes: string[];
  metadata: Record<string, unknown>;
  openAiOk: boolean;
};

const PAT_PAUSE_TEMPLATE_MARKERS = [
  "time for a pat pause",
  "let's take a pat pause",
  "it's your weekly pat pause",
  "time for our sunday pat pause",
] as const;

const NEWSLETTERISH = [
  "weekly digest",
  "this week in review",
  "here's your report",
  "here is your report",
  "your weekly report",
] as const;

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

type LaneModelJson = {
  should_send?: unknown;
  body?: unknown;
  no_send_reason?: unknown;
  route_purpose?: unknown;
  voice_confidence?: unknown;
  used_facts?: unknown;
  safety_notes?: unknown;
};

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((x) => x.trim()).filter(Boolean);
}

function safeJsonParse(raw: string): LaneModelJson | null {
  try {
    return JSON.parse(raw) as LaneModelJson;
  } catch {
    return null;
  }
}

function summarizeWeeklyFacts(f: WeeklyV3OutboundFacts): string {
  const slim = {
    route_purpose: f.route.route_purpose,
    fully_on_v2: f.route.fully_on_v2,
    legacy_weekly_branch: f.route.legacy_weekly_branch,
    week: [f.weekly_proof.week_start, f.weekly_proof.week_end],
    counts: {
      completed: f.weekly_proof.completed_count,
      missed: f.weekly_proof.missed_count,
      partial: f.weekly_proof.partial_count,
      blockers: f.weekly_proof.blocker_count,
    },
    flags: {
      silent_week: f.weekly_proof.silent_week,
      rough_week: f.weekly_proof.rough_week,
      strong_week: f.weekly_proof.strong_week,
    },
    has_commitment: Boolean(f.commitment.active_commitment_id),
    preview_lengths: {
      old_proof: f.weekly_proof.old_weekly_proof_body_preview?.length ?? 0,
      deterministic: f.weekly_proof.deterministic_weekly_body_preview?.length ?? 0,
      legacy_reflection: f.weekly_proof.legacy_reflection_preview?.length ?? 0,
      legacy_template: f.weekly_proof.legacy_template_preview?.length ?? 0,
    },
  };
  const s = JSON.stringify(slim);
  return s.length > 1200 ? `${s.slice(0, 1199)}…` : s;
}

function weeklyLaneLocalValidation(body: string, facts: WeeklyV3OutboundFacts): string[] {
  const hits: string[] = [];
  const t = body.trim();
  const lower = t.toLowerCase();

  if (/\bV2\b/i.test(t)) hits.push("internal_v2_token");
  if (/\bevent_type\b/i.test(t)) hits.push("internal_event_type_token");
  if (/\bblocker_captured\b/i.test(t)) hits.push("internal_blocker_captured_token");
  if (/\buser_partial\b/i.test(t)) hits.push("internal_user_partial_token");

  for (const ph of NEWSLETTERISH) {
    if (lower.includes(ph)) hits.push(`newsletterish:${ph}`);
  }

  for (const m of PAT_PAUSE_TEMPLATE_MARKERS) {
    if (lower.includes(m)) hits.push("pat_pause_template_marker");
  }

  if (matchesMalformedDidRawPhraseHappenToday(t)) hits.push("daily_check_malformed_phrase");

  const previews: Array<[string, string | null]> = [
    ["old_proof_preview", facts.weekly_proof.old_weekly_proof_body_preview],
    ["deterministic_preview", facts.weekly_proof.deterministic_weekly_body_preview],
    ["legacy_reflection_preview", facts.weekly_proof.legacy_reflection_preview],
    ["legacy_template_preview", facts.weekly_proof.legacy_template_preview],
  ];
  for (const [label, pv] of previews) {
    const p = typeof pv === "string" ? pv.trim() : "";
    if (p.length < 12) continue;
    const chunk = p.slice(0, 48).trim();
    if (chunk.length < 8) continue;
    if (lower.includes(chunk.toLowerCase())) hits.push(`echoes_${label}`);
  }

  return hits;
}

/**
 * Produces weekly relationship SMS from structured facts only.
 * Fail-closed: no OpenAI / parse / validation success → shouldSend false, empty body.
 */
export async function produceWeeklyV3RelationshipSms(
  args: WeeklyV3RelationshipLaneInput
): Promise<WeeklyV3RelationshipLaneResult> {
  const f = args.facts;
  const routePurpose = f.route.route_purpose;

  const baseMeta: Record<string, unknown> = {
    v3_brain_version: V3_BRAIN_VERSION,
    weekly_v3_lane_used: true,
    secondary_v3_lane_used: true,
    route_purpose: routePurpose,
    v3_lane_reply_source: "v3_weekly_relationship_lane" satisfies WeeklyV3ReplySource,
    old_weekly_writer_used_as_voice: false,
    old_weekly_writer_fact_sources: args.telemetry_fact_sources,
    weekly_facts_summary: summarizeWeeklyFacts(f),
    fully_on_v2: f.route.fully_on_v2,
    legacy_weekly_branch: f.route.legacy_weekly_branch,
  };

  const empty = (
    reason: string,
    openAiOk: boolean,
    extra?: Record<string, unknown>
  ): WeeklyV3RelationshipLaneResult => ({
    body: "",
    shouldSend: false,
    noSendReason: reason,
    replySource: "v3_weekly_relationship_lane",
    routePurpose,
    voiceConfidence: null,
    usedFacts: [],
    safetyNotes: [],
    metadata: {
      ...baseMeta,
      v3_candidate_body: "",
      should_send: false,
      no_send_reason: reason,
      openai_ok: openAiOk,
      used_facts: [],
      safety_notes: [],
      ...extra,
    },
    openAiOk,
  });

  const client = getOpenAIClient();
  if (!client) {
    return empty("openai_unavailable", false, { lane_stage: "no_client" });
  }

  const factsJson = JSON.stringify(f);
  const system = `You write the NEXT SMS in one long coaching relationship (months of texts). This weekly touchpoint is NOT a newsletter or performance report.

RULES:
- Use WEEKLY_FACTS_JSON only as facts. Never invent wins, proof moments, or numbers not implied there.
- If the week was rough (rough_week) or quiet (silent_week / thin facts), be honest and useful without shaming. If there is not enough context for a genuinely useful weekly coaching text, return should_send false.
- If there is proof (proof_moment_hints, win_hints, comeback_hints), make acknowledgment specific and earned — not generic hype.
- At most one useful question in the body, or none if a question would feel forced.
- One short SMS, max ${WEEKLY_V3_LANE_MAX_CHARS} characters, single line or very short paragraphs; no markdown, bullets, or "Coach:" prefix.
- Do not use generic motivation ("great job", "keep momentum", "you've got this", "make today count", "hope you're having").
- Do not quote, imitate, or paste text from old_weekly_proof_body_preview, deterministic_weekly_body_preview, legacy_reflection_preview, legacy_template_preview, or Pat Pause-style openers — those are telemetry-only.
- Never mention internal systems, schema, or "V2".
- Never emit raw machine tokens like event_type, blocker_captured, user_partial.
- Avoid daily-check phrasing like "Did [raw behavior text] happen today?" — this is weekly, not today's rep check.

OUTPUT: strict JSON only with keys:
should_send (boolean),
body (string, empty if should_send false),
no_send_reason (string|null),
route_purpose (string, must equal "${routePurpose}"),
voice_confidence (number 0-1 or null),
used_facts (string[]),
safety_notes (string[])`;

  const user = `WEEKLY_FACTS_JSON (facts only; previews are NOT speakable copy):
${factsJson.slice(0, 14000)}

Write JSON only.`;

  let raw = "";
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.35,
      max_tokens: 420,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    raw = completion.choices[0]?.message?.content?.trim() ?? "";
  } catch (e) {
    return empty("openai_request_failed", true, {
      lane_stage: "openai_error",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const parsed = safeJsonParse(raw);
  if (!parsed) {
    return empty("invalid_json", true, { lane_stage: "parse", raw_preview: raw.slice(0, 200) });
  }

  const modelRoute = typeof parsed.route_purpose === "string" ? parsed.route_purpose.trim() : "";
  if (modelRoute !== routePurpose) {
    return empty("route_purpose_mismatch", true, {
      lane_stage: "route_purpose",
      model_route_purpose: modelRoute || null,
    });
  }

  const shouldSendModel = parsed.should_send === true;
  let body = typeof parsed.body === "string" ? parsed.body.replace(/\r?\n/g, " ").trim() : "";
  const noSendReason = typeof parsed.no_send_reason === "string" ? parsed.no_send_reason.trim() : null;
  const voiceConfidence =
    typeof parsed.voice_confidence === "number" && Number.isFinite(parsed.voice_confidence)
      ? Math.max(0, Math.min(1, parsed.voice_confidence))
      : null;
  const usedFacts = asStringArray(parsed.used_facts);
  const safetyNotes = asStringArray(parsed.safety_notes);

  if (!shouldSendModel) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: noSendReason || "model_no_send",
      replySource: "v3_weekly_relationship_lane",
      routePurpose,
      voiceConfidence,
      usedFacts,
      safetyNotes,
      metadata: {
        ...baseMeta,
        lane_stage: "model_no_send",
        v3_candidate_body: "",
        should_send: false,
        no_send_reason: noSendReason || "model_no_send",
        openai_ok: true,
        used_facts: usedFacts,
        safety_notes: safetyNotes,
      },
      openAiOk: true,
    };
  }

  body = body.replace(/^["']|["']$/g, "").trim();
  if (!body) {
    return empty("empty_body_after_should_send", true, { lane_stage: "empty_body" });
  }

  if (body.length > WEEKLY_V3_LANE_MAX_CHARS) {
    return empty("weekly_lane_too_long", true, {
      lane_stage: "length",
      v3_candidate_body: body,
      body_len: body.length,
    });
  }

  const localHits = weeklyLaneLocalValidation(body, f);
  const fvgHits = detectFinalVoiceBlockedReasons(body);
  const blocked = [...new Set([...localHits, ...fvgHits.map((b) => `fvg:${b}`)])];

  if (blocked.length > 0) {
    return {
      body: "",
      shouldSend: false,
      noSendReason: "lane_post_validate_blocked",
      replySource: "v3_weekly_relationship_lane",
      routePurpose,
      voiceConfidence,
      usedFacts,
      safetyNotes: [...safetyNotes, ...blocked],
      metadata: {
        ...baseMeta,
        lane_stage: "post_validate_blocked",
        v3_candidate_body: body,
        blocked_reasons: blocked,
        should_send: false,
        no_send_reason: "lane_post_validate_blocked",
        openai_ok: true,
        used_facts: usedFacts,
        safety_notes: [...safetyNotes, ...blocked],
      },
      openAiOk: true,
    };
  }

  return {
    body,
    shouldSend: true,
    noSendReason: null,
    replySource: "v3_weekly_relationship_lane",
    routePurpose,
    voiceConfidence,
    usedFacts,
    safetyNotes,
    metadata: {
      ...baseMeta,
      lane_stage: "ok",
      v3_candidate_body: body,
      should_send: true,
      no_send_reason: null,
      openai_ok: true,
      used_facts: usedFacts,
      safety_notes: safetyNotes,
    },
    openAiOk: true,
  };
}
