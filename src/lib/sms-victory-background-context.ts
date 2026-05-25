import "server-only";

import { supabaseServer } from "@/lib/supabase-server";

const MAX_SEASON_LABEL = 80;
const MAX_PAT_READ_FIELD = 220;
const MAX_PRINCIPLE_TITLE = 80;
const MAX_PRINCIPLE_TEXT = 220;

const PAT_PRINCIPLES_DISPLAY_SELECT =
  "living_well_title, living_well_text, living_well_evidence_ids, focus_next_title, focus_next_text, confidence";

export type SmsVictoryPatPrinciplesContext = {
  focusNextTitle: string;
  focusNextText: string;
  livingWellTitle: string | null;
  livingWellText: string | null;
};

export type SmsVictoryBackgroundContext = {
  activeSeason: null | {
    seasonName: string;
    startedAt: string | null;
  };
  patRead: null | {
    strength: string | null;
    pattern: string | null;
    nextMove: string | null;
  };
  patPrinciples: SmsVictoryPatPrinciplesContext | null;
};

/** JSON-safe Pat Principles block for V3 victory_background (display only). */
export type V3VictoryPatPrinciplesFacts = {
  focus_next_title: string;
  focus_next_text: string;
  living_well_title: string | null;
  living_well_text: string | null;
};

/** JSON-safe victory background block for V3 relationship facts (background only). */
export type V3VictoryBackgroundFacts = {
  active_season_label: string | null;
  active_season_started_at: string | null;
  pat_read_strength: string | null;
  pat_read_pattern: string | null;
  pat_read_next_move: string | null;
  pat_principles?: V3VictoryPatPrinciplesFacts | null;
};

function truncateField(value: string | null | undefined, max: number): string | null {
  const t = (value ?? "").trim().replace(/\s+/g, " ");
  if (!t) return null;
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function livingWellEvidenceIdCount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  return raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .length;
}

/** Map persisted snapshot row to speakable Pat Principles context (Victory Room gates). */
export function mapPatPrinciplesSnapshotRowToContext(row: {
  living_well_title?: unknown;
  living_well_text?: unknown;
  living_well_evidence_ids?: unknown;
  focus_next_title?: unknown;
  focus_next_text?: unknown;
  confidence?: unknown;
}): SmsVictoryPatPrinciplesContext | null {
  if (row.confidence === "starter") {
    return null;
  }

  const focusTitle = truncateField(
    typeof row.focus_next_title === "string" ? row.focus_next_title : null,
    MAX_PRINCIPLE_TITLE
  );
  const focusText = truncateField(
    typeof row.focus_next_text === "string" ? row.focus_next_text : null,
    MAX_PRINCIPLE_TEXT
  );
  if (!focusTitle || !focusText) {
    return null;
  }

  let livingWellTitle: string | null = null;
  let livingWellText: string | null = null;
  if (livingWellEvidenceIdCount(row.living_well_evidence_ids) > 0) {
    livingWellTitle = truncateField(
      typeof row.living_well_title === "string" ? row.living_well_title : null,
      MAX_PRINCIPLE_TITLE
    );
    livingWellText = truncateField(
      typeof row.living_well_text === "string" ? row.living_well_text : null,
      MAX_PRINCIPLE_TEXT
    );
    if (!livingWellTitle || !livingWellText) {
      livingWellTitle = null;
      livingWellText = null;
    }
  }

  return {
    focusNextTitle: focusTitle,
    focusNextText: focusText,
    livingWellTitle,
    livingWellText,
  };
}

function mapPatPrinciplesContextToFacts(
  pat: SmsVictoryPatPrinciplesContext | null
): V3VictoryPatPrinciplesFacts | null {
  if (!pat) return null;
  return {
    focus_next_title: pat.focusNextTitle,
    focus_next_text: pat.focusNextText,
    living_well_title: pat.livingWellTitle,
    living_well_text: pat.livingWellText,
  };
}

export function mapSmsVictoryBackgroundToFacts(
  ctx: SmsVictoryBackgroundContext
): V3VictoryBackgroundFacts | null {
  const seasonLabel = truncateField(ctx.activeSeason?.seasonName, MAX_SEASON_LABEL);
  const startedAt =
    typeof ctx.activeSeason?.startedAt === "string" && ctx.activeSeason.startedAt.trim()
      ? ctx.activeSeason.startedAt.trim()
      : null;
  const patStrength = truncateField(ctx.patRead?.strength, MAX_PAT_READ_FIELD);
  const patPattern = truncateField(ctx.patRead?.pattern, MAX_PAT_READ_FIELD);
  const patNextMove = truncateField(ctx.patRead?.nextMove, MAX_PAT_READ_FIELD);
  const patPrinciples = mapPatPrinciplesContextToFacts(ctx.patPrinciples);

  if (
    !seasonLabel &&
    !startedAt &&
    !patStrength &&
    !patPattern &&
    !patNextMove &&
    !patPrinciples
  ) {
    return null;
  }

  return {
    active_season_label: seasonLabel,
    active_season_started_at: startedAt,
    pat_read_strength: patStrength,
    pat_read_pattern: patPattern,
    pat_read_next_move: patNextMove,
    ...(patPrinciples ? { pat_principles: patPrinciples } : {}),
  };
}

