/**
 * Onboarding Victory Room milestones — three truthful Proud Moments.
 * Server-only. Not wired to onboarding completion in this slice.
 * Image failure never removes a win that already inserted.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { supabaseServer } from "@/lib/supabase-server";
import { VICTORY_MEDIA_BUCKET } from "@/lib/victory-media/constants";
import { normalizeVictoryImage } from "@/lib/victory-media/normalize-victory-image";
import type { NormalizeVictoryImageResult } from "@/lib/victory-media/image-types";
import {
  victoryMediaCardPath,
  victoryMediaMasterPath,
} from "@/lib/victory-media/storage-paths";

/** Completions before this instant are not seeded. Ship instant for this wiring. */
export const ONBOARDING_VICTORY_MILESTONE_CUTOFF_ISO = "2026-09-24T15:09:00.000Z";

const ASSET_DIR = path.join(
  process.cwd(),
  "src/lib/onboarding-victory-milestones/assets"
);

export const ONBOARDING_VICTORY_MILESTONES = [
  {
    key: "joined",
    title: "Joined Summitt Mindset",
    filename: "joined-summitt-mindset.jpg",
  },
  {
    key: "identity",
    title: "Created Identity Statement",
    filename: "created-identity-statement.jpg",
  },
  {
    key: "first_goal",
    title: "Set First Goal",
    filename: "set-first-goal.jpg",
  },
] as const;

export type OnboardingVictoryMilestoneKey =
  (typeof ONBOARDING_VICTORY_MILESTONES)[number]["key"];

export type OnboardingVictoryMilestoneResult = {
  milestoneKey: OnboardingVictoryMilestoneKey;
  winId: string | null;
  persistence: "inserted" | "existing" | "failed";
  image: "attached" | "not_attached";
  imageFailure: string | null;
};

export type SeedOnboardingVictoryMilestonesResult = {
  /** True only when the cutoff gate passed and seeding was attempted. */
  seeded: boolean;
  skip: "invalid_user" | "missing_completed_at" | "before_cutoff" | "profile_read_failed" | null;
  completedAt: string | null;
  milestones: OnboardingVictoryMilestoneResult[];
};

type WinInsertRow = {
  clerk_user_id: string;
  source_type: "system_event";
  source_message_sid: null;
  source_message_id: null;
  source_event_id: null;
  commitment_id: null;
  occurred_at: string;
  action_fact: string;
  why_meaningful: null;
  display_title: string;
  display_body: string;
  display_body_is_archival_detail: false;
  supporting_quote: null;
  relationship_type: "goal";
  recognition_mode: "coach_recognized";
  user_expressed_pride: false;
  identity_related: false;
  sensitivity_caution: false;
  celebration_appropriate: false;
  status: "active";
  candidate_ordinal: 0;
  idempotency_key: string;
  schema_version: "win_v1";
  model_confidence: null;
  win_kind: "proud_moment";
};

type MediaInsertRow = {
  id: string;
  win_id: string;
  clerk_user_id: string;
  source_type: "web_upload";
  source_message_sid: null;
  source_media_ordinal: null;
  twilio_media_sid: null;
  storage_master_path: string;
  storage_card_path: string;
  mime_type: "image/jpeg";
  byte_size: number;
  width: number;
  height: number;
  card_byte_size: number;
  card_width: number;
  card_height: number;
  user_selected_at: null;
};

export type SeedOnboardingVictoryMilestonesDeps = {
  loadCompletedAt?: (clerkUserId: string) => Promise<string | null>;
  insertWin?: (
    row: WinInsertRow
  ) => Promise<
    | { ok: true; id: string }
    | { ok: false; unique: true }
    | { ok: false; unique: false; error: string }
  >;
  findWinIdByIdempotencyKey?: (idempotencyKey: string) => Promise<string | null>;
  readSourceFile?: (absolutePath: string) => Promise<Buffer>;
  normalize?: (bytes: Buffer) => Promise<NormalizeVictoryImageResult>;
  uploadObject?: (args: {
    bucket: string;
    path: string;
    bytes: Buffer;
    contentType: string;
  }) => Promise<void>;
  insertMedia?: (
    row: MediaInsertRow
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  removeObjects?: (args: { bucket: string; paths: string[] }) => Promise<void>;
  createMediaId?: () => string;
};

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("duplicate key") || msg.includes("unique constraint");
}

function milestoneIdempotencyKey(clerkUserId: string, key: OnboardingVictoryMilestoneKey): string {
  return `win_v1:onboarding:${clerkUserId}:${key}`;
}

function assetPath(filename: string): string {
  return path.join(ASSET_DIR, filename);
}

export function buildOnboardingVictoryWinRow(args: {
  clerkUserId: string;
  title: string;
  idempotencyKey: string;
  occurredAt: string;
}): WinInsertRow {
  return {
    clerk_user_id: args.clerkUserId,
    source_type: "system_event",
    source_message_sid: null,
    source_message_id: null,
    source_event_id: null,
    commitment_id: null,
    occurred_at: args.occurredAt,
    action_fact: args.title,
    why_meaningful: null,
    display_title: args.title,
    display_body: args.title,
    display_body_is_archival_detail: false,
    supporting_quote: null,
    relationship_type: "goal",
    recognition_mode: "coach_recognized",
    user_expressed_pride: false,
    identity_related: false,
    sensitivity_caution: false,
    celebration_appropriate: false,
    status: "active",
    candidate_ordinal: 0,
    idempotency_key: args.idempotencyKey,
    schema_version: "win_v1",
    model_confidence: null,
    win_kind: "proud_moment",
  };
}

