# Google Play Console — Metadata Draft

**Status:** Draft for when Android / Play Console exist. Android project is **not yet** in `summitt-mindset-mobile`. Copy remains valid for future Play listing.  
**Intended package:** `com.summittmindset.app`  
**Last updated:** 2026-07-21  

> Current fact: **No native Google Play Billing implementation exists.** This is a factual statement about the current product, **not** a claim that Google has approved any billing exemption or policy posture.

---

## App name

**Summitt Mindset**

---

## Short description (max 80 characters) — NEEDS TYLER DECISION

Draft (78 characters):

```
Daily SMS coaching and tools to help you hold one serious commitment.
```

Alternate (72):

```
Commitment coaching with Victory Room, Ask Pat, and Film Room.
```

---

## Full description

```
Summitt Mindset helps you hold one serious commitment with daily SMS accountability (when you opt in), Ask Pat coaching, Film Room lessons, and a personal Victory Room.

In the app you can:
• Sign in or create an account with an email verification code
• Access Victory Room when your membership is active
• Ask Pat coaching questions
• Watch Film Room lessons
• Manage your account and delete your account in-app

Memberships are acquired on the Summitt Mindset website. The app experience is the live Summitt Mindset product at https://summittmindset.com.

Support: Support@SummittMindset.com
Privacy: https://summittmindset.com/privacy
Terms: https://summittmindset.com/terms
Account / data deletion: https://summittmindset.com/data-deletion
```

---

## App category — NEEDS TYLER DECISION

Recommended: **Health & Fitness** *or* **Lifestyle** (prefer Lifestyle if Health implies clinical claims).  
Secondary tags: coaching, productivity, self-improvement (portal-dependent).

---

## Tags

Draft ideas (final portal tags vary): coaching, accountability, mindset, goals, SMS, leadership  

**NEEDS TYLER DECISION**

---

## Privacy Policy URL

`https://summittmindset.com/privacy`

---

## Support contact

- Email: `Support@SummittMindset.com`  
- Public deletion instructions: `https://summittmindset.com/data-deletion`

---

## Ads declaration

| Question | Draft | Confidence |
|---|---|---|
| App contains ads? | **No** native advertising SDK. Website may load Meta Pixel on marketing routes if production-enabled — **unresolved** whether Play “Ads” declaration must be Yes when WebView can load Pixel. Conservative: treat as **No ads UI**; disclose Pixel under Data Safety if enabled. | unresolved for Pixel; **high** for no ad SDK / no ad units in product UI |

---

## App access / login required

**Yes** — most member value requires sign-in. Provide reviewer instructions + credentials plan (`reviewer-test-account-plan.md`).

---

## Target audience — NEEDS TYLER DECISION

Draft posture: **Adults 18+** (coaching / commitment product; not designed for children).  
Not Families / Teacher Approved for V1.

---

## Declarations (draft)

| Declaration | Draft answer | Notes |
|---|---|---|
| News app | **No** | |
| Health app (Google Play health policies) | **No** as clinical/health device; lifestyle coaching only. Confirm portal wording. | Do not claim medical advice |
| Financial features | **Membership subscription billing via website/Stripe**; no banking/crypto trading product. Answer financial questionnaire carefully when portal asks about payments. | No Play Billing currently |
| Government app | **No** | |
| Families / Teacher Approved | **Not targeting** | |

---

## Account deletion (Play requirement)

| Item | Value |
|---|---|
| In-app deletion | Yes — Account Danger Zone; also inactive membership path |
| External web resource URL | `https://summittmindset.com/data-deletion` |

---

## Data Safety

See `google-data-safety-answers.md`.

---

## Reviewer credentials

See `reviewer-test-account-plan.md`. Placeholders only in git.
