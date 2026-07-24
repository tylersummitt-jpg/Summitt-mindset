# Release Configuration Audit Checklist

**Status:** Read-only audit worksheet (docs). Do not run builds in this docs-only package update.
**Last updated:** 2026-07-24
**Statuses:** `PASS` · `FAIL` · `BLOCKED` · `NOT RUN` · `VERIFY BEFORE SUBMISSION` · `WAITING ON ASSETS`

Do **not** store keystore passwords, upload key secrets, or provisioning profile private material in git.

---

## iOS

| Check | Expected / notes | Status |
|---|---|---|
| Bundle identifier | `com.summittmindset.app` | VERIFY BEFORE SUBMISSION |
| Display name | Summitt Mindset | VERIFY BEFORE SUBMISSION |
| iPhone-only target decision | V1 iPhone only — `v1-platform-scope.md`; confirm Xcode device family when authorized | VERIFY BEFORE SUBMISSION |
| Supported orientations | Phone portrait primary — confirm in project | VERIFY BEFORE SUBMISSION |
| Marketing version | Matches What’s New / portal | NOT RUN |
| Build number | Monotonic for uploads | NOT RUN |
| Production domain | `https://summittmindset.com` | VERIFY BEFORE SUBMISSION |
| Release signing | Distribution cert / profile ready | BLOCKED (ASC enrollment) |
| App Transport Security | HTTPS production posture | VERIFY BEFORE SUBMISSION |
| Debug flags | Off in Release | VERIFY BEFORE SUBMISSION |
| WebView inspection | Debug-only; Release non-inspectable | VERIFY BEFORE SUBMISSION |
| Icon | Final 1024 + app icons | WAITING ON ASSETS |
| Splash | Final splash asset applied | WAITING ON ASSETS |
| Account deletion | In-app path available | PASS (product proven; re-verify on Release build) |
| Native checkout suppression | No CTA; API blocked for native UA | PASS (re-verify on Release) |
| Meta Pixel suppression | Native UA does not load Pixel | PASS (physical 2026-07-21; re-verify Release) |

---

## Android

| Check | Expected / notes | Status |
|---|---|---|
| Package / application ID | `com.summittmindset.app` | VERIFY BEFORE SUBMISSION |
| Display name | Summitt Mindset | VERIFY BEFORE SUBMISSION |
| versionCode | Monotonic integer | VERIFY BEFORE SUBMISSION |
| versionName | Matches Play listing | VERIFY BEFORE SUBMISSION |
| minSdk / targetSdk | Confirm against current Play requirements | VERIFY BEFORE SUBMISSION |
| Cleartext traffic | Disabled | VERIFY BEFORE SUBMISSION |
| Release signing | Release keystore configured; **secrets out of git** | VERIFY BEFORE SUBMISSION |
| Upload certificate / Play App Signing | Documented privately; enroll in Play Console | BLOCKED (Play org) |
| WebView debugging | Off in Release | VERIFY BEFORE SUBMISSION |
| Production domain | `https://summittmindset.com` | VERIFY BEFORE SUBMISSION |
| Icon / adaptive icon | Final assets | WAITING ON ASSETS |
| Android 12+ splash theme | Applied with final splash | WAITING ON ASSETS |
| Account deletion | In-app path | PASS (re-verify Release / internal track) |
| Native checkout suppression | Passed on engineering matrix; re-verify | VERIFY BEFORE SUBMISSION |
| Meta Pixel suppression | Passed on engineering matrix; re-verify | VERIFY BEFORE SUBMISSION |
| Signed AAB | Built and locally verified | PASS (local); upload still BLOCKED on Play org |
| Physical device (father phone) | After Play internal testing | NOT RUN |

---

## Explicit non-claims

- This checklist does not prove store approval
- Local AAB verification ≠ Play acceptance
- No secrets are recorded here

---

## Related

- `waiting-on-assets.md`
- `release-regression-checklist.md`
- `v1-platform-scope.md`
