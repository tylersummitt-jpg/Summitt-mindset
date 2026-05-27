import { isPatPrincipleId } from "@/lib/pat-definite-dozen";
import type { PatSourceChunkIndex } from "@/lib/pat-candidates/load-source-index";
import { getSourceChunk } from "@/lib/pat-candidates/load-source-index";
import {
  PAT_CANDIDATE_BANNED_SOURCE_PHRASES,
  PAT_CANDIDATE_ID_PATTERN,
  PAT_CANDIDATES_CATALOG_SCHEMA_VERSION,
  type PatCandidateBookId,
  type PatCandidateRecordV1,
  type PatCandidatesCatalogV1,
} from "@/lib/pat-candidates/types";
import { getPatSourceBookConfig } from "@/lib/pat-source/types";

export type PatCandidateValidationIssue = {
  level: "error" | "warn";
  candidate_id?: string;
  code: string;
  message: string;
};

export type PatCandidateValidationResult = {
  ok: boolean;
  errors: PatCandidateValidationIssue[];
  warnings: PatCandidateValidationIssue[];
};

const ALLOWED_BOOK_IDS: PatCandidateBookId[] = ["reach_for_the_summit", "sum_it_up"];

const PAT_SAID_PATTERN = /\bpat\s+said\b/i;
const PAT_SAYS_PATTERN = /\bpat\s+says\b/i;

function issue(
  level: "error" | "warn",
  code: string,
  message: string,
  candidate_id?: string
): PatCandidateValidationIssue {
  return { level, code, message, candidate_id };
}

function collectSearchableText(c: PatCandidateRecordV1): string {
  return [
    c.title,
    c.capsule_text,
    c.lesson_short ?? "",
    c.one_sentence_version,
    c.two_sentence_context_version ?? "",
    c.exact_quote_text ?? "",
    c.source_excerpt_preview,
  ].join("\n");
}

function containsBannedSourcePhrase(text: string): string | null {
  const lower = text.toLowerCase();
  for (const phrase of PAT_CANDIDATE_BANNED_SOURCE_PHRASES) {
    if (lower.includes(phrase.toLowerCase())) return phrase;
  }
  return null;
}

function validateEnvelope(catalog: PatCandidatesCatalogV1, issues: PatCandidateValidationIssue[]) {
  if (catalog.schema_version !== PAT_CANDIDATES_CATALOG_SCHEMA_VERSION) {
    issues.push(
      issue(
        "error",
        "invalid_schema_version",
        `schema_version must be ${PAT_CANDIDATES_CATALOG_SCHEMA_VERSION}`
      )
    );
  }
  if (!Array.isArray(catalog.candidates)) {
    issues.push(issue("error", "missing_candidates", "candidates must be an array"));
  }
}

