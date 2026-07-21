# Store Submission — Open Items

**Last updated:** 2026-07-21
**Package location:** `docs/store-submission/`

---

## READY NOW

- Draft Apple metadata (`apple-app-store-metadata.md`)
- Draft Apple App Privacy answers with evidence (`apple-app-privacy-answers.md`)
- Draft Apple Review Notes (`apple-review-notes.md`)
- Draft Google Play metadata (`google-play-metadata.md`)
- Draft Google Data Safety answers (`google-data-safety-answers.md`)
- Content / age-rating questionnaire drafts (`store-content-rating-answers.md`)
- Reviewer account plan without secrets (`reviewer-test-account-plan.md`)
- Screenshot shot list (`screenshot-shot-list.md`)
- Public URLs ready:
  - `https://summittmindset.com`
  - `https://summittmindset.com/privacy`
  - `https://summittmindset.com/terms`
  - `https://summittmindset.com/data-deletion`
  - Support display: `Support@SummittMindset.com`
- Product facts grounded in implementation: email-code app auth; native purchase suppression; in-app deletion proven; no native IAP; no ATT/ad SDK in native binary
- **Native Meta Pixel suppression COMPLETE / physical PASS (2026-07-21):** zero facebook/fbevents/connect.facebook network rows; `typeof window.fbq === "undefined"` on Victory Room and in-app `/`. Website Pixel remains when configured. Pixel is **not** an unresolved native store-submission item.
- **Public Privacy Policy Meta disclosure COMPLETE (2026-07-21):** `/privacy` names Meta Platforms, Inc., describes website Pixel purposes/data classes, states no intentional advanced matching of email/phone/name, and states Meta Pixel is not loaded in the iOS app. Website Meta disclosure is **no longer an open blocker**.

---

## BLOCKED BY EXTERNAL ENTITY

| Item | Blocker |
|---|---|
| Apple Developer organization enrollment | **D-U-N-S** / Apple verification |
| Google Play organization verification | Play Console org verification (when Android starts) |
| Legal counsel sign-off on final portal tracking radios (all providers) | External counsel (if engaged) |

---

## BLOCKED BY ASSETS

| Item | Owner |
|---|---|
| Final app icon | Brooke |
| Splash / launch branding | Brooke |
| Final store screenshots | Tyler (+ Brooke branding) per shot list |

---

## BLOCKED BY PORTAL

| Item | Notes |
|---|---|
| Final age-rating number | Generated after questionnaire in ASC / IARC |
| Final privacy nutrition labels / Data Safety submit | Must click through portals (manual entry still required) |
| App Store Connect app record | Needs enrollment |
| Play Console app record | Needs Android + Play account |
| Export compliance final radio buttons | Confirm at binary upload |

---

## NEEDS TYLER DECISION

1. **Final subtitle** (≤30 chars) — options in Apple metadata
2. **Primary category** (Lifestyle vs Health & Fitness vs Productivity)
3. **Promotional / keyword final language**
4. **Review support contact** phone/email for ASC
5. **Target age posture** (confirm 18+)
6. **Whether to also name Vimeo / Resend** in privacy policy (optional; Meta disclosure done)
7. **Whether mobile `PrivacyInfo.xcprivacy` must be expanded** to declare website-collected product data types before iOS submit (separate authorized mobile task if needed)
8. **Support URL** choice (Data Deletion page vs future `/support`)
9. **iPhone-only vs Universal** screenshot/device set

---

## UNRESOLVED (do not guess in portals)

| Item | Why unresolved | Suggested resolution |
|---|---|---|
| Final portal privacy questionnaire entry | Must be clicked in ASC / Play | Use drafts; review other providers |
| OpenAI / Twilio / Stripe / Resend retention schedules | Provider dashboards | Optional counsel; deletion matrix documents EXTERNAL logs |
| Vimeo player cookies / tech data | Third-party player | Optional policy naming; disclose embed |
| Clerk website Google OAuth exact dashboard toggles | Dashboard | Confirm before review notes if website Google mentioned |
| At-rest encryption claims beyond provider defaults | Not custom app crypto | Stick to “encrypted in transit = Yes” |
| Empty native PrivacyInfo vs WebView-collected product data | Policy/product | Separate mobile task if required |

---

## Explicit non-claims (package-wide)

This package does **not** claim:

- “No data collected” / “No data shared”
- COPPA compliant
- HIPAA compliant
- Apple approved / Google approved
- Play Billing policy approval
- Native IAP existence
- Final portal age rating numbers
- No tracking anywhere on the website
- Final legal advice

---

## Recommended next single Tyler decision

**Finalize store listing copy** (subtitle / category), then proceed to Apple enrollment when D-U-N-S arrives. Public Meta Privacy Policy disclosure and native Pixel PASS are complete.
