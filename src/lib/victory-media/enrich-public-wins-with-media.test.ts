import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}));

import {
  enrichPublicWinsWithMedia,
  type EnrichPublicWinsWithMediaDeps,
} from "@/lib/victory-media/enrich-public-wins-with-media";
import { VICTORY_MEDIA_SIGNED_READ_TTL_SECONDS } from "@/lib/victory-media/constants";
import type { PublicWinDto } from "@/lib/v2-win-public-read";

const USER = "user_abc";
const WIN_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const WIN_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const MEDIA_A = "11111111-1111-4111-8111-111111111111";
const MEDIA_B = "22222222-2222-4222-8222-222222222222";
const CARD_A = `${USER}/${MEDIA_A}/card.jpg`;
const CARD_B = `${USER}/${MEDIA_B}/card.jpg`;
const URL_A = `https://example.supabase.co/storage/v1/object/sign/victory-media/${CARD_A}?token=a`;
const URL_B = `https://example.supabase.co/storage/v1/object/sign/victory-media/${CARD_B}?token=b`;

function win(id: string, overrides: Partial<PublicWinDto> = {}): PublicWinDto {
  return {
    id,
    occurredAt: "2026-08-01T12:00:00.000Z",
    displayTitle: "Title",
    displayBody: "Body",
    supportingQuote: null,
    celebrationAppropriate: true,
    commitmentId: null,
    updatedAt: "2026-08-01T12:05:00.000Z",
    ...overrides,
  };
}

function mediaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MEDIA_A,
    win_id: WIN_A,
    clerk_user_id: USER,
    storage_card_path: CARD_A,
    card_width: 1280,
    card_height: 960,
    ...overrides,
  };
}

