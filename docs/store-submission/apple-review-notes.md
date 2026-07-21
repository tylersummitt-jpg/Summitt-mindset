# Apple App Review Notes — Draft

**Status:** Copy into App Store Connect “Notes” when submitting.  
**Last updated:** 2026-07-21  

---

## Review notes (paste block)

```
Thank you for reviewing Summitt Mindset.

PRODUCT SUMMARY
Summitt Mindset is a membership coaching product. The iOS app is a native WKWebView shell that loads the live production website (https://summittmindset.com), starting at /app/sign-in. The website remains the product source of truth.

AUTHENTICATION
• In the iOS app, Sign in and Create account use Clerk email verification codes only.
• Google sign-in is intentionally not shown inside the app (website Google sign-in may remain available in Safari).
• Sign in with Apple is not offered in V1 because the app does not present third-party social login.

MEMBERSHIP / PAYMENTS
• Existing members with an active website membership can access Victory Room and member features after sign-in.
• New subscriptions are purchased on the website, not through In-App Purchase.
• The iOS app does not expose a new-subscription purchase CTA, Free Trial pricing solicitation, or Stripe Checkout path for native users.
• Native attempts to create Stripe Checkout sessions are blocked server-side.

ACCOUNT DELETION
• Account deletion is available in-app (Account / user settings Danger Zone, and on the inactive Membership required screen).
• Public web instructions: https://summittmindset.com/data-deletion
• Deletion does not require an active paid subscription.

DEMO ACCOUNT
• Use the provided reviewer email account (see App Review Information).
• Sign in with email verification code only (check the reviewer mailbox for the code).
• The reviewer account should already have an active membership entitlement so Victory Room, Ask Pat, and Film Room are reachable without purchasing.
• Do not attempt a live paid purchase inside the app; native purchase paths are intentionally unavailable.

HOW TO TEST CORE FEATURES
1. Open the app → /app/sign-in → Sign in with the reviewer email → enter email code.
2. After sign-in, you should reach Victory Room (subscribed entitlement).
3. Open Ask Pat and submit a short coaching question.
4. Open Film Room and play a lesson (Vimeo embed).
5. Open Account (/user): confirm Sign out and Delete account are separate controls.
6. Optional: open Privacy / Terms / Data Deletion from footer or account legal links.

SUPPORT
Support@SummittMindset.com

Privacy: https://summittmindset.com/privacy
Terms: https://summittmindset.com/terms
Data deletion: https://summittmindset.com/data-deletion
```

---

## Demo-account instructions (field-specific)

| Step | Instruction |
|---|---|
| 1 | Enter `[REVIEWER_EMAIL_PLACEHOLDER]` on Sign in |
| 2 | Request email code |
| 3 | Open the reviewer mailbox Tyler controls; copy the Clerk verification code |
| 4 | Enter code; wait for `/post-sign-in` routing to Victory Room |
| 5 | If routed to Membership required, entitlement was not applied — stop and ask Tyler to fix entitlement (do not purchase) |

See `reviewer-test-account-plan.md` for setup/reset rules. **No real passwords or codes in git.**

---

## Attachments / other

- No special hardware required  
- No location/camera/microphone permissions required  
- Film Room uses embedded Vimeo playback  
