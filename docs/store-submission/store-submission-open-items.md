# Store Submission — Open Items & Package Index

**Last updated:** 2026-07-24
**Package:** `docs/store-submission/`

---

## Package index

| File | Purpose |
|---|---|
| `v1-platform-scope.md` | iPhone-only / phone-focused V1; iPad deferred |
| `waiting-on-assets.md` | Brooke assets + D-U-N-S / portal blockers; Android truth |
| `apple-app-store-metadata.md` | Apple listing copy |
| `google-play-metadata.md` | Play listing copy |
| `apple-review-notes.md` | ASC review notes |
| `google-play-access-instructions.md` | Play app-access instructions |
| `reviewer-test-account-plan.md` | Demo account + fictional content |
| `apple-app-privacy-answers.md` | Apple App Privacy worksheet |
| `google-data-safety-answers.md` | Play Data Safety worksheet |
| `store-content-rating-answers.md` | Age / content rating drafts |
| `screenshot-shot-list.md` | Five-screen phone storyboard |
| `release-regression-checklist.md` | Simulator / emulator / TestFlight / father phone / smoke |
| `release-configuration-audit.md` | Release config audit worksheet |

---

## READY NOW (docs)

- Phone-only V1 decision documented
- Apple + Google listing drafts (final-draft quality; Tyler decisions flagged)
- Review notes + Play access instructions
- Reviewer/demo account plan with fictional content
- Privacy + Data Safety worksheets
- Regression + configuration checklists
- Screenshot storyboard (phone only)
- Public URLs: site, privacy, terms, data-deletion; Support@SummittMindset.com
- Native Meta Pixel suppression PASS (iOS physical); native checkout suppression; Vimeo `dnt=1` PASS
- Canonical native platform detection (`none`/`ios`/`android`) on website

---

## Stale facts corrected in this package

| Old / incorrect (do not reintroduce) | Current recorded truth |
|---|---|
| “Android not in the repository / not built” as current control | Android custom WebView shell exists; package `com.summittmindset.app`; emulator matrix + intents + Meta/checkout/deletion passes recorded; signed AAB locally verified — see `waiting-on-assets.md` |
| “Screenshot dimensions unknown / feature graphic missing as unknown” | Specs recorded: icon 1024; adaptive 1024; splash 2732; feature graphic 1024×500 — assets still **WAITING** on Brooke |
| “Native intent / Meta / checkout validation pending” (if stated as open) | Engineering passes recorded; physical father-phone still **NOT RUN** pending Play internal testing |
| iPad undecided for V1 screenshots | **iPhone only / phone-focused**; iPad deferred |

> Historical narrative in `docs/mobile-app-master-plan.md` may still describe earlier Android-deferred eras — treat **this package** + `waiting-on-assets.md` as current store-submission control for Android readiness facts.

---

## BLOCKED BY EXTERNAL ENTITY

| Item | Blocker |
|---|---|
| Apple Developer organization enrollment | D-U-N-S / Apple verification |
| Google Play organization verification | Play Console org |
| Optional counsel on final tracking radios | External counsel if engaged |

---

## BLOCKED BY ASSETS

| Item | Owner |
|---|---|
| Icon / adaptive / splash / feature graphic / brand hex | Brooke |
| Feature-graphic headline copy | **TYLER DECISION REQUIRED** |

---

## BLOCKED BY PORTAL

| Item | Notes |
|---|---|
| Final age-rating number | ASC / IARC questionnaires |
| Final privacy / Data Safety submit | Manual entry from worksheets |
| ASC / Play app records | Need enrollment |
| Export compliance final radios | Confirm at binary upload |
| TestFlight / Play internal testing uploads | After signing + assets |

---

## TYLER DECISION REQUIRED

1. Final Apple subtitle (options in `apple-app-store-metadata.md`)
2. Primary category (Lifestyle recommended vs Health & Fitness)
3. Final keywords / short description variants
4. Review support contact phone/email for ASC
5. Target age posture confirm 18+
6. Support URL: Data Deletion vs future `/support`
7. Optional Resend naming in privacy policy
8. Whether mobile `PrivacyInfo.xcprivacy` must expand before iOS submit
9. Play feature-graphic headline
10. Provision `[REVIEWER_EMAIL_PLACEHOLDER]` accounts (outside git)

---

## UNRESOLVED (do not guess in portals)

| Item | Notes |
|---|---|
| Final portal privacy questionnaire clicks | Manual |
| Provider retention schedules | Dashboards / counsel |
| At-rest encryption beyond provider defaults | Do not invent |
| Empty native PrivacyInfo vs WebView-collected data | Separate mobile task if required |
| Physical Android father-phone matrix | After Play internal testing |

---

## Explicit non-claims

- No data collected / no data shared
- COPPA / HIPAA / Apple / Google approval
- Play Billing exists
- Native IAP exists
- Final legal advice
- iPad support in V1

---

## Recommended next actions

1. Tyler finalize subtitle + category + reviewer inbox
2. Brooke deliver visual assets
3. Complete Apple enrollment when D-U-N-S arrives
4. Play org verification + internal testing → father-phone pass
5. Capture five phone screenshots
6. Portal privacy entry from worksheets
