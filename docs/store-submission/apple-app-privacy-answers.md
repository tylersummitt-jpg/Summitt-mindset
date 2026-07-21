# Apple App Privacy — Draft Answers

**Status:** Implementation-grounded draft. Confirm unresolved items before portal submit.  
**Principle:** The iOS app is a WKWebView shell around `https://summittmindset.com`. For questionnaire purposes, treat data collected through the live website **inside the app** as data the app causes to be collected. Do **not** answer “Data Not Collected” solely because the native binary’s `PrivacyInfo.xcprivacy` currently lists empty collected types.

**Native PrivacyInfo (mobile repo, read-only):** `NSPrivacyTracking=false`; empty `NSPrivacyCollectedDataTypes`; empty accessed APIs. That file may be **incomplete relative to website-collected data** — flagged under open items.

**Last updated:** 2026-07-21

---

## Tracking (Apple definition)

| Question | Draft | Confidence | Evidence |
|---|---|---|---|
| Does the app use data for tracking (linking with third-party data for targeted ads / ad measurement across apps/websites)? | **Unresolved → conservative lean: Yes if Meta Pixel is enabled in production and can run in the WKWebView; No if production Pixel is disabled/unset.** | unresolved | Website Meta Pixel: `src/lib/meta-pixel.ts`, `MetaPixelRoot` in `src/app/layout.tsx`, route allowlist `src/lib/meta-pixel-route-policy.ts`. Native: no ATT prompt; `NSPrivacyTracking=false`. Production env values not in git. |
| Tracking domains | If tracking declared: Meta/Facebook domains used by Pixel | unresolved | Code loads Meta Pixel when ID enabled |
| Privacy Nutrition Label “Used for Tracking” | Match the tracking answer above per data type | unresolved | — |

**Do not claim “no tracking” without confirming production Pixel state.**

---

## Data type matrix

For each type: Collected / Shared / Linked to identity / Used for tracking / Required or optional / Purpose / Provider / Evidence / Confidence.

### Contact Info — Email Address

| Field | Answer |
|---|---|
| Collected? | **Yes** |
| Shared? | **Yes** (service providers) |
| Linked to identity? | **Yes** |
| Used for tracking? | **No** (Pixel payloads sanitized to avoid email; do not send email to Meta by design) |
| Required/optional? | **Required** for account |
| Purpose | App Functionality; Account Management; Developer Communications (transactional) |
| Provider | Clerk (auth); Resend (transactional email where used) |
| Evidence | App sign-in `AppEmailCodeSignIn.tsx`; privacy policy §1; Clerk |
| Confidence | **high** |

### Contact Info — Name

| Field | Answer |
|---|---|
| Collected? | **Yes** (when provided / present in Clerk profile) |
| Shared? | **Yes** (Clerk; may appear in support/fulfillment contexts) |
| Linked? | **Yes** |
| Tracking? | **No** |
| Required/optional? | **Optional / as provided** (account can exist primarily via email) |
| Purpose | App Functionality; Account Management |
| Provider | Clerk; Supabase profiles where mirrored |
| Evidence | Privacy §1; `user_profiles` / Clerk |
| Confidence | **high** |

### Contact Info — Phone Number

| Field | Answer |
|---|---|
| Collected? | **Yes** (when member opts into SMS coaching) |
| Shared? | **Yes** — Twilio (delivery) |
| Linked? | **Yes** |
| Tracking? | **No** |
| Required/optional? | **Optional** (SMS opt-in); required only for SMS coaching features |
| Purpose | App Functionality; Product Personalization (delivery timing) |
| Provider | Twilio; Supabase SMS tables |
| Evidence | Onboarding SMS routes; privacy §3; purge matrix |
| Confidence | **high** |

### Identifiers — User ID