/** Shared V3 lane guardrails — victory_background is optional background, not mandatory copy. */
export function buildVictoryBackgroundLaneGuardrails(): string {
  return `
VICTORY_BACKGROUND (when present in facts): optional read-only context from Victory Room snapshots — NOT a required talking point.
- Current Goal / effective ask remains the primary anchor for this SMS. Keep the message short.
- Mention an active season only when natural and helpful; do not say "season" if active_season_label is null.
- Do not invent a season arc, season title, proof count, or completion story.
- pat_read_* fields are background signals only; do not quote or label "Coach Pat's Read" in most SMS.
- Do not invent Strength / Pattern / Next Move beyond what pat_read_* provides.
- PAT_PRINCIPLES (when pat_principles appears in victory_background): read-only Victory Room snapshot — do not invent principle names, evidence, or claims.
- Do not say the user is "living" a principle unless both living_well_title and living_well_text are present in facts.
- Mention at most one Pat Principle in this SMS unless the user explicitly asks about principles.
- Use focus_next as gentle background, not a lecture; do not mention Pat Principles in every message.
- Do not say "Definite Dozen" unless the user brought it up or it is clearly natural.
- Do not quote Pat Summitt or turn SMS into a lesson.
- Pat Pause is a weekly reflection rhythm name — not the same as pat_principles snapshot titles.
- If pat_principles is absent, do not mention Pat Principles at all.
- Victory Room is the proof/story surface; Daily OS is for utility/action — do not call Dashboard the home surface.
- Do not say "open the app" unless the user asked about navigation.`;
}

const EMPTY_CONTEXT: SmsVictoryBackgroundContext = {
  activeSeason: null,
  patRead: null,
  patPrinciples: null,
};

/**
 * Bounded read-only Victory background for SMS V3 facts.
 * Fail-open: errors return empty blocks; never throws to callers.
 */
export async function loadSmsVictoryBackgroundContext(args: {
  clerkUserId: string;
  commitmentId: string;
  timezone?: string | null;
}): Promise<SmsVictoryBackgroundContext> {
  void args.timezone;
  try {
    const [seasonResult, patReadResult, patPrinciplesResult] = await Promise.all([
      supabaseServer
        .from("user_accountability_season")
        .select("id, season_name, started_at")
        .eq("clerk_user_id", args.clerkUserId)
        .eq("commitment_id", args.commitmentId)
        .eq("status", "active")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseServer
        .from("v2_victory_pat_read_snapshot")
        .select("strength_text, pattern_text, next_move_text")
        .eq("clerk_user_id", args.clerkUserId)
        .eq("commitment_id", args.commitmentId)
        .maybeSingle(),
      supabaseServer
        .from("v2_victory_pat_principles_snapshot")
        .select(PAT_PRINCIPLES_DISPLAY_SELECT)
        .eq("clerk_user_id", args.clerkUserId)
        .eq("commitment_id", args.commitmentId)
        .maybeSingle(),
    ]);

    let activeSeason: SmsVictoryBackgroundContext["activeSeason"] = null;
    if (seasonResult.error) {
      console.warn("[sms-victory-background] active season load failed", {
        clerk_user_id: args.clerkUserId,
        commitment_id: args.commitmentId,
        message: seasonResult.error.message,
      });
    } else if (seasonResult.data?.season_name) {
      const name = String(seasonResult.data.season_name).trim();
      if (name) {
        activeSeason = {
          seasonName: name,
          startedAt:
            seasonResult.data.started_at != null ? String(seasonResult.data.started_at) : null,
        };
      }
    }

    let patRead: SmsVictoryBackgroundContext["patRead"] = null;
    if (patReadResult.error) {
      console.warn("[sms-victory-background] pat read snapshot load failed", {
        clerk_user_id: args.clerkUserId,
        commitment_id: args.commitmentId,
        message: patReadResult.error.message,
      });
    } else if (patReadResult.data) {
      const strength = truncateField(
        typeof patReadResult.data.strength_text === "string"
          ? patReadResult.data.strength_text
          : null,
        MAX_PAT_READ_FIELD
      );
      const pattern = truncateField(
        typeof patReadResult.data.pattern_text === "string" ? patReadResult.data.pattern_text : null,
        MAX_PAT_READ_FIELD
      );
      const nextMove = truncateField(
        typeof patReadResult.data.next_move_text === "string"
          ? patReadResult.data.next_move_text
          : null,
        MAX_PAT_READ_FIELD
      );
      if (strength || pattern || nextMove) {
        patRead = { strength, pattern, nextMove };
      }
    }

    let patPrinciples: SmsVictoryBackgroundContext["patPrinciples"] = null;
    if (patPrinciplesResult.error) {
      console.warn("[sms-victory-background] pat principles snapshot load failed", {
        clerk_user_id: args.clerkUserId,
        commitment_id: args.commitmentId,
        message: patPrinciplesResult.error.message,
      });
    } else if (patPrinciplesResult.data) {
      patPrinciples = mapPatPrinciplesSnapshotRowToContext(patPrinciplesResult.data);
    }

    return { activeSeason, patRead, patPrinciples };
  } catch (e) {
    console.warn("[sms-victory-background] load failed", {
      clerk_user_id: args.clerkUserId,
      commitment_id: args.commitmentId,
      message: e instanceof Error ? e.message : String(e),
    });
    return { ...EMPTY_CONTEXT };
  }
}
