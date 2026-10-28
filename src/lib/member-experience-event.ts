import "server-only";

import { supabaseServer } from "@/lib/supabase-server";
import { getDateKeyInTimezone, resolveUserTimezone } from "@/lib/timezone";
import { isSubscribedFromPublicMetadata } from "@/lib/onboarding-subscription-metadata";
import type { SummittMindsetPlatform } from "@/lib/native-app/platform";

export const MEMBER_EXPERIENCE_SOURCE = "member_experience" as const;

export type MemberExperienceEventType = "victory_room_visited" | "film_room_played";

export type MemberExperiencePlatform = "web" | "ios" | "android";

export type MemberExperienceWriteResult =
  | { status: "recorded" | "duplicate" }
  | { status: "rejected" | "failed" };

const LOCAL_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function memberExperiencePlatform(
  detected: SummittMindsetPlatform
): MemberExperiencePlatform {
  if (detected === "ios" || detected === "android") return detected;
  return "web";
}

export function memberExperienceLocalDay(timeZone: unknown, now = new Date()): string {
  return getDateKeyInTimezone(now, resolveUserTimezone(timeZone));
}

function validClerkId(clerkUserId: string): boolean {
  const id = clerkUserId.trim();
  return id.length > 0 && id.length <= 128 && !/\s/.test(id);
}

function validLocalDay(localDay: string): boolean {
  const match = LOCAL_DAY.exec(localDay);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validFilmId(filmId: string): boolean {
  const id = filmId.trim();
  return id.length > 0 && id.length <= 128 && !/\s/.test(id);
}

export function memberExperienceIdempotencyKey(args: {
  eventType: MemberExperienceEventType;
  clerkUserId: string;
  localDay: string;
  filmId?: string;
}): string {
  const member = encodeURIComponent(args.clerkUserId.trim());
  if (args.eventType === "film_room_played") {
    return `film_room_played:${member}:${args.localDay}:${encodeURIComponent((args.filmId ?? "").trim())}`;
  }
  return `victory_room_visited:${member}:${args.localDay}`;
}

export async function recordMemberExperienceEvent(args: {
  clerkUserId: string;
  metadata: unknown;
  eventType: MemberExperienceEventType;
  platform: MemberExperiencePlatform;
  filmId?: string;
  now?: Date;
}): Promise<MemberExperienceWriteResult> {
  if (!validClerkId(args.clerkUserId) || !isSubscribedFromPublicMetadata(args.metadata)) {
    return { status: "rejected" };
  }
  const now = args.now ?? new Date();
  const timeZone =
    args.metadata && typeof args.metadata === "object"
      ? (args.metadata as { timezone?: unknown }).timezone
      : undefined;
  const localDay = memberExperienceLocalDay(timeZone, now);
  if (!validLocalDay(localDay)) return { status: "rejected" };
  if (args.eventType === "film_room_played" && !validFilmId(args.filmId ?? "")) {
    return { status: "rejected" };
  }

  const filmId = args.filmId?.trim();
  const occurredAt = now.toISOString();
  const { error } = await supabaseServer.from("v2_event").insert({
    idempotency_key: memberExperienceIdempotencyKey({
      eventType: args.eventType,
      clerkUserId: args.clerkUserId,
      localDay,
      filmId,
    }),
    clerk_user_id: args.clerkUserId.trim(),
    event_type: args.eventType,
    source: MEMBER_EXPERIENCE_SOURCE,
    occurred_at: occurredAt,
    payload_json:
      args.eventType === "film_room_played"
        ? { platform: args.platform, filmId }
        : { platform: args.platform },
  });

  if (!error) return { status: "recorded" };
  if (error.code === "23505") return { status: "duplicate" };
  console.error("[member-experience] write failed", {
    eventType: args.eventType,
    code: error.code ?? "unknown",
  });
  return { status: "failed" };
}