| Field | Answer |
|---|---|
| Collected? | **Yes** (Clerk user ID; internal foreign keys) |
| Shared? | **Yes** with processors that receive `userId` / metadata (e.g. Stripe metadata, Supabase rows) |
| Linked? | **Yes** |
| Tracking? | **No** for first-party ID itself; see Advertising Data for Pixel |
| Required/optional? | **Required** for authenticated product |
| Purpose | App Functionality; Fraud Prevention / Security |
| Provider | Clerk; Supabase; Stripe (customer link) |
| Evidence | `clerk_user_id` across DB; Stripe `client_reference_id` |
| Confidence | **high** |

### Identifiers — Device ID

| Field | Answer |
|---|---|
| Collected? | **No advertising identifier / IDFA** found. App adds UA token `SummittMindsetiOS` (not a persistent device ID product). Server may see IP/User-Agent via normal HTTPS. |
| Shared? | N/A for IDFA |
| Linked? | IP may be linkable by providers — treat as technical processing |
| Tracking? | **No IDFA tracking found** |
| Purpose | N/A for IDFA |
| Evidence | Mobile PrivacyInfo empty; `ua-token.ts`; no ATT |
| Confidence | **high** for no IDFA; **medium** for IP as “Device ID” labeling (usually Other Diagnostic / not declared as Device ID) |

### Purchases — Purchase History / Subscription Status

| Field | Answer |
|---|---|
| Collected? | **Yes** (membership / Stripe customer & subscription IDs and status) |
| Shared? | **Yes** — Stripe |
| Linked? | **Yes** |
| Tracking? | **No** |
| Required/optional? | Required for paid membership features; inactive users may have no purchase |
| Purpose | App Functionality; Account Management |
| Provider | Stripe; Clerk `publicMetadata` entitlement fields |
| Evidence | Stripe checkout/webhook; native checkout **blocked** (`native_app_checkout_unavailable`) |
| Confidence | **high** |
| Note | Card PAN not stored on Summitt servers (privacy policy) |

### User Content — Emails or Text Messages (SMS)

| Field | Answer |
|---|---|
| Collected? | **Yes** — inbound/outbound SMS coaching content and delivery state when SMS used |
| Shared? | **Yes** — Twilio |
| Linked? | **Yes** |
| Tracking? | **No** |
| Required/optional? | Optional (SMS opt-in) |
| Purpose | App Functionality |
| Provider | Twilio; Supabase |
| Evidence | Twilio inbound/outbound; purge matrix SMS tables |
| Confidence | **high** |

### User Content — Other User Content (journals, Ask Pat, goals, reflections, Victory Room)

| Field | Answer |
|---|---|
| Collected? | **Yes** |
| Shared? | **Yes** — Supabase storage of records; **OpenAI** when AI features process content |
| Linked? | **Yes** |
| Tracking? | **No** |
| Required/optional? | Optional features, but core to product when used |
| Purpose | App Functionality; Product Personalization |
| Provider | Supabase; OpenAI |
| Evidence | Ask Pat API; journal tables; privacy §1 / §4 |
| Confidence | **high** |

### Usage Data — Product Interaction

| Field | Answer |
|---|---|
| Collected? | **Yes** (coaching progress, summaries, feature usage stored in product DB) |
| Shared? | **Yes** — Supabase; OpenAI when used for generation |
| Linked? | **Yes** |
| Tracking? | **No** for first-party product analytics SDK (none found). Meta Pixel PageView on **marketing** allowlisted routes only — see Advertising. |
| Purpose | App Functionality; Product Personalization |
| Provider | Supabase; OpenAI |
| Evidence | daily/weekly summaries, Victory snapshots, etc. |
| Confidence | **high** |

### Diagnostics — Crash Data

| Field | Answer |
|---|---|
| Collected? | **No** first-party crash SDK found (no Sentry/Crashlytics in website `package.json`; mobile docs/PrivacyInfo show no crash SDK) |
| Shared? | No |
| Confidence | **high** for no third-party crash SDK; OS-level logs outside app control |

