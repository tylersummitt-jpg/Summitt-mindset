# Final Release Regression Checklist

**Status:** Authoritative pre-release checklist
**Last updated:** 2026-07-24
**Statuses:** `PASS` · `FAIL` · `BLOCKED` · `NOT RUN` · `NOT APPLICABLE`

Mark each cell before submission. Do not invent PASS without evidence.

---

## Shared item list

Use the same rows across environments A–E unless marked N/A.

| # | Item |
|---|---|
| 1 | Fresh install |
| 2 | Cold launch |
| 3 | App icon correct |
| 4 | Splash / launch branding correct |
| 5 | Sign up (email code) |
| 6 | Sign in (email code) |
| 7 | Sign out |
| 8 | Session persistence (force-close / reopen) |
| 9 | Onboarding (if new account path tested) |
| 10 | Victory Room loads |
| 11 | Current Goal display |
| 12 | Daily coaching / practice context |
| 13 | Reflection submission |
| 14 | Progress update |
| 15 | Ask Pat submit → answer |
| 16 | Film Room list |
| 17 | Vimeo playback |
| 18 | Internal navigation (member routes) |
| 19 | External HTTPS (Custom Tabs / SFSafari as applicable) |
| 20 | `mailto:` |
| 21 | `tel:` |
| 22 | `sms:` |
| 23 | Back / system back behavior |
| 24 | Offline / retry graceful behavior |
| 25 | Legal pages (Privacy / Terms / Data Deletion) |
| 26 | Privacy Policy content reachable |
| 27 | Account deletion discoverable (do not finalize on shared reviewer) |
| 28 | Native checkout suppression (no purchase CTA; checkout API 403 if forced) |
| 29 | Meta Pixel suppression (native UA) |
| 30 | App relaunch to expected state |
| 31 | Production domain (`https://summittmindset.com`) |
| 32 | No test banners |
| 33 | No debug WebView inspection in Release |
| 34 | No private member data on demo account |
| 35 | No Capacitor branding in UI |
| 36 | Version / build number correct |
| 37 | Install / update via store testing track |

---

## A. iPhone simulator

| # | Status | Notes |
|---|---|---|
| 1–37 | NOT RUN | Fill per item before ASC submit |

---

## B. Android emulator

| # | Status | Notes |
|---|---|---|
| 1–37 | NOT RUN | Emulator core matrix historically recorded; re-run before Play submit |

---

## C. TestFlight

| # | Status | Notes |
|---|---|---|
| 1–37 | NOT RUN | Blocked until ASC + icon + archive |

---

## D. Google Play internal testing (Tyler’s father’s Android phone)

| # | Status | Notes |
|---|---|---|
| 1–37 | NOT RUN | Planned after Play internal testing is available (`waiting-on-assets.md`) |

---

## E. Final pre-submission smoke test

| # | Status | Notes |
|---|---|---|
| 1–37 | NOT RUN | Last pass on Release / store-track builds only |

---

## Environment-specific N/A guidance

| Item | When N/A |
|---|---|
| Sign up | If smoke uses pre-created reviewer account only |
| Onboarding | If account already onboarded |
| `tel:` / `sms:` | If device/SIM cannot place calls/SMS — still verify intent handoff where possible |
| Store install/update | Simulator-only sessions |

---

## Hard fail criteria (any environment)

- Native checkout initiation succeeds
- Meta Pixel loads in native Release traffic
- Victory Room / Ask Pat / Film Room broken for entitled account
- Account deletion undiscoverable when required
- Debug inspection enabled in Release
- Real member private data visible in screenshots or reviewer account
- Non-production domain in Release shell

---

## Related

- `release-configuration-audit.md`
- `reviewer-test-account-plan.md`
- `waiting-on-assets.md`
