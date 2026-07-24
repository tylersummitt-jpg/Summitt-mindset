# Apple App Privacy — Preparation Worksheet

**Status:** Implementation-grounded draft for App Store Connect App Privacy.
**Last updated:** 2026-07-24
**Principle:** iPhone app is a WKWebView shell around `https://summittmindset.com`. Data collected through the live site **inside the app** counts as app-caused collection.
**Do not** answer “Data Not Collected.”

**Native PrivacyInfo (mobile repo):** may under-declare website-collected types — **VERIFY BEFORE SUBMISSION** (separate mobile task if needed).

This worksheet is **preparation, not a legal conclusion.** Final portal answers remain manual.

---

## Tracking (Apple definition)

| Question | Draft | Confidence |
|---|---|---|
| Does the **app** use data for tracking (Apple definition: linking with third parties for targeted ads / ad measurement across apps/sites)? | **Do not mark tracking merely because the website may use Meta Pixel in Safari.** Meta Pixel is **physically verified suppressed** in native-app traffic (iOS 2026-07-21). Final answer must reflect **native app** behavior + Apple definitions and a last check of other providers. | high (Meta Pixel native); medium (all-providers final) |
| Nutrition label “Used for Tracking” for Meta Pixel | **Do not attribute Meta Pixel tracking to the iOS app** | high |

---

## Contact Info

### Email

| Field | Answer |
|---|---|
| Collected? | Yes |
| Linked to identity? | Yes |
| Used for tracking? | No (by design not sent to Meta Pixel) |
| Purpose | App Functionality; Account Management; Developer Communications |
| Providers | Clerk; Resend |
| Evidence | App email-code sign-in; privacy §1 |
| Confidence | high |

### Name

| Field | Answer |
|---|---|
| Collected? | Yes when provided |
| Linked? | Yes |
| Tracking? | No |
| Purpose | App Functionality; Account Management |
| Confidence | high |

### Phone Number

| Field | Answer |
|---|---|
| Collected? | Yes when SMS opted in |
| Linked? | Yes |
| Tracking? | No |
| Required/optional? | Optional companion channel |
| Purpose | App Functionality |
| Providers | Twilio |
| Confidence | high |

---

## Identifiers

### User ID

| Field | Answer |
|---|---|
| Collected? | Yes (Clerk ID; internal FKs) |
| Linked? | Yes |
| Tracking? | No for first-party ID itself |
| Purpose | App Functionality; Fraud Prevention |
| Confidence | high |

### Device ID

| Field | Answer |
|---|---|
| IDFA? | No collection found; no ATT prompt found |
| UA markers | `SummittMindsetiOS` / `SummittMindsetAndroid` for native detection |
| IP | May be processed by hosting as normal HTTPS — usually not labeled Device ID |
| Confidence | high (no IDFA); medium (IP labeling) |

---

## Purchases

| Field | Answer |
|---|---|
| Collected? | Yes — subscription / Stripe status |
| Linked? | Yes |
| Tracking? | No |
| Purpose | App Functionality; Account Management |
| Notes | No native IAP for new subscriptions in V1; native checkout initiation blocked |
| Confidence | high |

---

## User Content

| Includes | Journals, reflections, Current Goal, identity statement, Ask Pat, Victory Room content |
|---|---|
| Collected? | Yes |
| Linked? | Yes |
| Tracking? | No |
| Purpose | App Functionality; Product Personalization |
| Shared with processors? | Supabase; OpenAI when AI runs |
| Confidence | high |

---

## Usage Data

| Field | Answer |
|---|---|
| Collected? | Yes — product activity / progress |
| Linked? | Yes |
| Tracking? | No for first-party product analytics SDK (none found); Meta Pixel not in native |
| Purpose | App Functionality; Product Personalization |
| Confidence | high |

---

## Diagnostics

| Field | Answer |
|---|---|
| Crash SDK? | None found |
| Server logs | Provider hosting may retain technical logs — **VERIFY BEFORE SUBMISSION** |
| Purpose | App Functionality / Fraud Prevention if declared |
| Confidence | medium |

---

## Sensitive Information

| Field | Answer |
|---|---|
| Collected as Apple “Sensitive Info”? | **Not intended** as health/clinical data. Coaching/commitment content may be personal — **VERIFY BEFORE SUBMISSION** against Apple category definitions; do not claim HIPAA. |
| Confidence | medium (category labeling) |

---

## Other — Vimeo (functionality)

| Field | Answer |
|---|---|
| Shared? | Yes — embedded playback technical/playback data |
| Tracking? | Not Meta-style ad tracking on this evidence alone |
| Purpose | App Functionality |
| Evidence | `/privacy` §6; `dnt=1`; physical iPhone PASS 2026-07-21 |
| Note | `dnt=1` ≠ anonymous / cookie-free |
| Confidence | high |

---

## Purposes checklist (Apple labels)

Prefer: **App Functionality**, **Account Management**, **Product Personalization**, **Developer Communications**, **Fraud Prevention**.

For the **iOS app**, do **not** select Meta Pixel **Advertising** / tracking purposes.

---

## Privacy Policy / Choices URLs

- Privacy: `https://summittmindset.com/privacy`
- Data Deletion: `https://summittmindset.com/data-deletion`
- Choices URL: optional

---

## Alignment

| Topic | Status |
|---|---|
| Meta named; native Pixel excluded | Aligned |
| Vimeo named; `dnt=1` | Aligned |
| Resend naming in policy | Optional — **TYLER DECISION REQUIRED** |
| PrivacyInfo completeness | **VERIFY BEFORE SUBMISSION** |

---

## Explicit non-claims

- Not a legal opinion
- Not “no data collected”
- Not claiming zero third-party technical processing (Vimeo/hosting)
- Website Safari Meta tooling ≠ native app tracking by itself
