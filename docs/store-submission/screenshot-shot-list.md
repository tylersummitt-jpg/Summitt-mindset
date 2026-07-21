# Screenshot Shot List — Apple & Google

**Status:** Production shot list. Capture on device/simulator after final icon/branding when required.  
**Last updated:** 2026-07-21  

**Principle:** Show **signed-in product value**, not mostly auth or legal pages.

---

## Shared requirements

| Rule | Detail |
|---|---|
| Account state | **Subscribed** reviewer/demo account |
| Must appear | Real Victory Room / Ask Pat / Film Room content |
| Must not appear | Free Trial pricing, Subscribe CTA, Stripe Checkout, debug banners, Safari Web Inspector chrome, personal phone numbers of real members, other users’ private data |
| Auth screens | At most **one** optional sign-in frame; do not dominate the set |
| Brooke icon/branding | **Required first** for store-ready captures that include the home indicator / marketing frame if icon is visible; product UI screens can be captured earlier for draft, but **final upload waits on final icon** |

---

## Apple device sizes (capture targets)

Prioritize current App Store required sizes for iPhone (confirm live ASC requirements at submit time). Typical targets:

| Priority | Device class | Logical target |
|---|---|---|
| P0 | 6.7" / 6.9" iPhone | Latest large iPhone screenshots |
| P0 | 6.5" or current required second size | Per ASC |
| P1 | iPad | Only if universal; V1 may be iPhone-first — **NEEDS TYLER DECISION** |

---

## Google Play

| Priority | Size |
|---|---|
| P0 | Phone screenshots (16:9 or portal-required) |
| P1 | 7" / 10" tablet only if Android tablet supported later |

Android not in repo yet — keep the same **content** shot list for future Play listing.

---

## Shot list

### Shot 1 — Victory Room (hero)

| Field | Value |
|---|---|
| Route | `/dashboard/victory-room` (or current Victory Room path) |
| Account | Subscribed |
| Must appear | Personal Victory Room sections; commitment / wins context |
| Must not appear | Pricing, Subscribe, empty error states |
| Caption (optional) | “Your Victory Room — proof of the commitment you’re keeping.” |
| Brooke icon first? | Preferred for final; draft OK without |

### Shot 2 — Daily coaching / action experience

| Field | Value |
|---|---|
| Route | Primary daily coaching surface used by members (Victory Room daily section **or** current goal / action UI — use the screen that best shows today’s coaching action) |
| Account | Subscribed with visible today’s action / coaching content |
| Must appear | Clear daily coaching or commitment action |
| Must not appear | SMS phone numbers in cleartext if avoidable; purchase CTAs |
| Caption | “Daily coaching that keeps the commitment in front of you.” |
| Brooke icon first? | Preferred for final |

### Shot 3 — Ask Pat

| Field | Value |
|---|---|
| Route | Ask Pat member route |
| Account | Subscribed |
| Must appear | Ask Pat UI with a sample question/answer (use reviewer account content, not a real private member’s journal) |
| Must not appear | Errors; other members’ data |
| Caption | “Ask Pat — coaching answers grounded in your commitment.” |
| Brooke icon first? | Preferred for final |

### Shot 4 — Film Room

| Field | Value |
|---|---|
| Route | `/film-room` list and/or `/film-room/[id]` with Vimeo playing or poster visible |
| Account | Subscribed |
| Must appear | Film Room lesson UI; recognizable video player |
| Must not appear | Broken player; blank WebView |
| Caption | “Film Room — lessons to sharpen how you lead yourself.” |
| Brooke icon first? | Preferred for final |

### Shot 5 — Progress / identity

| Field | Value |
|---|---|
| Route | Identity / standards / progress surface used in product (e.g. commitment identity or progress summary — pick the strongest non-legal screen) |
| Account | Subscribed with filled identity/progress |
| Must appear | Personal identity or progress content |
| Must not appear | Admin tools; raw IDs |
| Caption | “Know the standard you’re holding.” |
| Brooke icon first? | Preferred for final |

### Shot 6 — Account / membership (optional)

| Field | Value |
|---|---|
| Route | `/user` **or** skip if it weakens the set |
| Account | Subscribed |
| Must appear | Account management; **optional** glimpse that deletion exists without making deletion the hero |
| Must not appear | Danger Zone as the only message; Subscribe/Checkout |
| Caption | “Manage your account — including in-app deletion when you need it.” |
| Brooke icon first? | Preferred for final |
| Use? | Optional — only if useful for trust; prefer product shots 1–5 |

### Shot 7 — Sign in (optional, max one)

| Field | Value |
|---|---|
| Route | `/app/sign-in` |
| Account | Signed out |
| Must appear | Email-code Sign in + Create account |
| Must not appear | Google button; Apple social button; pricing |
| Caption | “Sign in with an email verification code.” |
| Brooke icon first? | Yes if app icon chrome visible |

---

## Capture checklist before upload

- [ ] Final app icon applied  
- [ ] No debug inspectable affordances in Release captures  
- [ ] No personal PII from non-reviewer accounts  
- [ ] No purchase CTAs  
- [ ] Text cropped for status-bar privacy if needed  
- [ ] Captions localized only if shipping non-English (V1 English assumed)
