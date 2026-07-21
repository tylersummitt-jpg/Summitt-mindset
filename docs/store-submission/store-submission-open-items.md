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

---

## BLOCKED BY EXTERNAL ENTITY

| Item | Blocker |
|---|---|
| Apple Developer organization enrollment | **D-U-N-S** / Apple verification |
| Google Play organization verification | Play Console org verification (when Android starts) |
| Legal counsel sign-off on Pixel / tracking disclosure | External counsel (if engaged) |

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
| Final privacy nutrition labels / Data Safety submit | Must click through portals |
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
6. **Production Meta Pixel enabled?** — drives Apple Tracking + Data Safety advertising rows  
7. **Whether to update privacy policy** to name Meta / Vimeo / Resend before submit  
8. **Whether mobile `PrivacyInfo.xcprivacy` must be expanded** to declare website-collected data types before iOS submit (mobile edit would be a separate authorized task)  
9. **Support URL** choice (Data Deletion page vs future `/support`)  
10. **iPhone-only vs Universal** screenshot/device set  

---

## UNRESOLVED (do not guess in portals)

| Item | Why unresolved | Suggested resolution |
|---|---|---|
| Production `NEXT_PUBLIC_META_PIXEL_ID` / enabled | Not in git | Tyler check Vercel production env |
| Apple “Used for Tracking” | Depends on Pixel + counsel | Decide after env check |
| OpenAI / Twilio / Stripe / Resend retention schedules | Provider dashboards | Optional counsel; deletion matrix already documents EXTERNAL logs |
| Vimeo player cookies / tech data | Third-party player | Disclose embed; optional policy update |
| Clerk website Google OAuth exact dashboard toggles | Dashboard | Confirm before review notes if website Google mentioned |
| At-rest encryption claims beyond provider defaults | Not custom app crypto | Stick to “encrypted in transit = Yes” |
| Empty native PrivacyInfo vs WebView-collected data | Policy/product | Separate mobile task if required |

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

---

## Recommended next single Tyler decision

**Confirm production Meta Pixel on/off**, then lock Tracking / Advertising rows and decide whether privacy policy + PrivacyInfo need updates before first binary submit.
