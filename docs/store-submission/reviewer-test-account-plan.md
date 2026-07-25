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
- mailbox / one-time-code dependency during review
- Tyler intervention during review windows

---

## Production password authentication validation (2026-07-24)

| Item | Status |
|---|---|
| Temporary password auth test (production Clerk + `/app/sign-in`) | **COMPLETE / PASS** |
| Permanent dedicated reviewer account | **NOT YET CREATED** |
| Reviewer entitlement metadata | **PENDING** |
| Reviewer onboarding / demo content | **PENDING** |
| SMS-disabled state on reviewer | **PENDING** |
| Native iOS reviewer password login | **PENDING** |
| Native Android reviewer password login | **PENDING** |
| Disposable deletion-test account | **PENDING** |

### Temporary QA authentication account

| Field | Recorded fact |
|---|---|
| Email | `tyler@trysummittmindset.com` |
| Role | Temporary production authentication QA only — **not** the permanent store reviewer account |
| Password | **Not documented** (password manager only) |
| Validation URL | `https://summittmindset.com/app/sign-in` |

### Observed PASS evidence (browser / production)

1. Native-app sign-in screen showed **Send verification code** and **Sign in with password**.
2. Existing password-enabled test user signed in with email + password.
3. Password authentication completed successfully through Clerk.
4. No emailed verification code was required after Client Trust was disabled.
5. Session activation and post-sign-in routing followed the normal product path.
6. No special reviewer URL, static code, hard-coded account, or authentication bypass was used.

### Production Clerk configuration validated (2026-07-24)

| Setting | Recorded state |
|---|---|
| Sign-up with password | **OFF** |
| Add password to account | **ON** |
| Email-code authentication | **Enabled** (remains normal member path) |
| Client Trust | **OFF** |
| Lockout policy | **ON** |
| Bot sign-up protection | **ON** |
| MFA on temporary test account | **None** |

---

## Final member authentication strategy

### Ordinary members

- Account creation remains **email-code verified** on `/app/sign-in`.
- Email-code sign-in remains **available and primary**.
- Ordinary members are **not** required to create passwords.
- Social login remains **absent** from the native-app sign-in route (website Google unchanged).
- Sessions remain persistent under normal Clerk session lifetime (180-day max; inactivity off — DEC-022).

### Password-enabled existing users

- May choose optional **Sign in with password** on `/app/sign-in`.
- Passwords are verified **only by Clerk** (no Summitt Mindset password storage).
- Successful authentication uses the existing session activation and `/post-sign-in` routing.
- Email-code remains available as an alternate method.
- Password access is limited to users who have **explicitly been assigned a password** in Clerk.

### Store reviewers (target posture)

- One dedicated, **pre-entitled** reviewer account.
- Reviewer receives email + strong password (outside Git; ASC / Play / password manager only).
- **No MFA** on the reviewer account.
- **No mailbox / one-time code** required for review login.
- **No Tyler intervention** required during review windows.
- **No Stripe purchase** and **no SMS** participation required.

There is **no** reviewer-specific code path or authentication backdoor.

---

## Security tradeoff — Client Trust OFF

Client Trust was **disabled** because it forced additional verification for password logins from new devices. That behavior conflicted with stable, reusable store-review credentials.

**Tradeoff (do not minimize):**

- Disabling Client Trust removes Clerk’s extra **new-device verification** for password-enabled accounts.
- Email-code-only users remain dependent on possession of their email inbox for sign-in.
- Password signup remains **disabled**.
- Email-code remains the normal member path.
- Password access remains limited to explicitly password-assigned users.
- Lockout policy and bot sign-up protection remain **enabled**.
- Client Trust may be reconsidered after store review if the long-term password strategy changes.

---

## Account naming convention

