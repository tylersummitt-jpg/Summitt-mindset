# Screenshot Storyboard — Five Phone Screens (V1)

**Status:** Exact V1 capture plan for Apple App Store and Google Play
**Last updated:** 2026-07-24
**Device:** **Phone only** (no iPad / tablet screenshots for V1) — `v1-platform-scope.md`

**Principle:** Sell the daily coaching relationship and member transformation—not content quantity.

---

## Shared rules

| Rule | Detail |
|---|---|
| Account | Dedicated subscribed demo account (`reviewer-test-account-plan.md`) |
| Goal shown | “Finish the first draft of my leadership plan by September 30.” |
| Must not appear | Checkout, pricing, Subscribe/Free Trial CTAs, real member PII, real phone numbers, real journals from non-demo users, admin tools, debug UI, Capacitor branding, test banners |
| Icon | Final Brooke icon preferred before upload; drafts OK earlier |
| Stores | Same five screens for **Apple and Google** |

---

## Screen 1 — Victory Room

| Field | Value |
|---|---|
| Exact screen | `/dashboard/victory-room` |
| Purpose | Hero proof of the product’s center of gravity |
| Value communicated | One serious commitment; follow-through you can see |
| Demo content | Fictional Current Goal + safe progress / proof context |
| Marketing headline | “Your Victory Room — proof you’re keeping the commitment.” |
| Hide | Pricing, empty error states, other members’ data |
| Privacy checks | Demo data only |
| Needed for | Apple + Google |

---

## Screen 2 — Today’s coaching / daily practice

| Field | Value |
|---|---|
| Exact screen | Primary daily coaching surface (Victory Room daily section or current daily practice / commitment action UI—pick the strongest “today” coaching frame) |
| Purpose | Show the daily coaching relationship |
| Value communicated | Today’s standard is clear; action is concrete |
| Demo content | Today’s coaching tied to the leadership-plan draft commitment |
| Marketing headline | “Daily coaching that keeps the standard in front of you.” |
| Hide | SMS phone numbers; purchase CTAs |
| Privacy checks | No real member SMS content |
| Needed for | Apple + Google |

---

## Screen 3 — Ask Pat

| Field | Value |
|---|---|
| Exact screen | Ask Pat member route |
| Purpose | Personalized coaching guidance |
| Value communicated | Answers grounded in *your* commitment—not generic tips |
| Demo content | Safe sample Q: protecting 25 focused minutes for the draft |
| Marketing headline | “Ask Pat — guidance grounded in your Current Goal.” |
| Hide | Errors; other users’ threads |
| Privacy checks | Demo Q&A only |
| Needed for | Apple + Google |

---

## Screen 4 — Film Room

| Field | Value |
|---|---|
| Exact screen | `/film-room` list and/or `/film-room/[id]` with player/poster visible |
| Purpose | Authorized lesson content that sharpens standards |
| Value communicated | Film Room supports the coaching relationship (not a streaming service pitch) |
| Demo content | One lesson title + player UI |
| Marketing headline | “Film Room — lessons that sharpen how you lead yourself.” |
| Hide | Broken player; blank WebView |
| Privacy checks | No unrelated PII overlays |
| Needed for | Apple + Google |

---

## Screen 5 — Progress / identity / consistency

| Field | Value |
|---|---|
| Exact screen | Identity / standards / progress surface (strongest non-legal member screen) |
| Purpose | Show consistency and the personal standard |
| Value communicated | Who you’re becoming + the bar you’re holding |
| Demo content | Identity statement + recent safe reflections summary |
| Marketing headline | “Know the standard you’re holding—and keep it.” |
| Hide | Admin tools; raw IDs; Danger Zone as hero |
| Privacy checks | Demo identity/reflections only |
| Needed for | Apple + Google |

---

## Optional (do not replace the five)

| Shot | Use? |
|---|---|
| `/app/sign-in` | At most one optional auth frame if a store requires it—do not dominate |
| Account / deletion | Trust optional only; never the hero set |

---

## Capture checklist before upload

- [ ] Phone frames only (no iPad)
- [ ] Final icon applied (or explicitly draft)
- [ ] No debug inspection chrome
- [ ] No purchase CTAs
- [ ] Demo account content only
- [ ] Headlines match store tone (coaching relationship, not LMS)

---

## Asset dependencies

Final upload waits on Brooke icon/splash where chrome is visible — `waiting-on-assets.md`.
