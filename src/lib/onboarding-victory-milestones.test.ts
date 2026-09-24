import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: { from: vi.fn(), storage: { from: vi.fn() } },
}));

import { selectHistoricalWinCandidateRows } from "@/lib/historical-win-evidence-load";
import {
  ONBOARDING_VICTORY_MILESTONE_CUTOFF_ISO,
  ONBOARDING_VICTORY_MILESTONES,
  buildOnboardingVictoryWinRow,
  seedOnboardingVictoryMilestones,
  type SeedOnboardingVictoryMilestonesDeps,
} from "@/lib/onboarding-victory-milestones";
import { victoryMediaCardPath, victoryMediaMasterPath } from "@/lib/victory-media/storage-paths";
import { publicWinCardDisplayBody } from "@/lib/v2-win-public-read";
import type { NormalizeVictoryImageResult } from "@/lib/victory-media/image-types";

const COMPLETED_AT = "2026-09-24T18:04:05.123Z";
const CUTOFF = "2026-09-24T15:00:00.000Z";
const HELPER_SRC = readFileSync(
  path.join(process.cwd(), "src/lib/onboarding-victory-milestones.ts"),
  "utf8"
);

type StoredWin = ReturnType<typeof buildOnboardingVictoryWinRow> & { id: string };

function jpegAsset(): NormalizeVictoryImageResult {
  return {
    ok: true,
    master: {
      bytes: Buffer.from([0xff, 0xd8, 0xff]),
      mime: "image/jpeg",
      width: 2048,
      height: 1536,
      byteSize: 3,
    },
    card: {
      bytes: Buffer.from([0xff, 0xd8]),
      mime: "image/jpeg",
      width: 1280,
      height: 960,
      byteSize: 2,
    },
    source: { sniffedFormat: "jpeg", usedHeicBridge: false },
  };
}

function harness(completedAt: string | null = COMPLETED_AT) {
  const wins: StoredWin[] = [];
  const media: Array<Record<string, unknown>> = [];
  const uploads: string[] = [];
  const reads: string[] = [];
  let seq = 0;
  const removed: string[][] = [];

  const deps: SeedOnboardingVictoryMilestonesDeps = {
    loadCompletedAt: async () => completedAt,
    insertWin: async (row) => {
      const existing = wins.find((w) => w.idempotency_key === row.idempotency_key);
      if (existing) return { ok: false, unique: true };
      seq += 1;
      const id = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
      wins.push({ ...row, id });
      return { ok: true, id };
    },
    findWinIdByIdempotencyKey: async (key) =>
      wins.find((w) => w.idempotency_key === key)?.id ?? null,
    readSourceFile: async (absolutePath) => {
      reads.push(absolutePath);
      return Buffer.from("source");
    },
    normalize: async () => jpegAsset(),
    uploadObject: async ({ path: objectPath }) => {
      uploads.push(objectPath);
    },
    insertMedia: async (row) => {
      media.push(row);
      return { ok: true };
    },
    removeObjects: async ({ paths }) => {
      removed.push(paths);
    },
    createMediaId: () => `00000000-0000-4000-8000-${String(100 + media.length + uploads.length).padStart(12, "0")}`,
  };

  return { wins, media, uploads, reads, removed, deps };
}

