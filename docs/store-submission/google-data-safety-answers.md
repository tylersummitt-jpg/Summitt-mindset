# Google Play Data Safety — Draft Answers

**Status:** Implementation-grounded draft for Play Console Data Safety form.
**Scope:** Same product backend as iOS (website + providers). Android binary not shipped yet; answers describe the Summitt Mindset product data practices.
**Last updated:** 2026-07-21

**Hard rule:** Do **not** claim “No data collected” or “No data shared.”

---

## Overview answers

| Question | Draft | Confidence |
|---|---|---|
| Does the app collect or share user data? | **Yes** | high |
| Is all user data encrypted in transit? | **Yes** (HTTPS/TLS to production site and APIs) | high |
| Can users request deletion? | **Yes** — in-app + `https://summittmindset.com/data-deletion` | high |
| Independent security review? | **No** (unless Tyler later obtains one) | high |

---

## Data type rows

### Email address

| Field | Answer |
|---|---|
| Collected? | Yes |
| Shared? | Yes — Clerk; Resend (transactional email) |
| Optional? | No (required for account) |
| Linked to identity? / Ephemeral? | Linked; not ephemeral |
| Purposes | Account management; App functionality; Fraud prevention; Communications |
| Evidence | Clerk email-code auth; privacy §1 |
| Confidence | **high** |

### Name

| Field | Answer |
|---|---|
| Collected? | Yes (when present) |
| Shared? | Yes — Clerk / product DB |
| Optional? | Yes / as provided |
| Purposes | App functionality; Account management |
| Confidence | **high** |

### User IDs

| Field | Answer |
|---|---|
| Collected? | Yes (Clerk user ID) |
| Shared? | Yes — processors receiving user identifiers (Supabase, Stripe metadata) |
| Optional? | No for signed-in use |
| Purposes | App functionality; Fraud prevention |
| Confidence | **high** |

### Phone number

| Field | Answer |
|---|---|
| Collected? | Yes if SMS opted in |
| Shared? | Yes — Twilio |
| Optional? | Yes |
| Purposes | App functionality |
| Confidence | **high** |

### Other user-generated content (journals, Ask Pat, goals, reflections, Victory Room content)

| Field | Answer |
|---|---|
| Collected? | Yes |
| Shared? | Yes — Supabase; OpenAI when AI features run |
| Optional? | Feature-dependent |
| Purposes | App functionality; Personalization |
| Confidence | **high** |

### Messages (SMS coaching)

| Field | Answer |
|---|---|
| Collected? | Yes when SMS used |
| Shared? | Yes — Twilio |
| Optional? | Yes (opt-in) |
| Purposes | App functionality |
| Confidence | **high** |

### Purchase history / subscription info

| Field | Answer |
|---|---|
| Collected? | Yes |
| Shared? | Yes — Stripe |
| Optional? | N/A for members; inactive users may have none |
| Purposes | App functionality; Account management |
| Notes | No native Play Billing currently; website Stripe checkout for acquisition |
| Confidence | **high** |

### App interactions / product activity

| Field | Answer |
|---|---|
| Collected? | Yes (progress, summaries, coaching state) |
| Shared? | Yes — Supabase; OpenAI when used |
| Purposes | App functionality; Personalization |
| Confidence | **high** |

### Crash logs

| Field | Answer |
|---|---|
| Collected? | **No** third-party crash SDK found |
| Confidence | **high** |

### Device or other IDs (advertising ID)

| Field | Answer |
|---|---|
| Collected? | **No** advertising ID collection found in native/web product code audited |
| Confidence | **high** for no AAID usage in current iOS shell docs; revisit when Android ships |

### Approximate / precise location

| Field | Answer |
|---|---|
| Collected? | No app geolocation API usage found |
| Confidence | **high** |

### Photos, videos, audio, contacts, calendar, health, biometric, sexual orientation, etc.

| Field | Answer |
|---|---|
| Collected? | **No** for device sensors/libraries audited. Film Room plays **Vimeo** embeds (third-party player). Victory share cards can export PNG downloads (user-initiated), not photo-library scraping. |
| Confidence | **high** |

### Advertising / advertising ID data (Meta Pixel)

| Field | Answer |
|---|---|
| Collected in **native iOS app**? | **No — COMPLETE / physical PASS (2026-07-21).** Web Inspector: zero facebook/fbevents/connect.facebook rows; `typeof window.fbq === "undefined"` on Victory Room and in-app `/`. |
| Collected on **website/Safari**? | **Yes when configured** — production has `NEXT_PUBLIC_META_PIXEL_ID`; Pixel remains for normal browser traffic |
| Shared? | Yes with Meta **on the website** when enabled; **not via native WebView** |
| Purposes | Website marketing analytics / advertising measurement (browser only) |
| Confidence | **high** |
| Action | Public Privacy Policy (`/privacy`) names Meta and describes website Pixel; native Data Safety does **not** declare Meta Pixel advertising sharing in-app |

Sharing note: native advertising/analytics sharing **through Meta Pixel is not present in-app**.

### Physical address

| Field | Answer |
|---|---|
| Collected? | **Yes** when coach/kit shipping fulfillment flows are used (`coach_shipping_addresses`) |
| Shared? | Fulfillment/email providers as applicable |
| Optional? | Yes / flow-specific |
| Confidence | **high** that table exists; **medium** whether V1 reviewer path uses it |

---

## Data sharing summary (service providers)

| Provider | Role | Evidence confidence |
|---|---|---|
| Clerk | Authentication | high |
| Supabase | Application database | high |
| Stripe | Billing / subscriptions | high |
| Twilio | SMS delivery | high |
| Vercel | Hosting | high |
| OpenAI | AI coaching generation | high |
| Resend | Transactional email | high |
| Vimeo | Embedded video player for Film Room / related lessons; shared via player for **app functionality**; public `/privacy` §6; embeds use `dnt=1`. **Physical iPhone PASS (2026-07-21)** — player URL included `dnt=1`, HTTP 200, config `dnt = 1`, playback worked in WKWebView. Not anonymous/cookie-free; Vimeo still processes necessary technical/playback data. Not classified here as Meta-style advertising tracking. Final Play Console answers remain manual. | **high** (disclosure + `dnt=1` + physical PASS) |
| Meta | Pixel on **website/Safari only** (native suppressed; physical PASS 2026-07-21) | high |

Sharing is for **service provision**, not selling personal information for SMS opt-in marketing lists (privacy policy stance). Website Meta Pixel is disclosed in `/privacy`; it is **not** present in the native iOS WebView after physical PASS.

---

## Deletion

| Item | Answer |
|---|---|
| In-app path | Account → Danger Zone → Delete account (also inactive `/app/membership`) |
| Web URL | `https://summittmindset.com/data-deletion` |
| What remains after deletion | Documented retentions: Stripe financial records; SMS STOP compliance tombstones; deletion audit tombstone; provider logs (Twilio/OpenAI/etc.) per `docs/account-deletion-purge-matrix.md` |

---

## Encryption

| Item | Answer | Confidence |
|---|---|---|
| In transit | HTTPS/TLS | high |
| At rest | Provider defaults (not custom app encryption claimed) | medium |

---

## Explicit non-claims

- Not HIPAA compliant (unsupported)
- Not COPPA compliant / not directed to children (do not claim COPPA)
- Not “Google approved”
- Not “no data shared”
