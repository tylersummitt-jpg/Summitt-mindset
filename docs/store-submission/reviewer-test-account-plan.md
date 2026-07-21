# Reviewer Test Account Plan

**Status:** Operational plan for App Review / Play review.  
**Rule:** **No real passwords, verification codes, tokens, phone numbers, or private Clerk/Stripe IDs in git.**  
**Last updated:** 2026-07-21  

---

## Goals

Provide reviewers a **subscribed** account that can exercise:

- Email-code Sign in (app path)  
- Victory Room  
- Ask Pat  
- Film Room  
- Account settings  
- Discoverability of **Delete account** (warn reviewers **not** to complete deletion on the shared reviewer account unless Tyler has a disposable alternate)

Without requiring a **live paid purchase** inside the app (native purchase is blocked / not offered).

---

## Account placeholders (fill only in App Store Connect / Play Console / password manager)

| Field | Placeholder |
|---|---|
| Reviewer email | `[REVIEWER_EMAIL_PLACEHOLDER]` e.g. pattern `review+appstore@…` under Tyler’s control |
| Auth method | Clerk **email verification code** only (no password field on `/app/sign-in`) |
| Password | **N/A** for app email-code path |
| Phone / SMS | **Do not** require SMS for core review path unless separately provisioned; prefer email-only reviewer account |
| Entitlement | Clerk `publicMetadata` subscribed flags already set by Tyler **before** submission |
| Stripe | Existing test/customer link OK; **no live charge during review** |

---

## How the reviewer receives the email code

1. On `/app/sign-in`, enter `[REVIEWER_EMAIL_PLACEHOLDER]`.  
2. Choose Sign in → request code.  
3. Tyler (or automated inbox Tyler monitors) retrieves the Clerk email code from the reviewer mailbox.  
4. If Apple asks for a shared password: explain **email code only** in Review Notes (already drafted). Optionally provide a secondary note that Tyler can monitor the inbox during review windows.

**Alternative (if portal insists on static password):** not available on app email-code UI — do not invent a password path for V1. Stick to email-code instructions.

---

## Expected subscribed entitlement setup (Tyler private checklist)

Perform **outside git**:

1. Create dedicated Clerk user with reviewer email.  
2. Grant active membership entitlement the same way production members receive it (Stripe test mode or manual metadata) — **do not document secret procedures with live keys here**.  
3. Confirm sign-in on physical device reaches **Victory Room**, not `/app/membership`.  
4. Confirm Ask Pat submit works.  
5. Confirm Film Room lists + Vimeo plays.  
6. Confirm Account shows Sign out and Delete account separately.  
7. Confirm native UI shows **no** Free Trial / Subscribe / Checkout CTA.

---

## Exact navigation steps (reviewer)

1. Launch app → land on `/app/sign-in`.  
2. Sign in with email code (Create account should not be required if account pre-exists).  
3. Arrive at Victory Room.  
4. Navigate to Ask Pat → ask a short question → wait for answer.  
5. Navigate to Film Room → open a video → play.  
6. Open Account (`/user`) → locate legal links; note Delete account in Danger Zone.  
7. **Do not** complete account deletion on the shared reviewer account.  
8. **Do not** attempt website Subscribe / Stripe Checkout expecting it to work inside the app.

---

## What not to test with a real charge

- Native “Subscribe”, “Free Trial”, “Upgrade”, or Checkout (should be absent / blocked)  
- Starting a new live paid subscription solely for review  
- Purchasing via IAP (none exists)

Website Safari purchase path may exist for real customers; it is **out of scope** for proving native IAP.

---

## Account deletion testing

| Scenario | Guidance |
|---|---|
| Shared reviewer account | Show that Delete account is discoverable; **do not finalize** |
| Proof of deletion flow | Tyler maintains a **separate disposable** account if a reviewer must complete deletion |
| Public URL | `https://summittmindset.com/data-deletion` |

---

## Reset / replace between reviews

| When | Action |
|---|---|
| After each review cycle | Rotate reviewer email or clear sessions; ensure entitlement still active |
| If reviewer deleted the account | Provision a new `[REVIEWER_EMAIL_PLACEHOLDER]` and update App Store Connect notes |
| If entitlement lapsed | Re-apply subscribed metadata / Stripe link before resubmit |
| Codes | Single-use; never commit codes |

---

## Inactive-path note (optional secondary account)

A second disposable **unsigned / inactive** account can demonstrate Membership required + no purchase CTA + deletion discoverability. Keep credentials out of git; mention existence only in private Tyler notes if used.
