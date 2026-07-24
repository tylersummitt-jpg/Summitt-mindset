# Google Play Data Safety — Preparation Worksheet

**Status:** Implementation-grounded draft for Play Console Data Safety.
**Last updated:** 2026-07-24
**Hard rule:** Do **not** claim “No data collected” or “No data shared.”
**Scope:** Native apps load the live Summitt Mindset product; treat in-app website collection as app-caused collection.

**Distinctions:**

- **Shared with a service provider to operate the product** ≠ sold
- **Sold** — privacy policy: we do not sell personal information
- **Advertising / tracking** — native Meta Pixel suppressed; website browser Pixel is separate

Final portal radios remain **manual entry** (**VERIFY BEFORE SUBMISSION**).

---

## Overview

| Question | Draft | Confidence |
|---|---|---|
| Collects or shares user data? | **Yes** | high |
| Encrypted in transit? | **Yes** (HTTPS/TLS) | high |
| Users can request deletion? | **Yes** — in-app + `https://summittmindset.com/data-deletion` | high |
| Independent security review? | **No** (unless later obtained) | high |

---

## Data types worksheet

Legend: Linked = linked to user identity · Shared = service-provider processing to operate product (not “sold”)

### Name

| Field | Answer |
|---|---|
| Collected? | Yes (when present) |
| Required/optional? | Optional / as provided |
| Linked? | Yes |
| Shared? | Yes — Clerk / product DB |
| Purpose | App functionality; Account management |
| Deletion? | Covered by account deletion (provider limits may apply) |
| Evidence | Privacy §1; Clerk |
| Confidence | high |

### Email address

| Field | Answer |
|---|---|
| Collected? | Yes |
| Required? | Yes (account) |
| Linked? | Yes |
| Shared? | Yes — Clerk; Resend (transactional) |
| Purpose | Account management; App functionality; Communications |
| Deletion? | Yes via account deletion / provider constraints |
| Evidence | Email-code auth; privacy §1 |
| Confidence | high |

### Phone number

| Field | Answer |
|---|---|
| Collected? | Yes if SMS opted in |
| Required? | Optional (SMS companion) |
| Linked? | Yes |
| Shared? | Yes — Twilio |
| Purpose | App functionality |
| Deletion? | Yes with SMS suppression / deletion matrix caveats |
| Evidence | Privacy §3; Twilio |
| Confidence | high |
| Note | Not every user must use SMS |

### Account / user IDs

| Field | Answer |
|---|---|
| Collected? | Yes (Clerk user ID; internal keys) |
| Required? | Yes for signed-in use |
| Linked? | Yes |
| Shared? | Yes — Supabase, Stripe metadata, etc. |
| Purpose | App functionality; Fraud prevention |
| Evidence | `clerk_user_id`; Stripe links |
| Confidence | high |

### Authentication data

| Field | Answer |
|---|---|
| Collected? | Yes (session/auth via Clerk) |
| Shared? | Yes — Clerk |
| Purpose | Account management; App functionality |
| Confidence | high |

### Journal / reflection / Current Goal / identity statement / Ask Pat content

| Field | Answer |
|---|---|
| Collected? | Yes |
| Optional? | Feature-dependent |
| Linked? | Yes |
| Shared? | Yes — Supabase; OpenAI when AI features run |
| Purpose | App functionality; Personalization |
| Evidence | Privacy §1; Ask Pat / journal APIs |
| Confidence | high |

### App activity / progress / completion

| Field | Answer |
|---|---|
| Collected? | Yes |
| Linked? | Yes |
| Shared? | Yes — Supabase; OpenAI when used |
| Purpose | App functionality; Personalization |
| Confidence | high |

### SMS messages / responses

| Field | Answer |
|---|---|
| Collected? | Yes when SMS used |
| Optional? | Yes |
| Shared? | Yes — Twilio |
| Purpose | App functionality |
| Confidence | high |

### Subscription / purchase status