### Diagnostics — Performance / Other Diagnostic Data

| Field | Answer |
|---|---|
| Collected? | Limited technical signals (browser/device/user-agent, IP via hosting) as needed to operate HTTPS service |
| Shared? | **Yes** — Vercel hosting; Clerk |
| Linked? | May be linked when authenticated |
| Tracking? | **No** (unless Pixel tracking declared separately) |
| Purpose | App Functionality; Fraud Prevention |
| Confidence | **medium** (standard hosting; not a custom telemetry product) |

### Location — Precise / Coarse

| Field | Answer |
|---|---|
| Collected? | **No** app geolocation API usage found |
| Confidence | **high** |

### Sensitive Info / Health / Financial Info (bank account) / Contacts / Photos / Audio / Camera / Bluetooth

| Field | Answer |
|---|---|
| Collected by app APIs? | **No** (no usage descriptions in mobile Info.plist; no getUserMedia/geolocation found on website product paths audited) |
| Payment card data | Processed by **Stripe** hosted checkout (website); not stored as PAN on Summitt servers |
| Shipping address | Collected for specific fulfillment flows (`coach_shipping_addresses`) when used — treat as **Physical Address** if that flow is in scope for the version under review |
| Confidence | **high** for no camera/mic/contacts/health kit; **high** that Stripe handles cards; shipping **high** if fulfillment used |

### Advertising Data

| Field | Answer |
|---|---|
| Collected? | **Unresolved — possible Yes** if production Meta Pixel ID is enabled. Pixel is marketing-route gated; app starts at `/app/sign-in` (PageView blocked for that path), but script may still load when enabled. |
| Shared? | **Yes with Meta** if enabled |
| Linked? | Pixel code sanitizes email/phone/user id from custom payloads; Meta may still process IP/cookies |
| Tracking? | **Likely Yes under Apple’s tracking definition if used for ads measurement** — confirm with counsel + prod config |
| Purpose | Analytics / Advertising (if enabled) |
| Evidence | `meta-pixel.ts`, README env docs |
| Confidence | **unresolved** for production enablement |

### Other — Vimeo embeds

| Field | Answer |
|---|---|
| Collected by Summitt? | Film video IDs stored; player loads Vimeo iframe |
| Shared? | User’s player session may share technical data with **Vimeo** |
| Tracking? | **Unresolved** (Vimeo practices) |
| Confidence | **high** embeds exist; **unresolved** Vimeo cookies |

---

## Purposes checklist (Apple labels)

Use where applicable: **App Functionality**, **Account Management**, **Product Personalization**, **Developer Communications**, **Fraud Prevention**, **Analytics** (only if Pixel/analytics confirmed), **Advertising** (only if Pixel confirmed).

Do **not** select **Third-Party Advertising** or **Developer’s Advertising** without confirming Pixel production use and counsel review.

---

## Data Not Collected — forbidden claim

**Do not select “Data Not Collected”** for this app. Account, coaching content, SMS (optional), and subscription status are collected through the product experience the app loads.

---

## Privacy Policy / Choices URLs

- Privacy Policy: `https://summittmindset.com/privacy`
- Data Deletion: `https://summittmindset.com/data-deletion`
- User Privacy Choices URL: omit until dedicated page exists (**unresolved** if Pixel requires additional disclosure — privacy policy currently does **not** name Meta/Vimeo/Resend; flagged in open items)

---

## Alignment notes

| Topic | Status |
|---|---|
| Privacy policy lists Clerk, Supabase, Stripe, Twilio, Vercel, OpenAI | Aligned |
| Privacy policy names Meta Pixel / Vimeo / Resend | **Gap — needs Tyler/counsel decision before relying on “complete disclosure”** |
| Native PrivacyInfo empty collected types | **Likely under-declares website-collected data — mobile PrivacyInfo update may be required before submission** (report-only; this task does not edit mobile) |