describe("seedOnboardingVictoryMilestones", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates exactly three proud moments with one shared completion timestamp", async () => {
    const h = harness();
    const result = await seedOnboardingVictoryMilestones(
      { clerkUserId: "user_new", cutoffIso: CUTOFF },
      h.deps
    );

    expect(result.seeded).toBe(true);
    expect(result.skip).toBeNull();
    expect(result.completedAt).toBe(COMPLETED_AT);
    expect(h.wins).toHaveLength(3);
    expect(h.wins.map((w) => w.display_title)).toEqual([
      "Joined Summitt Mindset",
      "Created Identity Statement",
      "Set First Goal",
    ]);
    expect(h.wins.every((w) => w.win_kind === "proud_moment")).toBe(true);
    expect(h.wins.some((w) => (w.win_kind as string) === "goal_win")).toBe(false);
    expect(new Set(h.wins.map((w) => w.occurred_at))).toEqual(new Set([COMPLETED_AT]));
    expect(h.wins.every((w) => w.occurred_at === COMPLETED_AT)).toBe(true);
    expect(HELPER_SRC).not.toContain("user_identity_version");
    expect(HELPER_SRC).not.toContain("v2_commitment");
    expect(HELPER_SRC).not.toContain("now()");
    for (const win of h.wins) {
      expect(win.display_body).toBe(win.display_title);
      expect(win.action_fact).toBe(win.display_title);
      expect(win.commitment_id).toBeNull();
      expect(win.source_type).toBe("system_event");
      expect(win.relationship_type).toBe("goal");
      expect(win.display_body_is_archival_detail).toBe(false);
      expect(win.celebration_appropriate).toBe(false);
      expect(win.schema_version).toBe("win_v1");
    }
    expect(result.milestones.map((m) => m.persistence)).toEqual([
      "inserted",
      "inserted",
      "inserted",
    ]);
    expect(result.milestones.every((m) => m.image === "attached" && m.imageFailure === null)).toBe(
      true
    );
    expect(result.milestones.map((m) => m.winId)).toEqual(h.wins.map((w) => w.id));
  });

  it("does not seed before the cutoff or when completion is missing", async () => {
    const early = harness("2026-09-24T14:59:59.999Z");
    const earlyResult = await seedOnboardingVictoryMilestones(
      { clerkUserId: "user_old", cutoffIso: CUTOFF },
      early.deps
    );
    expect(earlyResult).toMatchObject({ seeded: false, skip: "before_cutoff" });
    expect(early.wins).toHaveLength(0);

    const missing = harness(null);
    const missingResult = await seedOnboardingVictoryMilestones(
      { clerkUserId: "user_none", cutoffIso: CUTOFF },
      missing.deps
    );
    expect(missingResult).toMatchObject({ seeded: false, skip: "missing_completed_at" });
    expect(missing.wins).toHaveLength(0);

    const invalid = await seedOnboardingVictoryMilestones({ clerkUserId: "  " }, early.deps);
    expect(invalid.skip).toBe("invalid_user");
  });

  it("treats an equal cutoff instant as eligible", async () => {
    const h = harness(CUTOFF);
    const result = await seedOnboardingVictoryMilestones(
      { clerkUserId: "user_edge", cutoffIso: CUTOFF },
      h.deps
    );
    expect(result.seeded).toBe(true);
    expect(h.wins).toHaveLength(3);
    expect(h.wins.every((w) => w.occurred_at === CUTOFF)).toBe(true);
  });

  it("does not duplicate, update, or attach media on a second call", async () => {
    const h = harness();
    await seedOnboardingVictoryMilestones({ clerkUserId: "user_new", cutoffIso: CUTOFF }, h.deps);
    const uploadsAfterFirst = h.uploads.length;
    const mediaAfterFirst = h.media.length;
    h.reads.length = 0;

    const again = await seedOnboardingVictoryMilestones(
      { clerkUserId: "user_new", cutoffIso: CUTOFF },
      h.deps
    );

    expect(h.wins).toHaveLength(3);
    expect(again.milestones.map((m) => m.persistence)).toEqual(["existing", "existing", "existing"]);
    expect(again.milestones.every((m) => m.image === "not_attached")).toBe(true);
    expect(h.uploads).toHaveLength(uploadsAfterFirst);
    expect(h.media).toHaveLength(mediaAfterFirst);
    expect(h.reads).toHaveLength(0);
    expect(HELPER_SRC).not.toContain(".update(");
  });

  it("keeps a hidden row hidden when the unique key already exists", async () => {
    const h = harness();
    await seedOnboardingVictoryMilestones({ clerkUserId: "user_new", cutoffIso: CUTOFF }, h.deps);
    const hidden = h.wins[0]!;
    (hidden as { status: string }).status = "hidden";
    const before = { ...hidden };

    const again = await seedOnboardingVictoryMilestones(
      { clerkUserId: "user_new", cutoffIso: CUTOFF },
      h.deps
    );

    expect(again.milestones[0]).toMatchObject({
      persistence: "existing",
      winId: hidden.id,
      image: "not_attached",
      imageFailure: null,
    });
    expect(h.wins[0]).toEqual(before);
  });

  it("handles a unique violation without writing the existing row", async () => {
    const h = harness();
    h.deps.insertWin = async () => ({ ok: false, unique: true });
    h.deps.findWinIdByIdempotencyKey = async (key) =>
      key.endsWith(":joined") ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : null;

    const result = await seedOnboardingVictoryMilestones(
      { clerkUserId: "user_race", cutoffIso: CUTOFF },
      h.deps
    );

    expect(result.milestones[0]).toMatchObject({
      persistence: "existing",
      winId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      image: "not_attached",
    });
    expect(h.uploads).toHaveLength(0);
    expect(h.media).toHaveLength(0);
  });

  it("leaves the text win in place when one image fails and still seeds the others", async () => {
    const h = harness();
    h.deps.normalize = async (bytes) => {
      if (bytes.toString() === "source") {
        const call = h.reads.length;
        if (call === 2) return { ok: false, code: "decode_failed" };
      }
      return jpegAsset();
    };

    const result = await seedOnboardingVictoryMilestones(
      { clerkUserId: "user_new", cutoffIso: CUTOFF },
      h.deps
    );

    expect(h.wins).toHaveLength(3);
    expect(result.milestones.map((m) => m.persistence)).toEqual([
      "inserted",
      "inserted",
      "inserted",
    ]);
    expect(result.milestones[1]).toMatchObject({
      image: "not_attached",
      imageFailure: "decode_failed",
    });
    expect(result.milestones[0]?.image).toBe("attached");
    expect(result.milestones[2]?.image).toBe("attached");
    expect(h.media).toHaveLength(2);
    expect(h.wins.map((w) => w.display_title)).toEqual([
      "Joined Summitt Mindset",
      "Created Identity Statement",
      "Set First Goal",
    ]);
  });

  it("does not roll back a win when storage upload fails", async () => {
    const h = harness();
    h.deps.uploadObject = async ({ path: objectPath }) => {
      if (objectPath.includes("master")) throw new Error("storage_upload_failed");
      h.uploads.push(objectPath);
    };
    const result = await seedOnboardingVictoryMilestones(
      { clerkUserId: "user_new", cutoffIso: CUTOFF },
      h.deps
    );
    expect(h.wins).toHaveLength(3);
    expect(result.milestones.every((m) => m.persistence === "inserted")).toBe(true);
    expect(result.milestones.every((m) => m.image === "not_attached")).toBe(true);
    expect(h.media).toHaveLength(0);
  });

  it("stores a distinct private path per user and maps each source file", async () => {
    const a = harness();
    const b = harness();
    await seedOnboardingVictoryMilestones({ clerkUserId: "user_aaa", cutoffIso: CUTOFF }, a.deps);
    await seedOnboardingVictoryMilestones({ clerkUserId: "user_bbb", cutoffIso: CUTOFF }, b.deps);

    expect(a.uploads.every((p) => p.startsWith("user_aaa/"))).toBe(true);
    expect(b.uploads.every((p) => p.startsWith("user_bbb/"))).toBe(true);
    expect(a.uploads.some((p) => b.uploads.includes(p))).toBe(false);

    const joinedId = String(a.media[0]?.id);
    expect(a.media[0]).toMatchObject({
      source_type: "web_upload",
      source_message_sid: null,
      source_media_ordinal: null,
      mime_type: "image/jpeg",
      storage_master_path: victoryMediaMasterPath("user_aaa", joinedId),
      storage_card_path: victoryMediaCardPath("user_aaa", joinedId),
    });

    const assetRoot = path.join(
      process.cwd(),
      "src/lib/onboarding-victory-milestones/assets"
    );
    expect(a.reads).toEqual([
      path.join(assetRoot, "joined-summitt-mindset.jpg"),
      path.join(assetRoot, "created-identity-statement.jpg"),
      path.join(assetRoot, "set-first-goal.jpg"),
    ]);
    expect(ONBOARDING_VICTORY_MILESTONES.map((m) => [m.title, m.filename])).toEqual([
      ["Joined Summitt Mindset", "joined-summitt-mindset.jpg"],
      ["Created Identity Statement", "created-identity-statement.jpg"],
      ["Set First Goal", "set-first-goal.jpg"],
    ]);
    for (const filename of [
      "joined-summitt-mindset.jpg",
      "created-identity-statement.jpg",
      "set-first-goal.jpg",
    ]) {
      expect(readFileSync(path.join(assetRoot, filename)).byteLength).toBeGreaterThan(0);
    }
  });

  it("matches current Victory Room, season, coaching, and photo-request readers", () => {
    const row = buildOnboardingVictoryWinRow({
      clerkUserId: "user_new",
      title: "Joined Summitt Mindset",
      idempotencyKey: "win_v1:onboarding:user_new:joined",
      occurredAt: COMPLETED_AT,
    });
    expect(
      publicWinCardDisplayBody({
        displayBody: row.display_body,
        sourceType: row.source_type,
        userEditedAt: null,
        displayBodyIsArchivalDetail: row.display_body_is_archival_detail,
      })
    ).toBe("");
    expect(row.win_kind).toBe("proud_moment");
    expect(row.commitment_id).toBeNull();

    const selected = selectHistoricalWinCandidateRows({
      currentChapterId: "chapter-1",
      priorChapters: [],
      wins: [
        {
          id: "w1",
          occurred_at: COMPLETED_AT,
          action_fact: row.action_fact,
          supporting_quote: null,
          relationship_type: row.relationship_type,
          commitment_id: null,
          source_message_sid: null,
          sensitivity_caution: false,
        },
      ],
    });
    expect(selected).toEqual([]);

    expect(HELPER_SRC).not.toContain("photo_request");
    expect(HELPER_SRC).not.toContain("v2_commitment_event");
    expect(HELPER_SRC).not.toContain("user_yes");
    const seasonSrc = readFileSync(
      path.join(process.cwd(), "src/lib/v2-victory-season-wins.ts"),
      "utf8"
    );
    expect(seasonSrc).toContain('.eq("commitment_id", commitmentId)');
    const roomSrc = readFileSync(
      path.join(process.cwd(), "src/app/dashboard/victory-room/page.tsx"),
      "utf8"
    );
    expect(roomSrc).toContain("recentLimit: 3");
    expect(HELPER_SRC).not.toMatch(/CREATE TABLE|ALTER TABLE|migration/i);
    expect(ONBOARDING_VICTORY_MILESTONE_CUTOFF_ISO).toBe("2026-09-24T15:09:00.000Z");
  });
});