| Field | Answer |
|---|---|
| Collected? | Yes |
| Shared? | Yes — Stripe |
| Purpose | App functionality; Account management |
| Notes | No Play Billing for new native purchases in V1; website Stripe for acquisition |
| Confidence | high |

### Support communications

| Field | Answer |
|---|---|
| Collected? | Yes when user emails support |
| Shared? | Email provider / support inbox |
| Purpose | Customer support |
| Confidence | high |

### Diagnostics / crash

| Field | Answer |
|---|---|
| Collected? | **No** third-party crash SDK found |
| IP / server logs | Hosting providers (Vercel) may process IP/UA as normal HTTPS — **VERIFY BEFORE SUBMISSION** how Play maps “diagnostics” |
| Confidence | high (no crash SDK); medium (log labeling) |

### Device / advertising IDs

| Field | Answer |
|---|---|
| AAID / IDFA | **No** collection found |
| Native UA markers | `SummittMindsetiOS` / `SummittMindsetAndroid` — platform detection, not advertising IDs |
| Confidence | high |

### Approximate / precise location

| Field | Answer |
|---|---|
| Collected? | No geolocation API usage found |
| Confidence | high |

### Photos / contacts / health / biometrics / etc.

| Field | Answer |
|---|---|
| Collected? | No for device sensors audited |
| Film Room | Vimeo embeds (third-party player; functionality sharing) |
| Confidence | high |

### AI prompt / context content

| Field | Answer |
|---|---|
| Collected? | Yes when AI coaching features run |
| Shared? | Yes — OpenAI as processor |
| Purpose | App functionality |
| Evidence | Privacy OpenAI disclosure; Ask Pat / SMS AI paths |
| Confidence | high |

### Video-viewing activity

| Field | Answer |
|---|---|
| Collected by Summitt? | Film selections / video IDs in product DB as applicable |
| Shared with Vimeo? | Yes — technical/playback data when player loads (`dnt=1`; not anonymous) |
| Purpose | App functionality |
| Tracking? | Not classified as Meta-style ad tracking on this evidence alone |
| Confidence | high |
| Evidence | `/privacy` §6; physical iPhone `dnt=1` PASS |

### Advertising data (Meta Pixel)

| Field | Answer |
|---|---|
| Native app | **Not collected via Meta Pixel** — suppressed for native UA (iOS physical PASS; Android engineering pass recorded) |
| Website/Safari | May collect when configured |
| Play Data Safety for **native app** | Do **not** declare Meta Pixel advertising sharing for native WebView traffic |
| Confidence | high |

### Physical address

| Field | Answer |
|---|---|
| Collected? | Yes when coach/kit shipping flows used |
| Optional? | Flow-specific |
| Confidence | high table exists; medium whether reviewer path uses it |

---

## Processors (operate product — not “sale”)

| Provider | Role | Confidence |
|---|---|---|
| Clerk | Auth | high |
| Supabase | App database | high |
| Stripe | Billing / subscriptions | high |
| Twilio | SMS | high |
| Vercel | Hosting | high |
| OpenAI | AI coaching | high |
| Resend | Transactional email | high |
| Vimeo | Embedded video | high |
| Meta | Website Pixel only (native suppressed) | high |

---

## Deletion

| Item | Answer |
|---|---|
| In-app | Account Danger Zone; inactive Membership screen |
| Web | `https://summittmindset.com/data-deletion` |
| Retained after deletion | Stripe financial; SMS STOP tombstones; deletion audit; provider logs — see `docs/account-deletion-purge-matrix.md` |

---

## Encryption

| Item | Answer | Confidence |
|---|---|---|
| In transit | HTTPS/TLS | high |
| At rest | Provider defaults — **do not invent custom crypto claims** | medium |

---

## Explicit non-claims

- Not sold as advertising data broker
- Not HIPAA / COPPA certified claims
- Not “Google approved”
- Not “no data shared”
- Provider retention schedules: **VERIFY BEFORE SUBMISSION** / counsel if needed
