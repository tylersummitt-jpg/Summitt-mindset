# Google Play Console — Listing Package (Final Draft)

**Status:** Final draft for Play Console when org + app record exist.
**Package / application ID:** `com.summittmindset.app`
**V1 device scope:** **Phone-focused** — see `v1-platform-scope.md`
**Last updated:** 2026-07-24

> No Play Billing implementation. Membership purchase initiation is suppressed in native-app traffic.
> Do not invent feature-graphic headline copy. Do not claim tablet support for V1.

---

## App title (max 50 characters)

**Summitt Mindset**
**Character count:** 15

---

## Short description (max 80 characters) — TYLER DECISION REQUIRED

**Recommended (78 characters):**

```
Daily coaching to help you hold one serious commitment—and prove it.
```

**Alternate (72 characters):**

```
Hold one commitment with Victory Room, Ask Pat, and Film Room.
```

---

## Full description

```
Summitt Mindset helps you hold one serious commitment with daily coaching inspired by Pat Summitt’s standards.

This is a membership coaching experience—not a generic habit tracker, not a static course library, and not therapy. It is built around one Current Goal, honest reflection, and follow-through you can see in your Victory Room.

In the app you can:
• Sign in or create an account with an email verification code
• Open your Victory Room when your membership is active
• Follow today’s coaching tied to your commitment
• Ask Pat for guidance grounded in your goal
• Watch Film Room lessons
• Manage your account and delete your account in-app

SMS coaching is available as a companion channel for members who opt in. SMS is not required for every member.

Memberships are managed on the Summitt Mindset website. The Android app does not initiate new subscription checkout. Existing members sign in to use the member experience.

Live product: https://summittmindset.com

Support: Support@SummittMindset.com
Privacy: https://summittmindset.com/privacy
Terms: https://summittmindset.com/terms
Account / data deletion: https://summittmindset.com/data-deletion
```

---

## Category — TYLER DECISION REQUIRED

| | Recommendation |
|---|---|
| **Primary (recommended)** | **Lifestyle** |
| Alternate | Health & Fitness (only without clinical claims) |
| Secondary positioning | Self-improvement / productivity-adjacent tags if offered |

---

## Tags — TYLER DECISION REQUIRED

Draft ideas (portal options vary): coaching, accountability, mindset, goals, leadership, self-improvement

Avoid medical, therapy, or “AI therapist” tags.

---

## Contact & URLs

| Field | Value |
|---|---|
| Website | `https://summittmindset.com` |
| Privacy Policy | `https://summittmindset.com/privacy` |
| Support email | `Support@SummittMindset.com` |
| External deletion URL | `https://summittmindset.com/data-deletion` |

---

## Ads declaration (draft)

| Question | Draft | Confidence |
|---|---|---|
| Contains ads? | **No** ad units / ad SDK in the native product UI. Native Meta Pixel is suppressed. Website browser Pixel is separate from native-app traffic. | high for native no-ads UI; final Play radio **VERIFY BEFORE SUBMISSION** |

---

## App access

**Yes** — core member value requires sign-in.
See `google-play-access-instructions.md` and `reviewer-test-account-plan.md`.

---

## Target audience — TYLER DECISION REQUIRED

Draft posture: **Adults 18+**. Not Families / Teacher Approved for V1.

---

## Declarations (draft)

| Declaration | Draft |
|---|---|
| News app | No |
| Clinical health / regulated medical | No — lifestyle coaching only |
| Financial features | Membership billing via website/Stripe; **no Play Billing** currently. Answer payment questions carefully. |
| Government app | No |

---

## Account deletion (Play)

| Item | Value |
|---|---|
| In-app path | Account Danger Zone; also inactive Membership required screen |
| External URL | `https://summittmindset.com/data-deletion` |

---

## Feature graphic

| Item | Status |
|---|---|
| Size | **1024×500 PNG** |
| Asset | Waiting on Brooke (`waiting-on-assets.md`) |
| Headline copy | **TYLER DECISION REQUIRED** — do not invent final marketing line in git |

---

## Version / What’s New (1.0 template)

```
Initial Google Play release of Summitt Mindset for phones. Sign in with an email verification code, reach your Victory Room and member coaching tools when entitled, use Ask Pat and Film Room, and manage or delete your account in-app.
```

---

## Android readiness note (honest)

Android engineering milestones (emulator matrix, intent handling, Meta/checkout suppression, signed AAB locally verified) are recorded in `waiting-on-assets.md`.
**Android is not yet store-ready** until Play org, assets, portal entry, and physical device testing through internal testing are complete.

---

## Data Safety

See `google-data-safety-answers.md`.