| Field | Convention |
|---|---|
| Email pattern | `[REVIEWER_EMAIL_PLACEHOLDER]` — dedicated store-review mailbox under Tyler’s control (separate from temporary QA `tyler@trysummittmindset.com`) |
| Auth | **Password sign-in** for store review (primary for reviewers). Email-code remains available as product fallback for ordinary members. |
| Password | Strong password assigned in Clerk; stored in password manager / ASC / Play — **never git** |
| Phone / SMS | **Do not** attach a phone. SMS disabled for reviewer. |
| Entitlement | Subscribed Clerk `publicMetadata` set **before** submission |
| Storage | Password manager / ASC / Play Console only — **never git** |
| MFA | Reviewer account must have **MFA disabled** |

Label accounts clearly, e.g. `Store Reviewer — App Store` / `Store Reviewer — Play`, and do **not** reuse Tyler’s personal member account or the temporary QA auth account as the permanent reviewer.

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
| SMS | Disabled; no real phone |

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
| Auth method | Password on `/app/sign-in` (Sign in with password) |
| Password | `[REVIEWER_PASSWORD_PLACEHOLDER]` — password manager / ASC / Play only; **never git** |
| Entitlement proof | Tyler private checklist — not in git |

---

## How the reviewer signs in (target — after permanent account exists)

1. Open the app → `/app/sign-in`.
2. Choose **Sign in**.
3. Choose **Sign in with password**.
4. Enter `[REVIEWER_EMAIL_PLACEHOLDER]` and `[REVIEWER_PASSWORD_PLACEHOLDER]` from App Review / Play access fields.
5. Expect Victory Room (subscribed). Same `/post-sign-in` routing as email-code.

Email-code remains a product fallback for ordinary members and for password-assigned users who retain mailbox access. Do not rely on a broken in-app “Forgot password?” link for review.

If routed to Membership required: entitlement missing — **do not purchase**; Tyler fixes entitlement.

---

## Next reviewer steps (exact order)

1. Create the permanent dedicated reviewer email/account.
2. Assign a strong password through Clerk.
3. Confirm MFA is disabled for that account.
4. Grant entitlement through supported Clerk `publicMetadata`:
   - `summittSubscribed: true`
   - `summittPlan: "monthly"`
5. Complete or safely establish onboarding state (`onboardingCompleted: true` and/or product onboarding as required).
6. Ensure SMS is disabled and no real phone receives messages.
7. Seed fictional demo content.
8. Test password login in a fresh browser.
9. Test password login in the iOS simulator.
10. Test password login in the Android emulator.
11. Create a separate disposable deletion-test account.
12. Store final reviewer credentials only in the password manager and store portals.

**Do not** publish credentials in git.

---

## Temporary QA account cleanup posture

For `tyler@trysummittmindset.com`:

- **Retain temporarily** as a QA authentication account until native (iOS/Android) password testing is complete.
- Do **not** add real member data, phone number, SMS enrollment, or Stripe subscription.
- After permanent reviewer validation: **delete** or clearly mark as QA-only.
- Do **not** promote this address to the permanent Apple/Google reviewer account without a deliberate rename/replacement decision.

---

## Ownership & maintenance

| Role | Owner |
|---|---|
| Create / entitlement / password | Tyler |
| Keep account active during review windows | Tyler |
| Reset after reviewers mutate data | Tyler |
| Avoid lockout | Strong password + Clerk lockout policy; MFA off; no mailbox dependency for review |
| Disposable deletion proof | Separate throwaway account if a reviewer must complete deletion |

---

## Reset / replace between reviews

| When | Action |
|---|---|
| After each cycle | Confirm entitlement; clear odd mutations; rotate password if compromised |
| If reviewer deleted the account | Provision new `[REVIEWER_EMAIL_PLACEHOLDER]`; update ASC / Play notes |
| If entitlement lapsed | Re-apply subscribed state before resubmit |
| Passwords / codes | Never commit |

---

## Exact reviewer navigation (shared)

1. Launch app → `/app/sign-in`
2. Sign in with **password** (pre-created entitled account; Create account not required)
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
