import {
  getPatPrincipleById,
  PAT_DEFINITE_DOZEN,
  type PatPrincipleDefinition,
  type PatPrincipleId,
} from "@/lib/pat-definite-dozen";
import type { PatReadPatternConfidence } from "@/lib/v2-victory-pat-read-persist";
import {
  getRecentProofCategoryLabel,
  inferRecentProofCategory,
  type VictoryMoment,
  type VictoryRoomViewData,
} from "@/lib/v2-victory-room-view";

export type PrinciplesConfidence = "starter" | "low" | "medium" | "high";

export type VictoryPrincipleCardDisplay = {
  title: string;
  text: string;
  evidenceIds: string[];
};

/** User-facing Pat Principles section (no internal metadata). */
export type VictoryPatPrinciplesForDisplay = {
  confidence: PrinciplesConfidence;
  starterText: string | null;
  livingWell: VictoryPrincipleCardDisplay | null;
  focusNext: VictoryPrincipleCardDisplay;
  updatedFromProof: boolean;
};

type RecentProofCategory =
  | "came_back"
  | "told_the_truth"
  | "adjusted_wisely"
  | "raised_the_bar"
  | "finished_a_chapter"
  | "showed_up"
  | "kept_the_thread_alive";

type CategorySignal = {
  category: RecentProofCategory;
  label: string;
  momentIds: string[];
  weight: number;
};

const LIVING_WEIGHT = 3;
const FOCUS_WEIGHT = 2;

const CATEGORY_LIVING: Record<RecentProofCategory, PatPrincipleId[]> = {
  showed_up: ["discipline_yourself", "hard_work_passion"],
  kept_the_thread_alive: ["discipline_yourself", "hard_work_passion"],
  told_the_truth: ["take_full_responsibility", "great_communicator"],
  came_back: ["be_a_competitor", "handle_success_and_failure", "take_full_responsibility"],
  adjusted_wisely: ["work_smart", "change_is_a_must", "take_full_responsibility"],
  raised_the_bar: ["be_a_competitor", "winning_attitude", "hard_work_passion"],
  finished_a_chapter: ["change_is_a_must", "winning_attitude"],
};

const CATEGORY_FOCUS: Record<RecentProofCategory, PatPrincipleId[]> = {
  showed_up: ["winning_attitude"],
  kept_the_thread_alive: ["winning_attitude"],
  told_the_truth: ["great_communicator", "discipline_yourself"],
  came_back: ["discipline_yourself"],
  adjusted_wisely: ["discipline_yourself"],
  raised_the_bar: ["hard_work_passion", "be_a_competitor"],
  finished_a_chapter: ["discipline_yourself"],
};

const COMEBACK_LIVING: PatPrincipleId[] = [
  "be_a_competitor",
  "take_full_responsibility",
  "handle_success_and_failure",
];
const COMEBACK_FOCUS: PatPrincipleId[] = ["great_communicator", "discipline_yourself"];

const SEASON_LIVING: PatPrincipleId[] = ["handle_success_and_failure", "change_is_a_must"];
const SEASON_FOCUS: PatPrincipleId[] = ["be_a_competitor"];

const STARTER_FOCUS: PatPrincipleId[] = ["take_full_responsibility", "discipline_yourself"];

const GAMIFICATION_WORDS =
  /\b(achievement|badge|unlocked|level|score|streak|leaderboard|points)\b/i;

const STARTER_COPY =
  "Your principles will become clearer as Coach Pat sees proof. Start with the standard: tell the truth, keep the goal, and get back on track when you miss.";

function isStrongLivingCategory(category: RecentProofCategory): boolean {
  if (category === "showed_up" || category === "kept_the_thread_alive") {
    return false;
  }
  return true;
}

function addScore(
  scores: Map<PatPrincipleId, { living: number; focus: number; evidenceIds: Set<string> }>,
  ids: PatPrincipleId[],
  kind: "living" | "focus",
  weight: number,
  evidenceIds: string[]
) {
  for (const id of ids) {
    const cur = scores.get(id) ?? {
      living: 0,
      focus: 0,
      evidenceIds: new Set<string>(),
    };
    if (kind === "living") {
      cur.living += weight;
    } else {
      cur.focus += weight;
    }
    for (const eid of evidenceIds) {
      cur.evidenceIds.add(eid);
    }
    scores.set(id, cur);
  }
}

