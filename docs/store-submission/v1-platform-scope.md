# Summitt Mindset — Mobile V1 Platform Scope

**Status:** DECIDED for V1 store submission
**Last updated:** 2026-07-24
**Owner:** Tyler

---

## Decision

| Platform | V1 scope |
|---|---|
| **Apple** | **iPhone only** |
| **Google Play** | **Phone-focused** |
| **iPad / large tablets** | **Intentionally deferred** until after V1 launch |

This is a **scope and submission-speed decision**, not a permanent product limitation.

---

## What V1 will and will not claim

**Will:**

- Ship and market for **phone** daily-coaching use
- Capture **phone screenshots only** for V1 store listings
- Test primary flows on iPhone and Android phones

**Will not:**

- Claim iPad / tablet support in store copy
- Request or upload iPad screenshots for V1
- Expand V1 QA matrix to tablet layouts as a launch requirement

---

## Why phone-only V1

1. Reduce launch scope
2. Reduce testing surfaces
3. Reduce screenshot and asset burden
4. Protect submission speed
5. Phone is the primary daily-coaching use case (Victory Room, Ask Pat, Film Room, SMS companion)

---

## Future iPad / tablet reconsideration triggers

Revisit large-screen support when **all** of the following are true (or clearly warranted):

- Stable phone release in stores
- Real member requests for tablet / iPad
- Observable tablet usage or demand signals
- Validated large-screen UX for Victory Room and coaching flows

Until then: do not imply tablet readiness in marketing or store metadata.

---

## Related store package notes

- Native apps load the live Summitt Mindset member experience; membership purchase initiation is suppressed in native traffic
- Visual assets, D-U-N-S / Play org enrollment, and portal entry remain external blockers — see `waiting-on-assets.md` and `store-submission-open-items.md`
- This document does **not** modify Xcode or Android project settings; device-family / form-factor configuration is a separate mobile-repo task when authorized

---

## Explicit non-claims

- Not claiming iPad will never ship
- Not claiming current tablet UX is validated
- Not claiming App Store / Play approval