describe("enrichPublicWinsWithMedia", () => {
  let listMediaForWins: ReturnType<typeof vi.fn>;
  let createSignedUrls: ReturnType<typeof vi.fn>;
  let deps: EnrichPublicWinsWithMediaDeps;

  beforeEach(() => {
    listMediaForWins = vi.fn();
    createSignedUrls = vi.fn();
    deps = {
      listMediaForWins: listMediaForWins as EnrichPublicWinsWithMediaDeps["listMediaForWins"],
      createSignedUrls: createSignedUrls as EnrichPublicWinsWithMediaDeps["createSignedUrls"],
    };
  });

  it("1. empty wins => no DB/storage calls", async () => {
    const out = await enrichPublicWinsWithMedia({ clerkUserId: USER, wins: [] }, deps);
    expect(out).toEqual([]);
    expect(listMediaForWins).not.toHaveBeenCalled();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("2. no media rows => unchanged wins", async () => {
    listMediaForWins.mockResolvedValue([]);
    const wins = [win(WIN_A), win(WIN_B)];
    const out = await enrichPublicWinsWithMedia({ clerkUserId: USER, wins }, deps);
    expect(out).toEqual(wins);
    expect(out[0]?.media).toBeUndefined();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("3–5. valid media attaches card URL; master never requested; TTL 3600", async () => {
    listMediaForWins.mockResolvedValue([mediaRow()]);
    createSignedUrls.mockResolvedValue({
      data: [{ error: null, path: CARD_A, signedUrl: URL_A }],
      error: null,
    });

    const out = await enrichPublicWinsWithMedia(
      { clerkUserId: USER, wins: [win(WIN_A)] },
      deps
    );

    expect(listMediaForWins).toHaveBeenCalledWith({
      clerkUserId: USER,
      winIds: [WIN_A],
    });
    expect(createSignedUrls).toHaveBeenCalledWith(
      [CARD_A],
      VICTORY_MEDIA_SIGNED_READ_TTL_SECONDS
    );
    expect(VICTORY_MEDIA_SIGNED_READ_TTL_SECONDS).toBe(3600);
    expect(out[0]?.media).toEqual({
      id: MEDIA_A,
      cardUrl: URL_A,
      width: 1280,
      height: 960,
    });
    const mediaJson = JSON.stringify(out[0]?.media);
    expect(mediaJson).not.toContain("master");
    expect(mediaJson).not.toContain("storage_card_path");
    expect(mediaJson).not.toContain("storage_master_path");
    expect(mediaJson).not.toContain("clerk_user_id");
  });

  it("6–7. owner filter + win_id limited to loaded wins (deps receive exact args)", async () => {
    listMediaForWins.mockResolvedValue([]);
    await enrichPublicWinsWithMedia(
      { clerkUserId: USER, wins: [win(WIN_A), win(WIN_B)] },
      deps
    );
    expect(listMediaForWins).toHaveBeenCalledWith({
      clerkUserId: USER,
      winIds: [WIN_A, WIN_B],
    });
  });

  it("8. foreign media ignored (wrong clerk or win_id)", async () => {
    listMediaForWins.mockResolvedValue([
      mediaRow({ clerk_user_id: "other_user" }),
      mediaRow({
        id: MEDIA_B,
        win_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
        storage_card_path: CARD_B,
      }),
    ]);
    const wins = [win(WIN_A)];
    const out = await enrichPublicWinsWithMedia({ clerkUserId: USER, wins }, deps);
    expect(out).toEqual(wins);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("9. malformed dimensions ignored", async () => {
    listMediaForWins.mockResolvedValue([
      mediaRow({ card_width: 0, card_height: 960 }),
      mediaRow({ card_width: 1280, card_height: -1 }),
      mediaRow({ card_width: 12.5, card_height: 10 }),
      mediaRow({ storage_card_path: "  " }),
    ]);
    const wins = [win(WIN_A)];
    const out = await enrichPublicWinsWithMedia({ clerkUserId: USER, wins }, deps);
    expect(out).toEqual(wins);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("10. media query failure => original wins", async () => {
    listMediaForWins.mockResolvedValue(null);
    const wins = [win(WIN_A)];
    const out = await enrichPublicWinsWithMedia({ clerkUserId: USER, wins }, deps);
    expect(out).toBe(wins);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("10b. media query throw => original wins", async () => {
    listMediaForWins.mockRejectedValue(new Error("db down"));
    const wins = [win(WIN_A)];
    const out = await enrichPublicWinsWithMedia({ clerkUserId: USER, wins }, deps);
    expect(out).toBe(wins);
  });

  it("11. signing top-level failure => original wins", async () => {
    listMediaForWins.mockResolvedValue([mediaRow()]);
    createSignedUrls.mockResolvedValue({
      data: null,
      error: { message: "sign failed" },
    });
    const wins = [win(WIN_A)];
    const out = await enrichPublicWinsWithMedia({ clerkUserId: USER, wins }, deps);
    expect(out).toEqual(wins);
    expect(out[0]?.media).toBeUndefined();
  });

  it("12. one per-path sign failure => only that Win missing media", async () => {
    listMediaForWins.mockResolvedValue([
      mediaRow(),
      mediaRow({
        id: MEDIA_B,
        win_id: WIN_B,
        storage_card_path: CARD_B,
        card_width: 800,
        card_height: 600,
      }),
    ]);
    createSignedUrls.mockResolvedValue({
      data: [
        { error: "Object not found", path: CARD_A, signedUrl: "" },
        { error: null, path: CARD_B, signedUrl: URL_B },
      ],
      error: null,
    });

    const out = await enrichPublicWinsWithMedia(
      { clerkUserId: USER, wins: [win(WIN_A), win(WIN_B)] },
      deps
    );

    expect(out[0]?.media).toBeUndefined();
    expect(out[1]?.media).toEqual({
      id: MEDIA_B,
      cardUrl: URL_B,
      width: 800,
      height: 600,
    });
  });

  it("13–14. multiple rows => one createSignedUrls; map independent of order", async () => {
    listMediaForWins.mockResolvedValue([
      mediaRow(),
      mediaRow({
        id: MEDIA_B,
        win_id: WIN_B,
        storage_card_path: CARD_B,
        card_width: 640,
        card_height: 480,
      }),
    ]);
    createSignedUrls.mockResolvedValue({
      data: [
        { error: null, path: CARD_B, signedUrl: URL_B },
        { error: null, path: CARD_A, signedUrl: URL_A },
      ],
      error: null,
    });

    const out = await enrichPublicWinsWithMedia(
      { clerkUserId: USER, wins: [win(WIN_A), win(WIN_B)] },
      deps
    );

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls.mock.calls[0]?.[0]).toEqual(
      expect.arrayContaining([CARD_A, CARD_B])
    );
    expect(out[0]?.media?.cardUrl).toBe(URL_A);
    expect(out[1]?.media?.cardUrl).toBe(URL_B);
  });

  it("15. raw storage path absent from returned client media", async () => {
    listMediaForWins.mockResolvedValue([mediaRow()]);
    createSignedUrls.mockResolvedValue({
      data: [{ error: null, path: CARD_A, signedUrl: URL_A }],
      error: null,
    });
    const out = await enrichPublicWinsWithMedia(
      { clerkUserId: USER, wins: [win(WIN_A)] },
      deps
    );
    expect(out[0]?.media).toBeDefined();
    expect(Object.keys(out[0]!.media!)).toEqual(["id", "cardUrl", "width", "height"]);
  });

  it("16. never mutates input wins array / no DB write surface", async () => {
    listMediaForWins.mockResolvedValue([mediaRow()]);
    createSignedUrls.mockResolvedValue({
      data: [{ error: null, path: CARD_A, signedUrl: URL_A }],
      error: null,
    });
    const wins = [win(WIN_A)];
    const out = await enrichPublicWinsWithMedia({ clerkUserId: USER, wins }, deps);
    expect(wins[0]?.media).toBeUndefined();
    expect(out[0]?.media?.cardUrl).toBe(URL_A);
    expect(out).not.toBe(wins);
  });
});
