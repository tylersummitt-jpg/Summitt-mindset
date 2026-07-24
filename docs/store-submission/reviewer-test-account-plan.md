# Reviewer / Demo Account Plan

**Status:** Operational plan for App Review and Play review.
**Rule:** **No real passwords, verification codes, tokens, phone numbers, or private Clerk/Stripe IDs in git.**
**Last updated:** 2026-07-24

---

## Purpose

Provide a **dedicated** subscribed demo account so reviewers can exercise the member experience **without**:

- live native purchase / Stripe Checkout
- Tyler’s personal account
- real member journals or phone numbers

---

## Account naming convention

| Field | Convention |
|---|---|
| Email pattern | `[REVIEWER_EMAIL_PLACEHOLDER]` — e.g. `review+appstore@…` / `review+play@…` under Tyler’s control |
| Auth | Clerk on `/app/sign-in`: **email verification code** (primary) + optional **password** for existing password-enabled Clerk users |
| Password | Optional for existing Clerk users who already have a password factor. Create account remains email-code only. Credentials stay outside git. |
| Phone / SMS | **Do not** attach a personal phone unless absolutely required. Prefer email-only for core review. |
| Entitlement | Subscribed Clerk `publicMetadata` set **before** submission |
| Storage | Password manager / ASC / Play Console only — **never git** |
| MFA | Reviewer account must have **MFA disabled** (native path does not bypass second factor) |

Label accounts clearly, e.g. `Store Reviewer — App Store` / `Store Reviewer — Play`, and do **not** reuse as Tyler’s daily test account.

---

## Required account state

| Requirement | Detail |
|---|---|
| Onboarding | Complete |
| Membership | Active entitlement (Victory Room reachable) |
| Current Goal | Realistic fictional commitment (below) |
| Reflections | 3–5 safe sample entries |
| Ask Pat | Safe context; one sample Q&A acceptable |
| Film Room | Accessible; Vimeo playback works |
| Native purchase UI | Absent / blocked |
| SMS | Not required for review path |

---

## Recommended fictional demo content

**Current Goal / commitment**

> Finish the first draft of my leadership plan by September 30.

**Identity statement (example)**

> I am a leader who finishes what I start and holds myself to a clear written standard.

**Behavior commitment (example)**

> Write for 25 focused minutes on the leadership plan draft before noon, five weekdays this week.

**Sample reflections (safe, fictional)**

1. Wrote 25 minutes before meetings. Draft outline is clearer; still need the standards section.
2. Skipped writing after a long day. Reset tomorrow: same 25 minutes, phone in another room.
3. Finished the “team expectations” section. Progress feels real because I can point to pages.
4. Asked a hard question in Ask Pat about staying honest when energy is low—useful, not fluffy.
5. Film Room lesson on standards reminded me to measure the draft against one clear outcome.

**Progress state**

- Onboarding complete
- Current Goal visible in Victory Room
- Recent reflections present
- No admin tools; no real member data

**Safe Ask Pat question**

> When my schedule gets crowded, how do I protect 25 minutes for the leadership-plan draft without lowering the standard?

**Film Room**

- Open Film Room list → open one lesson → confirm playback

---

## Credential placeholders (portal / password manager only)

| Field | Placeholder |
|---|---|
| Reviewer email | `[REVIEWER_EMAIL_PLACEHOLDER]` |
| Auth method | Email verification code (primary) or password if the Clerk user has a password factor |
| Password | `[REVIEWER_PASSWORD_PLACEHOLDER]` — password manager / ASC / Play only; **never git** |
| Entitlement proof | Tyler private checklist — not in git |

---

## How the reviewer signs in

**Preferred for review windows (mailbox access):**

1. Enter `[REVIEWER_EMAIL_PLACEHOLDER]` on `/app/sign-in`.
2. Request Sign in code (email-code remains primary / fallback).
3. Tyler (or monitored reviewer inbox) retrieves the Clerk email code.
4. Enter code → expect Victory Room (subscribed).

**Optional password path (existing password-enabled Clerk user):**

1. On Sign in, choose **Sign in with password**.
2. Enter email + password from the password manager / App Review fields.
3. Expect Victory Room (subscribed). Same `/post-sign-in` routing as email-code.

There is **no** reviewer backdoor, static code, or hard-coded credentials in the app. Password sign-in uses Clerk’s normal password first factor only when Clerk reports it for that user.

**Clerk Dashboard (still verify in production):** password strategy enabled for the instance if password review login will be used; MFA disabled on the reviewer user.

If routed to Membership required: entitlement missing — **do not purchase**; Tyler fixes entitlement.

Email-code remains the recovery/fallback path when the mailbox is available. Do not rely on a broken in-app “Forgot password?” link.

---

## Ownership & maintenance

| Role | Owner |
|---|---|
| Create / entitlement / inbox | Tyler |
| Keep account active during review windows | Tyler |
| Reset after reviewers mutate data | Tyler |
| Avoid lockout | Monitor inbox; keep entitlement valid; do not delete the shared reviewer account during review |
| Disposable deletion proof | Separate throwaway account if a reviewer must complete deletion |

---

## Reset / replace between reviews

| When | Action |
|---|---|
| After each cycle | Confirm entitlement; clear odd mutations; rotate email if compromised |
| If reviewer deleted the account | Provision new `[REVIEWER_EMAIL_PLACEHOLDER]`; update ASC / Play notes |
| If entitlement lapsed | Re-apply subscribed state before resubmit |
| Codes | Single-use; never commit |

---

## Exact reviewer navigation (shared)

1. Launch app → `/app/sign-in`
2. Sign in with email code **or** password (pre-created account; Create account not required)
3. Arrive at Victory Room
4. Confirm Current Goal / daily coaching context
5. Ask Pat → short question → answer
6. Film Room → play a lesson
7. Account (`/user`) → note Sign out ≠ Delete account
8. **Do not** complete deletion on the shared reviewer account
9. **Do not** attempt native Subscribe / Checkout

---

## What not to test with a real charge

- Native Subscribe / Free Trial / Checkout
- New live paid subscription solely for review
- IAP / Play Billing (not offered in V1 native)

Website Safari purchase may exist for real customers; it is out of scope for proving native purchase.

---

## Inactive-path optional secondary account

A disposable **inactive** account can show Membership required + no purchase CTA + deletion discoverability. Credentials stay out of git.
