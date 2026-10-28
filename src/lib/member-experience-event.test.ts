import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: (table: string) => {
      if (table !== "v2_event") throw new Error(`unexpected table ${table}`);
      return { insert: insertMock };
    },
  },
}));

import {
  memberExperienceIdempotencyKey,
  memberExperiencePlatform,
  recordMemberExperienceEvent,
} from "@/lib/member-experience-event";
import { getDateKeyInTimezone } from "@/lib/timezone";

const NOW = new Date("2026-10-28T16:00:00.000Z");
const NEXT_DAY = new Date("2026-10-29T16:00:00.000Z");
const MEMBER = {
  summittSubscribed: true,
  timezone: "America/New_York",
};

describe("member experience events", () => {
  beforeEach(() => {
    insertMock.mockReset();
    insertMock.mockResolvedValue({ error: null });
  });

  it("does not write without a Clerk id or an entitled member", async () => {
    await expect(
      recordMemberExperienceEvent({
        clerkUserId: "  ",
        metadata: MEMBER,
        eventType: "victory_room_visited",
        platform: "web",
        now: NOW,
      })
    ).resolves.toEqual({ status: "rejected" });
    await expect(
      recordMemberExperienceEvent({
        clerkUserId: "user_real",
        metadata: { summittSubscribed: false, timezone: "America/New_York" },
        eventType: "victory_room_visited",
        platform: "web",
        now: NOW,
      })
    ).resolves.toEqual({ status: "rejected" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("records one Victory Room visit per member per local day", async () => {
    const first = await recordMemberExperienceEvent({
      clerkUserId: "user_real",
      metadata: MEMBER,
      eventType: "victory_room_visited",
      platform: "ios",
      now: NOW,
    });
    insertMock.mockResolvedValueOnce({ error: { code: "23505" } });
    const second = await recordMemberExperienceEvent({
      clerkUserId: "user_real",
      metadata: MEMBER,
      eventType: "victory_room_visited",
      platform: "ios",
      now: NOW,
    });
    const day = getDateKeyInTimezone(NOW, "America/New_York");
    const key = memberExperienceIdempotencyKey({
      eventType: "victory_room_visited",
      clerkUserId: "user_real",
      localDay: day,
    });
    expect(first).toEqual({ status: "recorded" });
    expect(second).toEqual({ status: "duplicate" });
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(insertMock.mock.calls[0][0].idempotency_key).toBe(key);
    expect(insertMock.mock.calls[1][0].idempotency_key).toBe(key);
    expect(insertMock.mock.calls[0][0]).toMatchObject({
      clerk_user_id: "user_real",
      event_type: "victory_room_visited",
      source: "member_experience",
      occurred_at: NOW.toISOString(),
      payload_json: { platform: "ios" },
    });
    expect(insertMock.mock.calls[0][0].payload_json).not.toHaveProperty("filmId");
  });

  it("uses a new Victory Room key on the next local day", async () => {
    await recordMemberExperienceEvent({
      clerkUserId: "user_real",
      metadata: MEMBER,
      eventType: "victory_room_visited",
      platform: "web",
      now: NOW,
    });
    await recordMemberExperienceEvent({
      clerkUserId: "user_real",
      metadata: MEMBER,
      eventType: "victory_room_visited",
      platform: "web",
      now: NEXT_DAY,
    });
    const firstDay = getDateKeyInTimezone(NOW, "America/New_York");
    const secondDay = getDateKeyInTimezone(NEXT_DAY, "America/New_York");
    expect(firstDay).not.toBe(secondDay);
    expect(insertMock.mock.calls[0][0].idempotency_key).not.toBe(
      insertMock.mock.calls[1][0].idempotency_key
    );
  });

  it("records one Film Room play per member, video, and local day", async () => {
    await recordMemberExperienceEvent({
      clerkUserId: "user_real",
      metadata: MEMBER,
      eventType: "film_room_played",
      filmId: "film-1",
      platform: "web",
      now: NOW,
    });
    insertMock.mockResolvedValueOnce({ error: { code: "23505" } });
    const repeat = await recordMemberExperienceEvent({
      clerkUserId: "user_real",
      metadata: MEMBER,
      eventType: "film_room_played",
      filmId: "film-1",
      platform: "android",
      now: NOW,
    });
    await recordMemberExperienceEvent({
      clerkUserId: "user_real",
      metadata: MEMBER,
      eventType: "film_room_played",
      filmId: "film-2",
      platform: "web",
      now: NOW,
    });
    expect(repeat).toEqual({ status: "duplicate" });
    expect(insertMock.mock.calls[0][0].idempotency_key).toBe(
      insertMock.mock.calls[1][0].idempotency_key
    );
    expect(insertMock.mock.calls[2][0].idempotency_key).not.toBe(
      insertMock.mock.calls[0][0].idempotency_key
    );
    expect(insertMock.mock.calls[0][0].payload_json).toEqual({
      platform: "web",
      filmId: "film-1",
    });
  });

  it("does not disguise an unexpected database failure as success", async () => {
    insertMock.mockResolvedValue({ error: { code: "08006" } });
    await expect(
      recordMemberExperienceEvent({
        clerkUserId: "user_real",
        metadata: MEMBER,
        eventType: "victory_room_visited",
        platform: "web",
        now: NOW,
      })
    ).resolves.toEqual({ status: "failed" });
  });

  it("maps a browser to web and keeps a native shell token", () => {
    expect(memberExperiencePlatform("none")).toBe("web");
    expect(memberExperiencePlatform("ios")).toBe("ios");
    expect(memberExperiencePlatform("android")).toBe("android");
  });

  it("records the Victory Room visit from the entitled page and leaves the Film Room iframe in place", () => {
    const root = process.cwd();
    const victory = readFileSync(
      join(root, "src/app/dashboard/victory-room/page.tsx"),
      "utf8"
    );
    const film = readFileSync(join(root, "src/app/film-room/[id]/page.tsx"), "utf8");
    const listener = readFileSync(
      join(root, "src/components/film-room-play-listener.tsx"),
      "utf8"
    );
    const victoryBody = victory.slice(victory.indexOf("export default"));
    expect(victoryBody.indexOf("if (!user?.id)")).toBeLessThan(
      victoryBody.indexOf("isSubscribedFromPublicMetadata")
    );
    expect(victoryBody.indexOf("isSubscribedFromPublicMetadata")).toBeLessThan(
      victoryBody.indexOf("recordMemberExperienceEvent")
    );
    expect(victory).toContain('eventType: "victory_room_visited"');
    expect(film).toContain("<iframe");
    expect(film).toContain("data-film-room-player");
    expect(film).toContain("FilmRoomPlayListener");
    expect(film).not.toContain("@vimeo/player");
    expect(listener).toContain('instance.on("play"');
    expect(listener).not.toContain(".destroy(");
    expect(listener).not.toContain('.on("ready"');
  });

  it("still deletes v2_event rows during account deletion", () => {
    const directory = join(process.cwd(), "supabase/migrations");
    let latest = "";
    for (const file of readdirSync(directory).sort()) {
      if (!file.endsWith(".sql")) continue;
      const sql = readFileSync(join(directory, file), "utf8");
      if (sql.includes("FUNCTION public.purge_app_data_for_account_deletion")) {
        latest = sql;
      }
    }
    expect(latest).toContain("DELETE FROM public.v2_event WHERE clerk_user_id = v_clerk");
  });
});