function validateCandidateRecord(
  c: PatCandidateRecordV1,
  sourceIndex: PatSourceChunkIndex | null,
  knownIds: Set<string>,
  issues: PatCandidateValidationIssue[]
) {
  const id = c.candidate_id;

  if (!id || !PAT_CANDIDATE_ID_PATTERN.test(id)) {
    issues.push(
      issue(
        "error",
        "invalid_candidate_id",
        "candidate_id must match ^[a-z0-9_]+$",
        id || undefined
      )
    );
  }
  if (knownIds.has(id)) {
    issues.push(issue("error", "duplicate_candidate_id", `duplicate candidate_id: ${id}`, id));
  }
  knownIds.add(id);

  if (!c.status) {
    issues.push(issue("error", "missing_status", "status is required", id));
  }

  if (!c.type) {
    issues.push(issue("error", "missing_type", "type is required", id));
  }

  if (c.source_book_id === ("raise_the_roof" as PatCandidateBookId)) {
    issues.push(issue("error", "forbidden_book", "raise_the_roof is not allowed", id));
  } else if (!ALLOWED_BOOK_IDS.includes(c.source_book_id)) {
    issues.push(
      issue("error", "invalid_source_book_id", `unknown source_book_id: ${c.source_book_id}`, id)
    );
  }

  if (!c.source_chunk_ids?.length) {
    issues.push(issue("error", "missing_source_chunks", "source_chunk_ids must be non-empty", id));
  }

  if (c.source_chunk_ids?.length && !c.source_excerpt_preview?.trim()) {
    issues.push(
      issue("error", "missing_source_excerpt", "source_excerpt_preview is required when chunks are linked", id)
    );
  }

  if (sourceIndex?.loaded && c.source_chunk_ids?.length) {
    for (const chunkId of c.source_chunk_ids) {
      const chunk = getSourceChunk(sourceIndex, c.source_book_id, chunkId);
      if (!chunk) {
        issues.push(
          issue(
            "error",
            "unknown_source_chunk",
            `source_chunk_id not found in source library: ${chunkId}`,
            id
          )
        );
      }
    }
  } else if (c.source_chunk_ids?.length && sourceIndex && !sourceIndex.loaded) {
    issues.push(
      issue(
        "warn",
        "source_index_unavailable",
        "source library not loaded; chunk IDs were not verified",
        id
      )
    );
  }

  if (c.must_not_expand_beyond_capsule !== true) {
    issues.push(
      issue(
        "error",
        "must_not_expand",
        "must_not_expand_beyond_capsule must be true for all v1 candidates",
        id
      )
    );
  }

  if (typeof c.cooldown_days !== "number" || c.cooldown_days < 0) {
    issues.push(issue("error", "invalid_cooldown", "cooldown_days must be a number >= 0", id));
  }

  if (!c.one_sentence_version?.trim()) {
    issues.push(issue("error", "missing_one_sentence", "one_sentence_version is required", id));
  } else if (
    typeof c.capsule_max_chars === "number" &&
    c.one_sentence_version.length > c.capsule_max_chars
  ) {
    issues.push(
      issue(
        "error",
        "one_sentence_too_long",
        `one_sentence_version length ${c.one_sentence_version.length} exceeds capsule_max_chars ${c.capsule_max_chars}`,
        id
      )
    );
  }

  if (c.sms_allowed && c.status !== "approved") {
    issues.push(
      issue(
        "error",
        "sms_allowed_requires_approved",
        "sms_allowed may only be true when status is approved",
        id
      )
    );
  }

  if (c.type === "q_and_a_insight" && c.sms_allowed) {
    issues.push(
      issue(
        "error",
        "qa_not_sms_direct",
        "q_and_a_insight cannot have sms_allowed true; promote to lesson or exact_quote first",
        id
      )
    );
  }

  const banned = containsBannedSourcePhrase(collectSearchableText(c));
  if (banned) {
    issues.push(
      issue(
        "error",
        "banned_source_phrase",
        `candidate text must not use banned Pat source phrase: "${banned}"`,
        id
      )
    );
  }

  if (c.quote_attribution_allowed && c.type !== "exact_quote") {
    issues.push(
      issue(
        "error",
        "quote_attribution_only_exact_quote",
        "quote_attribution_allowed may only be true for exact_quote",
        id
      )
    );
  }

  if (c.type === "story_capsule" || c.type === "lesson_capsule") {
    if (!c.capsule_text?.trim()) {
      issues.push(issue("error", "missing_capsule_text", "capsule_text is required", id));
    }
    const text = collectSearchableText(c);
    if (PAT_SAID_PATTERN.test(text) || PAT_SAYS_PATTERN.test(text)) {
      issues.push(
        issue(
          "error",
          "pat_said_not_allowed",
          'story_capsule and lesson_capsule must not contain "Pat said" or "Pat says"',
          id
        )
      );
    }
  }

  if (c.type === "principle_candidate") {
    if (!c.capsule_text?.trim()) {
      issues.push(issue("error", "missing_capsule_text", "capsule_text is required", id));
    }
    if (!c.principle_id) {
      issues.push(issue("error", "missing_principle_id", "principle_id is required", id));
    } else if (!isPatPrincipleId(c.principle_id)) {
      issues.push(
        issue("error", "invalid_principle_id", `unknown principle_id: ${c.principle_id}`, id)
      );
    }
  }

  if (c.type === "exact_quote") {
    if (!c.exact_quote_text?.trim()) {
      issues.push(issue("error", "missing_exact_quote_text", "exact_quote_text is required", id));
    } else if (sourceIndex?.loaded && c.source_chunk_ids?.length) {
      const combined = c.source_chunk_ids
        .map((chunkId) => getSourceChunk(sourceIndex, c.source_book_id, chunkId)?.cleaned_text ?? "")
        .join("\n");
      if (combined && !combined.includes(c.exact_quote_text)) {
        issues.push(
          issue(
            "error",
            "quote_not_in_source",
            "exact_quote_text must appear verbatim in linked source chunk cleaned_text",
            id
          )
        );
      }
    }
    if (!c.quote_attribution_allowed) {
      issues.push(
        issue(
          "warn",
          "quote_attribution_false",
          "exact_quote typically should have quote_attribution_allowed true when used for attribution",
          id
        )
      );
    }
  }

  if (c.type === "q_and_a_insight") {
    if (!c.qa_speaker) {
      issues.push(issue("error", "missing_qa_speaker", "qa_speaker is required for q_and_a_insight", id));
    }
    if (c.qa_speaker === "other" && !c.attribution_name?.trim()) {
      issues.push(
        issue(
          "error",
          "missing_attribution_name",
          "attribution_name is required when qa_speaker is other",
          id
        )
      );
    }
    if (c.qa_speaker === "other" && c.quote_attribution_allowed) {
      issues.push(
        issue(
          "error",
          "other_speaker_no_pat_attribution",
          "quote_attribution_allowed cannot be true when qa_speaker is other",
          id
        )
      );
    }
  }

  // Book title consistency (soft)
  try {
    const expected = getPatSourceBookConfig(c.source_book_id).book_title;
    if (c.source_book_title && c.source_book_title !== expected) {
      issues.push(
        issue(
          "warn",
          "source_book_title_mismatch",
          `source_book_title "${c.source_book_title}" does not match config "${expected}"`,
          id
        )
      );
    }
  } catch {
    // invalid book already flagged
  }
}

