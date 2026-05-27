import type { PatSourceBookId } from "@/lib/pat-source/types";
import { PAT_SOURCE_INGESTION_VERSION } from "@/lib/pat-source/types";

export const PAT_CANDIDATES_CATALOG_SCHEMA_VERSION = "pat_candidates_catalog_v1" as const;
export const PAT_CANDIDATES_CATALOG_VERSION = 1;

export type PatCandidateBookId = PatSourceBookId;

export type PatCandidateType =
  | "story_capsule"
  | "lesson_capsule"
  | "exact_quote"
  | "principle_candidate"
  | "q_and_a_insight";

export type PatCandidateStatus = "draft" | "approved" | "retired";

export type PatCandidateEmotionalIntensity = "low" | "medium" | "high";

export type PatCandidateMessageWeight = "light" | "standard" | "story_punch" | "special";

export type PatCandidateSuggestedSmsUse = "never" | "rare" | "normal";

export type PatCandidateQaSpeaker = "pat" | "other";

export type PatCandidateRecordV1 = {
  candidate_id: string;
  type: PatCandidateType;
  status: PatCandidateStatus;
  title: string;
  source_book_id: PatCandidateBookId;
  source_book_title: string;
  source_chunk_ids: string[];
  source_locations: string[];
  source_excerpt_preview: string;
  capsule_text: string;
  lesson_short?: string | null;
  sms_allowed: boolean;
  ask_pat_allowed: boolean;
  film_room_allowed: boolean;
  victory_room_allowed: boolean;
  best_for_moves: string[];
  best_for_patterns: string[];
  goal_areas: string[];
  emotional_intensity: PatCandidateEmotionalIntensity;
  do_not_use_contexts: string[];
  cooldown_days: number;
  must_not_expand_beyond_capsule: true;
  exact_quote_text?: string | null;
  quote_attribution_allowed: boolean;
  principle_id?: string | null;
  qa_speaker?: PatCandidateQaSpeaker | null;
  attribution_name?: string | null;
  linked_quote_ids?: string[];
  inline_chapter_label?: string | null;
  content_warnings?: string[];
  message_weight: PatCandidateMessageWeight;
  capsule_max_chars: number;
  suggested_sms_use: PatCandidateSuggestedSmsUse;
  one_sentence_version: string;
  two_sentence_context_version?: string | null;
  truncation_allowed?: boolean | null;
  quote_notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type PatCandidatesCatalogV1 = {
  schema_version: typeof PAT_CANDIDATES_CATALOG_SCHEMA_VERSION;
  catalog_version: number;
  updated_at: string;
  source_library_ref: {
    ingestion_version: typeof PAT_SOURCE_INGESTION_VERSION;
    manifest_path: string;
  };
  candidates: PatCandidateRecordV1[];
};

export const PAT_CANDIDATE_ID_PATTERN = /^[a-z0-9_]+$/;

export const PAT_CANDIDATE_SOURCE_JSONL_BY_BOOK: Record<PatCandidateBookId, string> = {
  reach_for_the_summit: "reach_for_the_summit.source_chunks.jsonl",
  sum_it_up: "sum_it_up.source_chunks.jsonl",
};

/** Phrases that must not appear as Pat source material in candidate text. */
export const PAT_CANDIDATE_BANNED_SOURCE_PHRASES = [
  "left foot, right foot, breathe",
  "left foot",
  "right foot",
] as const;
