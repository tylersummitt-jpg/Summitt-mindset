# Waiting-on-Assets & External Blockers Tracker

**Last updated:** 2026-07-24
**Package:** `docs/store-submission/`

---

## NOT BLOCKED (docs package ready)

- Phone-only V1 platform decision (`v1-platform-scope.md`)
- Apple & Google listing copy drafts
- Apple review notes + Google Play access instructions
- Reviewer / demo-account plan (credentials placeholders only)
- Apple App Privacy + Google Data Safety worksheets
- Final release regression checklist
- Release configuration audit checklist
- Five-screen screenshot storyboard
- Store-submission documentation cleanup

---

## BROOKE — visual assets

| Asset | Spec | Status |
|---|---|---|
| Main app icon | **1024×1024 PNG** (no alpha if Apple requires opaque) | **WAITING** |
| Android adaptive foreground | **1024×1024 PNG** | **WAITING** |
| Splash / launch | **2732×2732 PNG** (safe centering for crop) | **WAITING** |
| Play feature graphic | **1024×500 PNG** | **WAITING** — headline copy is **TYLER DECISION REQUIRED** (do not invent final words here) |
| Brand hex colors | Confirmed palette for splash/feature graphic | **WAITING** |

---

## D-U-N-S / STORE ACCOUNTS

| Item | Status |
|---|---|
| Apple organization enrollment (D-U-N-S) | **BLOCKED / WAITING** |
| Google Play organization verification | **BLOCKED / WAITING** |
| App Store Connect app record | Waiting on Apple enrollment |
| Play Console app record | Waiting on Play org |
| Play App Signing enrollment | Waiting on Play Console |
| Initial TestFlight upload | Waiting on ASC + signing + icon |
| Initial Play internal testing upload | Waiting on Play Console + signed AAB upload path |
| Final privacy-form entry (ASC + Play) | Manual portal entry — worksheets prepared |
| Final listing entry | Manual portal entry — copy prepared |
| Store submission | After assets + enrollment + testing |

---

## ANDROID — recorded engineering truth (store package)

> Recorded for submission planning per product owner / mobile engineering handoff.
> Website repo does not contain the Android binary. Treat binary details as **VERIFY BEFORE SUBMISSION** against the mobile repo and local artifacts before portal claims.

| Fact | Status |
|---|---|
| Package / application ID | `com.summittmindset.app` |
| Shell | Custom persistent WebView shell |
| Emulator core matrix | Passed (recorded) |
| Custom Tabs (HTTPS external) | Passed |
| `mailto` / `tel` / `sms` intents | Passed |
| Meta Pixel suppression (native UA) | Passed |
| Native checkout suppression | Passed |
| Inactive-account deletion path | Passed |
| Signed release AAB | Built and locally verified |
| Physical Android device (Tyler’s father) | Planned **after** Play internal testing is available |
| Store-ready? | **No** — assets, Play org, portal, and physical pass still open |

---

## APPLE — recorded truth (where docs support)

| Fact | Status |
|---|---|
| Bundle ID | `com.summittmindset.app` |
| Display name | Summitt Mindset |
| V1 device marketing | **iPhone only** (see `v1-platform-scope.md`) |
| Native Meta Pixel suppression | Physical PASS (2026-07-21) |
| Native checkout suppression | Implemented + tested |
| In-app account deletion | Production-proven |
| Vimeo `dnt=1` playback | Physical PASS (2026-07-21) |
| TestFlight / ASC record | **Not yet** (enrollment pending) |
| Final icon/splash in Release | Waiting on Brooke |

---

## Explicit non-claims

- Not claiming Apple or Google approval
- Not claiming Play Billing exists
- Not claiming physical Android father-phone testing has already passed
- Not inventing reviewer passwords or private keys