/**
 * Second pass: resolve linked_quote_ids after all candidate_ids are known.
 */
function validateLinkedQuotes(
  candidates: PatCandidateRecordV1[],
  issues: PatCandidateValidationIssue[]
) {
  const ids = new Set(candidates.map((c) => c.candidate_id));
  for (const c of candidates) {
    for (const linkedId of c.linked_quote_ids ?? []) {
      if (!ids.has(linkedId)) {
        issues.push(
          issue(
            "error",
            "linked_quote_missing",
            `linked_quote_ids references missing candidate_id: ${linkedId}`,
            c.candidate_id
          )
        );
      }
    }
  }
}

export function validatePatCandidatesCatalog(
  catalog: PatCandidatesCatalogV1,
  sourceIndex: PatSourceChunkIndex | null = null
): PatCandidateValidationResult {
  const allIssues: PatCandidateValidationIssue[] = [];

  validateEnvelope(catalog, allIssues);

  const candidates = catalog.candidates ?? [];
  const knownIds = new Set<string>();

  for (const c of candidates) {
    validateCandidateRecord(c, sourceIndex, knownIds, allIssues);
  }

  validateLinkedQuotes(candidates, allIssues);

  const errors = allIssues.filter((i) => i.level === "error");
  const warnings = allIssues.filter((i) => i.level === "warn");

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

export function parsePatCandidatesCatalogJson(raw: string): PatCandidatesCatalogV1 {
  return JSON.parse(raw) as PatCandidatesCatalogV1;
}
