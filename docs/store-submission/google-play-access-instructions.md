# Google Play — App Access / Reviewer Instructions

**Status:** Copy into Play Console app-access / reviewer instructions when submitting.
**Last updated:** 2026-07-24
**Package:** `com.summittmindset.app`
**V1 device scope:** Phone-focused

> Placeholders only for credentials. No passwords in git.

---

## App access instructions (paste block)

```
Summitt Mindset — reviewer access

LOGIN PATH
1. Open the app.
2. You should land on Sign in (/app/sign-in).
3. Enter the reviewer email provided below.
4. Choose Sign in with password.
5. Enter the reviewer password provided below.
6. You should reach the Victory Room with an active membership entitlement. No emailed verification code is required for this reviewer account.

REVIEWER CREDENTIALS
• Email: [REVIEWER_EMAIL_PLACEHOLDER]
• Password: [REVIEWER_PASSWORD_PLACEHOLDER]
• MFA: disabled on the reviewer account
• Note: no reviewer backdoor; credentials are never hard-coded in the app; no mailbox/OTP required for review login

RESTRICTED / MEMBER CONTENT
Core coaching features (Victory Room, Ask Pat, Film Room) require a signed-in account with an active Summitt Mindset membership. The reviewer account is pre-entitled so purchase is not required.

HOW TO REACH CORE FUNCTIONALITY
1. Victory Room — home after sign-in; Current Goal and follow-through.
2. Daily coaching — review today’s coaching context from the member home / Victory Room.
3. Ask Pat — submit a short question related to the Current Goal.
4. Film Room — open a lesson and play the video.
5. Account — open Account (/user) for settings and legal links.

ACCOUNT DELETION
• In-app: Account → Danger zone → Delete account
• Also discoverable on the Membership required screen for inactive accounts
• Public URL: https://summittmindset.com/data-deletion
Please do not complete deletion on the shared reviewer account.

PURCHASES
The Android app does not initiate new subscription checkout and does not use Play Billing for new subscriptions in V1. Memberships are managed on the website. Do not attempt a live purchase inside the app.

SUPPORT
Support@SummittMindset.com
Privacy: https://summittmindset.com/privacy
```

---

## Support contact placeholder

| Field | Value |
|---|---|
| Email | `Support@SummittMindset.com` |
| Alternate review contact | `[REVIEW_CONTACT_EMAIL]` — **TYLER DECISION REQUIRED** if different |

---

## Related docs

- `reviewer-test-account-plan.md` — account setup, fictional demo content, reset rules, production password auth PASS record
- `google-play-metadata.md` — listing copy
- `waiting-on-assets.md` — Play org / AAB / physical testing status