function buildCategorySignals(view: VictoryRoomViewData): CategorySignal[] {
  const byCategory = new Map<RecentProofCategory, CategorySignal>();

  for (const m of view.moments) {
    const category = inferRecentProofCategory(m);
    const label = getRecentProofCategoryLabel(m);
    const existing = byCategory.get(category);
    if (existing) {
      existing.momentIds.push(m.id);
      existing.weight += 1;
    } else {
      byCategory.set(category, {
        category,
        label,
        momentIds: [m.id],
        weight: 1,
      });
    }
  }

  if (view.comebackLines.length > 0) {
    const existing = byCategory.get("came_back");
    if (existing) {
      existing.weight += view.comebackLines.length;
    } else {
      byCategory.set("came_back", {
        category: "came_back",
        label: "Got back on track",
        momentIds: [],
        weight: view.comebackLines.length,
      });
    }
  }

  if (view.evidenceCounts.seasonsCompleted > 0) {
    byCategory.set("finished_a_chapter", {
      category: "finished_a_chapter",
      label: "Completed a season",
      momentIds: [],
      weight: view.evidenceCounts.seasonsCompleted,
    });
  }

  return [...byCategory.values()];
}

function pickTopPrinciple(
  scores: Map<PatPrincipleId, { living: number; focus: number; evidenceIds: Set<string> }>,
  kind: "living" | "focus",
  exclude?: PatPrincipleId
): { id: PatPrincipleId; evidenceIds: string[] } | null {
  let best: PatPrincipleId | null = null;
  let bestScore = 0;
  let bestEvidence: string[] = [];

  for (const [id, row] of scores) {
    if (exclude && id === exclude) continue;
    const s = kind === "living" ? row.living : row.focus;
    if (s <= 0) continue;
    const evidence = [...row.evidenceIds];
    if (s > bestScore || (s === bestScore && evidence.length > bestEvidence.length)) {
      best = id;
      bestScore = s;
      bestEvidence = evidence;
    }
  }

  if (!best) return null;
  return { id: best, evidenceIds: bestEvidence };
}

function livingProofLabel(signal: CategorySignal): string {
  return signal.label.toLowerCase();
}

function buildLivingWellText(principle: PatPrincipleDefinition, proofLabel: string): string {
  return `Your recent proof — ${proofLabel} — lines up with ${principle.title}: ${principle.shortCoachLine}`;
}

function buildFocusNextText(principle: PatPrincipleDefinition, early: boolean): string {
  const prefix = early
    ? "Early proof is forming. This week, practice"
    : "This week, practice";
  return `${prefix} ${principle.focusPracticeHint}`;
}

function assertCleanCopy(text: string) {
  if (GAMIFICATION_WORDS.test(text)) {
    throw new Error(`Disallowed gamification wording in principles copy: ${text}`);
  }
  if (/pat said/i.test(text) || text.includes("\u201C")) {
    throw new Error(`Disallowed quote-style copy in principles: ${text}`);
  }
}

function keptGoalMomentCount(view: VictoryRoomViewData): number {
  return view.moments.filter((m) => {
    const c = inferRecentProofCategory(m);
    return c === "showed_up" || c === "kept_the_thread_alive";
  }).length;
}