async function defaultLoadCompletedAt(clerkUserId: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("user_profiles")
    .select("identity_intake_completed_at")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  if (error) {
    throw new Error("profile_read_failed");
  }
  const raw = data?.identity_intake_completed_at;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function defaultInsertWin(
  row: WinInsertRow
): Promise<
  | { ok: true; id: string }
  | { ok: false; unique: true }
  | { ok: false; unique: false; error: string }
> {
  const { data, error } = await supabaseServer.from("v2_win").insert(row).select("id").maybeSingle();
  if (!error && data?.id) {
    return { ok: true, id: typeof data.id === "string" ? data.id : String(data.id) };
  }
  if (isUniqueViolation(error)) return { ok: false, unique: true };
  return { ok: false, unique: false, error: error?.message ?? "insert_failed" };
}

async function defaultFindWinId(idempotencyKey: string): Promise<string | null> {
  const { data, error } = await supabaseServer
    .from("v2_win")
    .select("id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error || !data?.id) return null;
  return typeof data.id === "string" ? data.id : String(data.id);
}

async function defaultUpload(args: {
  bucket: string;
  path: string;
  bytes: Buffer;
  contentType: string;
}): Promise<void> {
  const { error } = await supabaseServer.storage.from(args.bucket).upload(args.path, args.bytes, {
    contentType: args.contentType,
    upsert: false,
  });
  if (error) throw new Error("storage_upload_failed");
}

async function defaultInsertMedia(
  row: MediaInsertRow
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabaseServer.from("v2_win_media").insert(row);
  if (!error) return { ok: true };
  return { ok: false, error: error.message ?? "media_insert_failed" };
}

async function defaultRemove(args: { bucket: string; paths: string[] }): Promise<void> {
  if (args.paths.length === 0) return;
  await supabaseServer.storage.from(args.bucket).remove(args.paths);
}

function skipped(
  skip: SeedOnboardingVictoryMilestonesResult["skip"]
): SeedOnboardingVictoryMilestonesResult {
  return { seeded: false, skip, completedAt: null, milestones: [] };
}

function notAttached(
  milestoneKey: OnboardingVictoryMilestoneKey,
  persistence: OnboardingVictoryMilestoneResult["persistence"],
  winId: string | null
): OnboardingVictoryMilestoneResult {
  return {
    milestoneKey,
    winId,
    persistence,
    image: "not_attached",
    imageFailure: null,
  };
}

async function attachImageForNewWin(args: {
  clerkUserId: string;
  winId: string;
  filename: string;
  deps: Required<
    Pick<
      SeedOnboardingVictoryMilestonesDeps,
      "readSourceFile" | "normalize" | "uploadObject" | "insertMedia" | "removeObjects" | "createMediaId"
    >
  >;
}): Promise<{ image: "attached" | "not_attached"; imageFailure: string | null }> {
  const mediaId = args.deps.createMediaId();
  let masterPath: string;
  let cardPath: string;
  try {
    masterPath = victoryMediaMasterPath(args.clerkUserId, mediaId);
    cardPath = victoryMediaCardPath(args.clerkUserId, mediaId);
  } catch (err) {
    return {
      image: "not_attached",
      imageFailure: err instanceof Error ? err.message : "invalid_storage_path",
    };
  }

  let normalized: NormalizeVictoryImageResult;
  try {
    const bytes = await args.deps.readSourceFile(assetPath(args.filename));
    normalized = await args.deps.normalize(bytes);
  } catch (err) {
    return {
      image: "not_attached",
      imageFailure: err instanceof Error ? err.message : "image_read_failed",
    };
  }
  if (!normalized.ok) {
    return { image: "not_attached", imageFailure: normalized.code };
  }

  const uploaded: string[] = [];
  try {
    await args.deps.uploadObject({
      bucket: VICTORY_MEDIA_BUCKET,
      path: masterPath,
      bytes: normalized.master.bytes,
      contentType: "image/jpeg",
    });
    uploaded.push(masterPath);
    await args.deps.uploadObject({
      bucket: VICTORY_MEDIA_BUCKET,
      path: cardPath,
      bytes: normalized.card.bytes,
      contentType: "image/jpeg",
    });
    uploaded.push(cardPath);
  } catch (err) {
    await args.deps.removeObjects({ bucket: VICTORY_MEDIA_BUCKET, paths: uploaded }).catch(() => undefined);
    return {
      image: "not_attached",
      imageFailure: err instanceof Error ? err.message : "storage_upload_failed",
    };
  }

  const media = await args.deps.insertMedia({
    id: mediaId,
    win_id: args.winId,
    clerk_user_id: args.clerkUserId,
    source_type: "web_upload",
    source_message_sid: null,
    source_media_ordinal: null,
    twilio_media_sid: null,
    storage_master_path: masterPath,
    storage_card_path: cardPath,
    mime_type: "image/jpeg",
    byte_size: normalized.master.byteSize,
    width: normalized.master.width,
    height: normalized.master.height,
    card_byte_size: normalized.card.byteSize,
    card_width: normalized.card.width,
    card_height: normalized.card.height,
    user_selected_at: null,
  });
  if (!media.ok) {
    await args.deps.removeObjects({ bucket: VICTORY_MEDIA_BUCKET, paths: uploaded }).catch(() => undefined);
    return { image: "not_attached", imageFailure: media.error };
  }
  return { image: "attached", imageFailure: null };
}

/**
 * Seed the three onboarding Proud Moments for one member.
 * Does not throw for cutoff, duplicate, hidden, or image failures.
 */
export async function seedOnboardingVictoryMilestones(
  args: { clerkUserId: string; cutoffIso?: string },
  deps: SeedOnboardingVictoryMilestonesDeps = {}
): Promise<SeedOnboardingVictoryMilestonesResult> {
  const clerkUserId = typeof args.clerkUserId === "string" ? args.clerkUserId.trim() : "";
  if (!clerkUserId) return skipped("invalid_user");

  const cutoffIso = (args.cutoffIso ?? ONBOARDING_VICTORY_MILESTONE_CUTOFF_ISO).trim();
  const cutoffMs = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoffMs)) return skipped("before_cutoff");

  const loadCompletedAt = deps.loadCompletedAt ?? defaultLoadCompletedAt;
  let completedAt: string | null;
  try {
    completedAt = await loadCompletedAt(clerkUserId);
  } catch (err) {
    console.warn("[onboarding_victory_milestone_profile_read_failed]", {
      message: err instanceof Error ? err.message.slice(0, 120) : "unknown",
    });
    return skipped("profile_read_failed");
  }
  if (!completedAt) return skipped("missing_completed_at");
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(completedMs) || completedMs < cutoffMs) {
    return { seeded: false, skip: "before_cutoff", completedAt, milestones: [] };
  }

  const insertWin = deps.insertWin ?? defaultInsertWin;
  const findWinIdByIdempotencyKey = deps.findWinIdByIdempotencyKey ?? defaultFindWinId;
  const imageDeps = {
    readSourceFile: deps.readSourceFile ?? readFile,
    normalize:
      deps.normalize ??
      ((bytes: Buffer) => normalizeVictoryImage({ source: { kind: "bytes", bytes } })),
    uploadObject: deps.uploadObject ?? defaultUpload,
    insertMedia: deps.insertMedia ?? defaultInsertMedia,
    removeObjects: deps.removeObjects ?? defaultRemove,
    createMediaId: deps.createMediaId ?? randomUUID,
  };

  const milestones: OnboardingVictoryMilestoneResult[] = [];
  for (const milestone of ONBOARDING_VICTORY_MILESTONES) {
    const idempotencyKey = milestoneIdempotencyKey(clerkUserId, milestone.key);
    const row = buildOnboardingVictoryWinRow({
      clerkUserId,
      title: milestone.title,
      idempotencyKey,
      occurredAt: completedAt,
    });

    let winId: string | null = null;
    let persistence: OnboardingVictoryMilestoneResult["persistence"] = "failed";
    try {
      const inserted = await insertWin(row);
      if (inserted.ok) {
        winId = inserted.id;
        persistence = "inserted";
      } else if (inserted.unique) {
        winId = await findWinIdByIdempotencyKey(idempotencyKey);
        persistence = winId ? "existing" : "failed";
      } else {
        persistence = "failed";
        console.warn("[onboarding_victory_milestone_insert_failed]", {
          milestone: milestone.key,
          message: inserted.error.slice(0, 120),
        });
      }
    } catch (err) {
      persistence = "failed";
      console.warn("[onboarding_victory_milestone_insert_failed]", {
        milestone: milestone.key,
        message: err instanceof Error ? err.message.slice(0, 120) : "unknown",
      });
    }

    if (persistence !== "inserted" || !winId) {
      milestones.push(notAttached(milestone.key, persistence, winId));
      continue;
    }

    try {
      const image = await attachImageForNewWin({
        clerkUserId,
        winId,
        filename: milestone.filename,
        deps: imageDeps,
      });
      if (image.imageFailure) {
        console.warn("[onboarding_victory_milestone_image_failed]", {
          milestone: milestone.key,
          message: image.imageFailure.slice(0, 120),
        });
      }
      milestones.push({
        milestoneKey: milestone.key,
        winId,
        persistence: "inserted",
        image: image.image,
        imageFailure: image.imageFailure,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "image_failed";
      console.warn("[onboarding_victory_milestone_image_failed]", {
        milestone: milestone.key,
        message: message.slice(0, 120),
      });
      milestones.push({
        milestoneKey: milestone.key,
        winId,
        persistence: "inserted",
        image: "not_attached",
        imageFailure: message,
      });
    }
  }

  return { seeded: true, skip: null, completedAt, milestones };
}
