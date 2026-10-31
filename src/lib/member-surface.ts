export const MEMBER_SURFACES = ["dashboard", "ask_pat", "film_room", "programs"] as const;

export type MemberSurface = (typeof MEMBER_SURFACES)[number];

export function isMemberSurface(value: unknown): value is MemberSurface {
  return typeof value === "string" && (MEMBER_SURFACES as readonly string[]).includes(value);
}