export function buildDeterministicPrinciplesFromView(
  view: VictoryRoomViewData,
  options?: { patternConfidence?: PatReadPatternConfidence }
): VictoryPatPrinciplesForDisplay {
  const hasProof =
    view.moments.length > 0 ||
    view.comebackLines.length > 0 ||
    view.evidenceCounts.seasonsCompleted > 0;

  const patternConfidence = options?.patternConfidence ?? "none";
  const signals = buildCategorySignals(view);
  const scores = new Map<
    PatPrincipleId,
    { living: number; focus: number; evidenceIds: Set<string> }
  >();

  const keptMoments = keptGoalMomentCount(view);
  const keptGoalLivingAllowed =
    view.evidenceCounts.keptTheGoal >= 3 && keptMoments >= 3;

  for (const signal of signals) {
    const evidenceIds =
      signal.momentIds.length > 0 ? signal.momentIds : [];

    if (isStrongLivingCategory(signal.category)) {
      addScore(scores, CATEGORY_LIVING[signal.category], "living", LIVING_WEIGHT * signal.weight, evidenceIds);
    } else if (keptGoalLivingAllowed) {
      addScore(scores, CATEGORY_LIVING[signal.category], "living", LIVING_WEIGHT * signal.weight, evidenceIds);
    }

    addScore(scores, CATEGORY_FOCUS[signal.category], "focus", FOCUS_WEIGHT * signal.weight, evidenceIds);
  }

  if (view.comebackLines.length > 0) {
    addScore(scores, COMEBACK_LIVING, "living", LIVING_WEIGHT, []);
    addScore(scores, COMEBACK_FOCUS, "focus", FOCUS_WEIGHT, []);
  }

  if (view.evidenceCounts.seasonsCompleted > 0) {
    addScore(scores, SEASON_LIVING, "living", LIVING_WEIGHT, []);
    addScore(scores, SEASON_FOCUS, "focus", FOCUS_WEIGHT, []);
  }

  if (!hasProof) {
    const focusId = STARTER_FOCUS[0];
    const principle = getPatPrincipleById(focusId);
    const focusText = `Start with the standard: ${principle.focusPracticeHint}`;
    assertCleanCopy(STARTER_COPY);
    assertCleanCopy(focusText);
    return {
      confidence: "starter",
      starterText: STARTER_COPY,
      livingWell: null,
      focusNext: {
        title: principle.title,
        text: focusText,
        evidenceIds: [],
      },
      updatedFromProof: false,
    };
  }

  const lowProof =
    view.hasSparseProof ||
    view.isDayZeroUser ||
    (view.moments.length <= 1 && view.comebackLines.length === 0);

  let livingPick = pickTopPrinciple(scores, "living");
  if (livingPick && livingPick.evidenceIds.length === 0) {
    livingPick = null;
  }

  let focusPick = pickTopPrinciple(scores, "focus", livingPick?.id);
  if (!focusPick) {
    focusPick = pickTopPrinciple(scores, "focus");
  }
  if (!focusPick) {
    focusPick = { id: STARTER_FOCUS[lowProof ? 0 : 1], evidenceIds: [] };
  }

  if (livingPick && focusPick.id === livingPick.id) {
    const alt = pickTopPrinciple(scores, "focus", livingPick.id);
    if (alt) {
      focusPick = alt;
    } else {
      livingPick = null;
    }
  }

  if (lowProof) {
    livingPick = null;
  }

  let confidence: PrinciplesConfidence = "low";
  if (livingPick && livingPick.evidenceIds.length >= 2) {
    confidence = patternConfidence === "high" ? "high" : "medium";
  } else if (!lowProof && view.moments.length >= 3) {
    confidence = "medium";
  }

  const focusPrinciple = getPatPrincipleById(focusPick.id);
  const focusText = buildFocusNextText(focusPrinciple, lowProof);
  assertCleanCopy(focusText);

  let livingWell: VictoryPrincipleCardDisplay | null = null;
  if (livingPick && livingPick.evidenceIds.length > 0) {
    const livingPrinciple = getPatPrincipleById(livingPick.id);
    const topSignal = signals
      .filter((s) => s.momentIds.some((id) => livingPick!.evidenceIds.includes(id)))
      .sort((a, b) => b.weight - a.weight)[0];
    const proofLabel = topSignal
      ? livingProofLabel(topSignal)
      : "your honest check-ins";
    const livingText = buildLivingWellText(livingPrinciple, proofLabel);
    assertCleanCopy(livingText);
    livingWell = {
      title: livingPrinciple.title,
      text: livingText,
      evidenceIds: livingPick.evidenceIds,
    };
  }

  return {
    confidence,
    starterText: null,
    livingWell,
    focusNext: {
      title: focusPrinciple.title,
      text: focusText,
      evidenceIds: focusPick.evidenceIds,
    },
    updatedFromProof: hasProof,
  };
}

/** Internal snapshot row fields for persistence. */
export type PrinciplesSnapshotContent = {
  living_well_principle_id: string | null;
  living_well_title: string | null;
  living_well_text: string | null;
  living_well_evidence_ids: string[];
  focus_next_principle_id: string;
  focus_next_title: string;
  focus_next_text: string;
  focus_next_evidence_ids: string[];
  starter_text: string | null;
  confidence: PrinciplesConfidence;
};

export function buildPrinciplesSnapshotContent(
  view: VictoryRoomViewData,
  options?: { patternConfidence?: PatReadPatternConfidence }
): PrinciplesSnapshotContent {
  const display = buildDeterministicPrinciplesFromView(view, options);
  const livingId = display.livingWell
    ? resolvePrincipleIdByTitle(display.livingWell.title)
    : null;
  const focusId = resolvePrincipleIdByTitle(display.focusNext.title);

  return {
    living_well_principle_id: livingId,
    living_well_title: display.livingWell?.title ?? null,
    living_well_text: display.livingWell?.text ?? null,
    living_well_evidence_ids: display.livingWell?.evidenceIds ?? [],
    focus_next_principle_id: focusId,
    focus_next_title: display.focusNext.title,
    focus_next_text: display.focusNext.text,
    focus_next_evidence_ids: display.focusNext.evidenceIds,
    starter_text: display.starterText,
    confidence: display.confidence,
  };
}

function resolvePrincipleIdByTitle(title: string): PatPrincipleId {
  const found = PAT_DEFINITE_DOZEN.find((p) => p.title === title);
  if (!found) {
    return "discipline_yourself";
  }
  return found.id;
}

export function snapshotContentToDisplay(
  content: PrinciplesSnapshotContent
): VictoryPatPrinciplesForDisplay {
  const livingWell =
    content.living_well_text &&
    content.living_well_title &&
    content.living_well_evidence_ids.length > 0
      ? {
          title: content.living_well_title,
          text: content.living_well_text,
          evidenceIds: content.living_well_evidence_ids,
        }
      : null;

  return {
    confidence: content.confidence,
    starterText: content.starter_text,
    livingWell,
    focusNext: {
      title: content.focus_next_title,
      text: content.focus_next_text,
      evidenceIds: content.focus_next_evidence_ids,
    },
    updatedFromProof: content.confidence !== "starter",
  };
}
