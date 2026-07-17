# SUMMITT MINDSET — MOBILE APP MASTER PLAN
*Project-control document. Version 1.1. Created 2026-07-17. Read-only-audit basis. v1.1 (2026-07-17): recorded APP-003–APP-006 policy findings, the separate-mobile-repository decision, and the production-architecture correction (`server.url` is NOT approved production truth).*

---

## STATUS BANNER

| Field | Value |
|---|---|
| Plan version | 1.1 |
| Last verified date | 2026-07-17 |
| Current phase | Phase 1 — Platform-policy verification (findings recorded) |
| Current assigned task IDs | APP-003, APP-004, APP-005, APP-006 |
| Last completed task IDs | APP-003, APP-004, APP-005, APP-006 |
| Current blocker | None |
| Production shell architecture | **UNRESOLVED — pending proof of concept.** Capacitor is the leading candidate. `server.url` is NOT approved as final production implementation (it is Capacitor's dev/live-reload configuration). |
| Mobile repository | Separate repo `summitt-mindset-mobile` — **not yet created**. This document lives in the website/SMS repo. |
| Exact next task | **APP-007** — Check the Clerk dashboard for enabled login methods (email vs social). Requires Tyler + Clerk dashboard. |

> **How to use this document:** This is the single durable control document for the mobile-app project. It is designed so a brand-new ChatGPT conversation or a fresh Cursor session can resume with zero prior context. Read this file plus `docs/mobile-app-session-handoff.md` before doing anything. Never mark a task COMPLETE without recorded evidence. Move every scope addition to the parking lot (§12). Do not touch the SMS system. The production mobile shell lives in a **separate repository** (`summitt-mindset-mobile`); every task must confirm repository identity before editing (see DEC-013–DEC-017).

---

## 1. NORTH STAR

- **SMS is the primary product value.** The app must not modify, proxy, intercept, or endanger the Twilio SMS system (`src/app/api/cron/*`, `src/app/api/twilio/*`, `src/app/api/sms/*`, and the ~600-file SMS brain under `src/lib/`).
- **Victory Room is the secondary product value** and is the app's landing destination (`/dashboard/victory-room`).
- **The app exists to remove friction in reaching Victory Room** — tap icon, stay signed in, land in Victory Room. Nothing more in V1.
- **The website remains the product.** The live Next.js app at `https://summittmindset.com` is the single source of product truth.
- **The app is a doorway into the website**, not a second product.
- **One shared web experience must be preserved.** No duplicated screens in native code.
- **Website changes must automatically appear in the app.** The shell must render the live Summitt Mindset member experience so future website changes appear automatically without a new store submission. **The exact production load mechanism is unresolved and will be chosen at the proof-of-concept architecture checkpoint** — it is NOT assumed to be Capacitor `server.url` (that is a dev/live-reload configuration, not approved production truth).
- **The goal is not a native redesign.** No Victory Room / Ask Pat / Film Room redesign as part of this project.
- **The production mobile shell lives in a separate repository** (`summitt-mindset-mobile`); this website/SMS repo remains the current-business source of truth.

### PERMANENT MISSION STATEMENT (paste at the top of every future Cursor prompt)

> **Summitt Mindset Mobile App Mission:** We are building a polished iPhone + Android app that is a high-quality native shell around the live Summitt Mindset member experience (`https://summittmindset.com`) — NOT a separate native rewrite. The shell must render the live site so web changes appear automatically without a new store submission. **Capacitor is the leading candidate** for project management, native plugins, and shell functionality, but the final production shell architecture is **unresolved pending proof of concept** (candidates: Capacitor with a purpose-built production WebView; a minimal direct native iOS `WKWebView` + Android WebView shell; or a superior evidence-backed production-safe hybrid). `server.url` is NOT approved as the final production implementation. The app must let a member tap the icon, stay signed in via Clerk, and land directly in Victory Room (`/dashboard/victory-room`). The production shell lives in a **separate repo** (`summitt-mindset-mobile`); this is the website/SMS repo. We are NOT building native screens, NOT duplicating website screens, NOT pivoting to React Native, NOT redesigning any product surface, NOT touching the SMS system, and NOT adding features just because mobile apps usually have them. Every task must be justified by: "Is this required to let a member download the app, tap the icon, remain signed in, and enter the existing Victory Room safely and reliably?"

---

## 2. NON-NEGOTIABLE ARCHITECTURE PRINCIPLES

1. **One product codebase + a separate shell repository.** The Next.js website is the product and must preserve the one-codebase strategy. The mobile shell is a thin native wrapper that **must live in its own dedicated repository** (`summitt-mindset-mobile`) — never inside this website/SMS repo. No website secrets or server code may be copied into the mobile repo.
2. **Reuse the website directly** by rendering the live site so deploys to Vercel appear in the app automatically. The **exact production load mechanism is a proof-of-concept decision (see §7 Phase 2/4, DEC-020)** — Capacitor is the leading candidate, but `server.url` (a dev/live-reload setting) is NOT approved as final production truth, and a minimal direct native `WKWebView`/Android WebView shell remains a candidate.
3. **Do not duplicate screens natively and do not pivot to React Native.** No native Victory Room, Ask Pat, Film Room, account, or auth screens; no RN rewrite. Any architecture decision must preserve the one-codebase product strategy.
4. **Keep server secrets and server-only code on the server.** Never move `supabaseServer` (`src/lib/supabase-server.ts`, `import "server-only"`, service-role key), Clerk secret, Stripe secret, OpenAI, or Twilio into the app bundle. The app only ever talks to the site over HTTPS.
5. **Do not disturb SMS.** No app task may edit `src/lib/*sms*`, `src/lib/v2-*`, `src/lib/v3-*`, `src/app/api/cron/*`, `src/app/api/twilio/*`, or `vercel.json` crons. SMS is off-limits.
6. **Avoid app-specific forks in website behavior unless absolutely necessary.** If unavoidable (e.g., "open straight to Victory Room, hide marketing chrome"), gate it behind a **detectable app signal** (custom WebView User-Agent suffix, e.g. `SummittApp/1.0`, or a `?app=1` entry param) so it is isolated and greppable. Prefer changing the app's *start URL* over changing site code.
7. **App-specific code must be isolated and easy to identify, and must never cross repositories accidentally.** Any site-side adaptation lives in the website repo, must be tagged (e.g., a single `src/lib/app-webview.ts` helper + a clear comment banner), and must be greppable/removable. Mobile-shell code lives only in `summitt-mindset-mobile`. **No task edits both repositories unless explicitly authorized**, and app-related website changes require their own website-repository audit + implementation cycle.
8. **Existing production website behavior must remain safe.** Default web/browser behavior is unchanged; app adaptations are additive and behind the app signal.
9. **Every implementation phase must end in a testable state** with recorded evidence.
10. **No phase may begin until the preceding phase's exit criteria are satisfied** (see §17 checkpoints).
11. **No feature is added merely because mobile apps commonly have it.** Push, offline, widgets, biometrics, native nav, IAP → parking lot (§12) unless a store forces it.
12. **Every task confirms repository identity before editing** (`git rev-parse --show-toplevel`, `git remote -v`, `git branch --show-current`, `git status --short`) and stops without editing if the repo is wrong.
13. **Every repository receives its own `git status --short` and its own `git add .` safety verdict.** Verdicts are per-repo; a clean website repo says nothing about the mobile repo and vice versa.
14. **No website secrets, `.env` values, or server-only code (e.g., `supabaseServer`, service-role keys, Clerk/Stripe/OpenAI/Twilio secrets) may be copied into the mobile repository.** The shell talks to the site only over HTTPS.
15. **The final production shell architecture stays unresolved until the POC checkpoint decides it** (§7 Phase 4); no phase may hard-code a production dependency on `server.url` before then.

---

## 3. V1 DEFINITION

### Required for V1
- iOS + Android **native shell (Capacitor leading candidate; final architecture pending POC — DEC-020)** that **renders the live Summitt Mindset member experience** so web changes appear automatically. Lives in the separate `summitt-mindset-mobile` repo.
- Launches to **Victory Room** (`/dashboard/victory-room`); unauthenticated users hit the existing `/sign-in` → `/post-sign-in` flow and end at Victory Room.
- **Clerk session persists** across force-close/reopen (no repeated logins) to the agreed standard (see Checkpoint A pass criteria).
- **Entitlement recognized** unchanged (Clerk `publicMetadata.summittSubscribed`/`summittPlan`).
- Core reused surfaces load and function: **Victory Room (primary), Ask Pat, Film Room/Vimeo, Account** (`/user`).
- **No in-app selling in V1.** V1 does **not** show the Stripe checkout inside the app. Existing web subscribers access their membership normally; unsubscribed users receive a **neutral inactive-membership state** (no purchase UI). *(APP-004 finding; do not rely on reader-app classification; external-purchase language is storefront-dependent and must be re-verified before submission.)*
- **First-party email authentication is the preferred V1 login posture** (avoids triggering Apple's Sign in with Apple equivalent-login requirement). **CANDIDATE — pending APP-007** (Clerk-dashboard verification of which login methods are enabled); do not finalize before APP-007.
- **In-app account deletion action** (moved into Required for V1 per APP-005). Apple 5.1.1(v) requires an in-app deletion path when the app supports account creation, and Google requires both an in-app path and an external web resource. The current `data-deletion` page is **email-request only and is insufficient** as the complete app deletion flow. *(Design/implementation deferred to APP-041 — do not build deletion code now.)*
- App icon + splash screen + correct app name.
- Safe-area/status-bar handling; Android hardware back button behaves sanely.
- Basic loading + network-error state so a failed load isn't a white screen.
- Crash reporting + minimal analytics (launch, login success, reached-Victory-Room).
- Store listings (privacy nutrition labels / Play data-safety) that are **accurate** to the SMS/AI/journal data flows.

### Required only if Apple or Google demands it
- **Sign in with Apple** (only if Clerk exposes third-party/social logins such as Google in the sign-in UI — that triggers Apple 4.8 equivalent-login). *Verify Clerk dashboard (APP-007) + current Apple policy.*
- **Store-compliant handling of web checkout beyond the neutral inactive state** — external-purchase messaging/links, or (worst case) native IAP. Storefront-dependent (US external-link allowance differs from other storefronts). *Verify current Apple 3.1.1 / 3.1.1(a) / external-purchase-link + Google Play Billing policy before submission.*
- Web-push or native push **only** if required to clear "minimum functionality" (4.2).

### Strongly recommended but deferrable
- Deep links (SMS/marketing links open the app).
- App-signal-gated "app mode" that hides marketing Navbar and routes straight to Victory Room.
- TestFlight external testing group beyond internal.

### Post-launch
- Native push notifications (complement SMS).
- App-mode UI polish.
- Analytics depth.

### Explicitly out of scope
- Native Victory Room / Ask Pat / Film Room / onboarding rewrites.
- Offline mode, native navigation, animations, widgets, Apple Watch, biometric login, native share sheets.
- Native IAP unless policy forces it.
- Any new product feature, new pricing, or new SMS behavior.

---

## 4. CURRENT REPOSITORY BASELINE

*Verified 2026-07-17 against the working tree. Next.js `16.0.5`, React `18.2`, App Router. `git log` HEAD `21aa2b4`. See the "Baseline verification — 2026-07-17" section immediately below for the confirmed re-verification of each fact.*

| System | Current implementation | Relevant files | Reused unchanged | Adaptation needed | Risk |
|---|---|---|---|---|---|
| Victory Room | Async RSC, `dynamic="force-dynamic"`, `currentUser()` gate → `/sign-in`; loads many `lib/v2-victory-*` view builders | `src/app/dashboard/victory-room/page.tsx`, `src/lib/v2-victory-room-view.ts`, `src/components/Victory*` | Yes (rendered by site) | App start URL points here | Low (works in browser today) |
| Authentication | Clerk `@clerk/nextjs` ^6.35.5; `ClerkProvider` in root layout; `<SignIn/>`/`<SignUp/>` components | `src/app/layout.tsx`, `src/middleware.ts`, `src/app/sign-in/[[...sign-in]]/page.tsx`, `src/app/sign-up/[[...sign-up]]/page.tsx` | Yes | Verify session persistence in WebView; possibly OAuth redirect handling | **High** (top unknown) |
| Post-login routing | Canonical router: subscribe → onboarding → Victory Room | `src/app/post-sign-in/page.tsx`, `src/lib/onboarding-sob-gates.ts`, `src/lib/member-app-home-path.ts` (`/dashboard/victory-room`) | Yes | None (already lands at VR) | Low |
| Subscription entitlement | Clerk `publicMetadata.summittSubscribed`/`summittPlan`; read server + client | `src/components/SubscriptionGate.tsx`, `src/app/post-sign-in/page.tsx`, `src/components/Navbar.tsx` | Yes | None functionally | Low (but see Stripe/IAP) |
| Stripe checkout | Server route creates hosted session; client does `window.location.href = data.url` to Stripe domain | `src/app/api/stripe/create-checkout-session/route.ts`, `src/app/subscribe/subscribe-checkout-panel.tsx`, `src/app/api/stripe/webhook/route.ts` | Backend yes | **In-app purchase policy adaptation** | **High** (Apple 3.1.1) |
| Supabase | Service-role, server-only client | `src/lib/supabase-server.ts` | Yes (stays server-side) | Must never enter app bundle | Low if respected |
| API routes | 78 `route.ts` under `src/app/api/*` (ask-pat, profile, journal, stripe, sms, v2) | `src/app/api/**/route.ts` | Yes (same-origin fetch from WebView) | Verify cookie/credentialed fetch in WebView | Medium |
| SMS | Twilio + Vercel crons + huge `lib/` brain | `vercel.json`, `src/app/api/cron/*`, `src/app/api/twilio/*`, `src/lib/*sms*`, `v2-*`, `v3-*` | Yes | **None — do not touch** | High if disturbed |
| Ask Pat | Client component → `POST /api/ask-pat` (OpenAI) | `src/app/ask-pat/page.tsx`, `src/app/ask-pat/ask-pat-client.tsx`, `src/app/api/ask-pat/route.ts` | Yes | Verify fetch works in WebView | Low–Medium |
| Film Room / Vimeo | RSC lists videos from Supabase; detail page embeds `player.vimeo.com/video/{id}` iframe | `src/app/film-room/page.tsx`, `src/app/film-room/[id]/page.tsx` | Yes | Verify inline/fullscreen playback in iOS/Android WebView | Medium |
| Navigation | Client `Navbar` (marketing vs app links) | `src/components/Navbar.tsx` | Yes | Optional app-signal-gated hide of marketing nav | Low |
| Account/profile | Clerk `<UserProfile/>` + membership rows | `src/app/user/[[...user]]/page.tsx`, `src/components/manage-membership-button.tsx` | Yes | Verify Clerk profile UI in WebView | Medium |
| Data deletion | **Email-request page only** (no in-app delete) | `src/app/data-deletion/page.tsx` | Partially | **Likely need in-app deletion action** | **High** (Apple) |
| Privacy/terms/SMS | Static pages exist | `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/app/sms/page.tsx`, `src/app/twilio/page.tsx` | Yes | Link from store listings | Low |
| Analytics | Meta Pixel (marketing routes only), gated | `src/components/MetaPixelRoot.tsx`, `src/lib/meta-pixel*.ts` | Yes | Add app-level analytics/crash (native) | Low |
| Responsive design | Tailwind 4, CSS tokens, light-mode only; mobile menu in Navbar | `src/app/globals.css`, `src/components/Navbar.tsx` | Yes | Safe-area/notch CSS may need tweaks | Medium |
| App icons/assets | Brand images under `public/brand/` only; no app icon set | `public/brand/*` | Source art only | Generate icon/splash sets | Low |
| PWA support | **None** (no `app/manifest`, no service worker) | — | — | Not required for wrapper | N/A |
| Mobile-wrapper support | **None** (no Capacitor/Expo/RN in `package.json`) | `package.json` | — | Build from scratch in separate shell | Medium |

---

## Baseline verification — 2026-07-17

Re-verified against the current working tree (branch `main`, HEAD `21aa2b4c99cf3de65c7e7ba225385e9a74c0af1a`, clean tree) at the start of task APP-001. Every item below was directly inspected in the repository.

| # | Fact to verify | Verified value | Matches original audit? | Changes scope/architecture/risk/estimate? |
|---|---|---|---|---|
| 1 | Next.js version (`package.json`) | `^16.0.5` | Yes | No |
| 2 | React version (`package.json`) | `18.2.0` (and `react-dom` `18.2.0`) | Yes | No |
| 3 | Clerk package version (`package.json`) | `@clerk/nextjs` `^6.35.5` | Yes | No |
| 4 | `src/app/dashboard/victory-room/page.tsx` exists | Exists | Yes | No |
| 5 | Victory Room declares `dynamic = "force-dynamic"` | Yes (line 35: `export const dynamic = "force-dynamic";`) | Yes | No |
| 6 | Victory Room unauth redirect behavior | `const user = await currentUser();` then `if (!user?.id) redirect("/sign-in");` (lines 38–39) | Yes | No |
| 7 | `src/app/post-sign-in/page.tsx` uses canonical member-home routing | Yes — final line `redirect(MEMBER_APP_HOME_PATH);` after subscribe/onboarding gates; imports `MEMBER_APP_HOME_PATH` from `@/lib/onboarding-sob-gates` (re-export of the canonical constant) | Yes | No |
| 8 | `src/lib/member-app-home-path.ts` value | `export const MEMBER_APP_HOME_PATH = "/dashboard/victory-room" as const;` | Yes | No |
| 9 | Any Capacitor packages present | None in `package.json` | Yes (none) | No |
| 10 | Any Expo packages present | None in `package.json` | Yes (none) | No |
| 11 | Any React Native packages present | None in `package.json` | Yes (none) | No |
| 12 | Any PWA manifest or service worker present | None (no `manifest.ts`/`manifest.json`/`manifest.webmanifest`/`sw.js`/`service-worker*` under `src/app` or `public`) | Yes (none) | No |
| 13 | `src/app/data-deletion/page.tsx` is email/request flow (not direct deletion) | Yes — "How to Request Deletion" via `mailto:support@summittmindset.com`; no in-app delete action | Yes | No (confirms conditional in-app-deletion work in Phase 10 / APP-041) |
| 14 | Current branch / HEAD / working-tree status before changes | Branch `main`; HEAD `21aa2b4c99cf3de65c7e7ba225385e9a74c0af1a` ("victory room updates when goal changes"); `git status --short` empty (clean) | Yes | No |

**Discrepancies found:** None material. Minor clarification only: `MEMBER_APP_HOME_PATH` is imported into `post-sign-in/page.tsx` via the re-export in `@/lib/onboarding-sob-gates`, while the canonical definition lives in `src/lib/member-app-home-path.ts`. Both resolve to `/dashboard/victory-room`. This does not change scope, architecture, risk, or the ~115-hour estimate.

**Database note:** Cursor does not have direct Supabase access. All Supabase-related facts in this plan (service-role usage, `film_videos` table shape read by Film Room, Victory Room data reads) are based on **repository code usage only**, not live-database verification. Treat any database-schema claim as "as used in code," pending live verification if it ever becomes load-bearing.

---

## Policy verification — 2026-07-17

*Completed under APP-003, APP-004, APP-005, APP-006 (Phase 1). Sources fetched/verified 2026-07-17. Platform policies change and several items are subjective or storefront/region-dependent — each row records confidence and remaining ambiguity, and every purchase/deletion posture must be re-verified immediately before submission. Nothing here guarantees approval.*

| # | Policy | Source (title) | URL | Verified | Plain-English application to Summitt Mindset | Confidence | Remaining ambiguity |
|---|---|---|---|---|---|---|---|
| APP-003 | Apple Guideline **4.2 Minimum Functionality** | App Review Guidelines — Design 4.2 | https://developer.apple.com/app-store/review/guidelines/#minimum-functionality | 2026-07-17 | A shell that renders the live site is allowed but is a known rejection reason if it reads as "just a repackaged website." Our approval posture is strengthened by: personalized Victory Room content, the ongoing SMS coaching relationship, Ask Pat, Film Room, member entitlement, native loading/error handling, deep links, proper link/navigation handling, and (if needed) push notifications. Approval is **subjective and NOT guaranteed.** | Medium | Reviewer discretion; the exact bar for "enough native value" is not published. |
| APP-004 | Apple **3.1.1 In-App Purchase**, **3.1.1(a) external purchase links**, **3.1.3 reader / 3.1.3(a)(b)(f)** | App Review Guidelines — Business 3.1 | https://developer.apple.com/app-store/review/guidelines/#payments | 2026-07-17 | Existing web subscribers may access their membership in-app. Showing Stripe checkout **inside** the app risks a 3.1.1 violation → V1 shows **no purchase UI** (neutral inactive-membership state). External purchase **links** are storefront-dependent (broader latitude on the **US** storefront under 3.1.1(a); restricted elsewhere without entitlements). Summitt Mindset is **ambiguous** as a "reader app" (3.1.3) — do **not** rely on reader classification. | Medium | 3.1.1(a) is actively litigated/changing and region-specific; reader-app fit is unclear. Re-verify before submission. |
| APP-005 | Apple **5.1.1(v) account deletion** + **4.8 Login Services (Sign in with Apple)** | App Review Guidelines — 5.1.1(v) / 4.8 | https://developer.apple.com/app-store/review/guidelines/#data-collection-and-storage | 2026-07-17 | If the app supports account creation, Apple requires an **in-app account-deletion** path — the current email-only page is insufficient (→ APP-041, Required for V1). Sign in with Apple (4.8) is required **only if** a third-party/social login (e.g., Google) is offered; **first-party email auth avoids the trigger** (pending APP-007). | High (deletion), Medium (4.8 trigger) | Whether Clerk exposes social logins is unknown until APP-007. |
| APP-006 | **Google Play** minimum functionality, Payments/Play Billing, Account deletion, Data safety, closed-testing for new personal accounts | Play Console Help — policy center & testing requirements | https://support.google.com/googleplay/android-developer/answer/9859455 (policy center), https://support.google.com/googleplay/android-developer/answer/14151465 (new-account testing) | 2026-07-17 | Existing subscribers can access previously purchased membership. Do **not** sell subscriptions via outside billing inside V1. Account deletion requires **both** an in-app path **and** an external web resource (when applicable). **Data Safety** disclosures are mandatory and must match actual SMS/AI/journal flows. Certain **new personal** developer accounts (created after ~Nov 2023) require **12 testers opted in for 14 continuous days** of closed testing before production access — **Tyler must confirm account type and creation date** (APP-060). | Medium-High | Whether Tyler's Play account is subject to the 12-tester/14-day rule is unknown until he confirms; billing latitude is region-dependent. |

**Recommended V1 posture (from these findings):** iPhone-first is reasonable; hide all in-app purchasing; prefer first-party email login (pending APP-007); build direct in-app account deletion (APP-041) before submission; keep push notifications ready as a rejection response for 4.2. See §6 for the resulting estimate revision.

---

## Architecture correction — 2026-07-17

The prior audit described production use of `Capacitor server.url = https://summittmindset.com` as settled and fully compatible. **That is corrected here.** Official Capacitor documentation positions `server.url` within **live-reload/development** configuration, while ordinary **production** Capacitor projects serve compiled assets via `webDir`. Therefore:

1. The production mobile shell will live in a **separate repository** tentatively named `summitt-mindset-mobile`.
2. The shell must **render the live Summitt Mindset member experience** so future website changes automatically appear in the app.
3. **Capacitor remains a candidate** (leading) for project management, native plugins, and shell functionality.
4. **`server.url` is NOT approved** as the final production implementation.
5. The **final production architecture is unresolved** until the proof of concept compares: (a) Capacitor with a purpose-built production WebView; (b) a minimal direct native iOS `WKWebView` + Android WebView shell; (c) any superior production-safe hybrid architecture supported by evidence.
6. Do **not** pivot to React Native or duplicate website screens.
7. The POC must determine which shell provides: reliable Clerk session persistence, automatic live website updates, proper native navigation/link handling, the strongest App Store approval posture, and the lowest maintenance burden.
8. Any architecture decision must preserve the one-codebase product strategy.

See DEC-020 (decision log) and RISK-19 (risk register). Every place that previously presented `server.url` as settled production truth has been reclassified — see the final response §5 for the change list.

---

## 5. BIGGEST UNKNOWNS (ranked)

> All platform-policy items are **LABELED: REQUIRES CURRENT-DOCUMENTATION VERIFICATION** — do not treat as settled fact.

**U1 — Clerk session persistence inside iOS WKWebView (HIGHEST).**
- *Why:* The entire "stay signed in, no re-login" promise depends on Clerk cookies/session surviving in WKWebView across force-close. Clerk is cookie/session based (`@clerk/nextjs`).
- *Test early:* Phase 2 (first thing).
- *Cheapest test:* throwaway Capacitor iOS app loading the live `/sign-in`, log in, force-close, reopen, hit `/dashboard/victory-room`.
- *Pass:* reopening lands in Victory Room without re-login for at least a normal session lifetime.
- *Fail consequence:* users re-login constantly → core value destroyed.
- *Backup:* Clerk WebView/native guidance, custom cookie persistence config, or (last resort) `@clerk/clerk-expo`-style native auth (major scope change). *REQUIRES CLERK-DOC VERIFICATION.*
- *Hours at risk:* 10–24.

**U2 — Clerk session persistence inside Android WebView.**
- Same as U1 for Android WebView (different cookie/storage behavior). Test in Phase 3. Hours at risk: 6–16.

**U3 — Clerk OAuth / social-login behavior in WebView.**
- *Why:* If Clerk sign-in offers Google (or other social) login, OAuth opens an external browser/redirect that may not return cleanly to the WebView; also triggers Sign in with Apple requirement. Repo shows Clerk `<SignIn/>` but **social providers are configured in the Clerk dashboard, not in code** — cannot verify from repo.
- *Test:* Phase 2, alongside email login.
- *Pass:* whichever login methods you enable complete and return to the app.
- *Fail:* OAuth dead-ends. *Backup:* restrict app login to email/password + email code; hide social in app; or implement in-app-browser (`@capacitor/browser`) return handling. *REQUIRES CLERK-DASHBOARD + APPLE-DOC VERIFICATION.* Hours at risk: 4–16.

**U4 — Redirect/callback behavior (middleware, post-sign-in, subscribe returns).**
- *Why:* `middleware.ts` redirects unauth → `/sign-in`; `post-sign-in` chains redirects; Stripe returns to `/subscribe/success`. Redirect chains can loop or break in a WebView.
- *Test:* Phase 2. *Pass:* full logged-out→VR chain completes. *Backup:* app-signal-gated simplified entry route. Hours at risk: 3–10.

**U5 — Which production shell renders the live site best (architecture unresolved)?**
- *Why:* The "auto-update" mandate requires the shell to render the live site. **This does NOT dictate `server.url`** — that is Capacitor's dev/live-reload config, not approved production truth (see Architecture correction 2026-07-17, DEC-020). The POC must compare Capacitor-with-production-WebView vs a minimal native `WKWebView`/Android WebView shell (and any superior hybrid). Rendering the live site maximizes reuse but increases Apple 4.2 "just a website" risk.
- *Test:* Phase 1 (policy, done) + Phase 2/4 (technical + architecture decision). *Pass:* a candidate loads reliably, persists Clerk sessions, handles navigation/links, and is store-defensible. *Backup:* native-shell candidate; add native features. Hours at risk: 4–12. **VERIFY at Phase 4 checkpoint.**

**U6 — Cookies & middleware inside the wrapper (credentialed same-origin fetch).**
- *Why:* Client fetches (`ask-pat-client.tsx` uses `fetch("/api/ask-pat")`; subscribe uses `credentials: "include"`). WebView cookie policy must allow these.
- *Test:* Phase 2 (Ask Pat call). *Pass:* authenticated API calls succeed. Hours at risk: 3–8.

**U7 — Apple minimum-functionality rejection (4.2). VERIFIED 2026-07-17 (still reviewer-subjective).**
- *Why:* A shell rendering a website is a known rejection reason if it reads as "just a repackaged website."
- *Finding (APP-003):* Allowed but subjective. Posture strengthened by personalized Victory Room, ongoing SMS coaching, Ask Pat, Film Room, member entitlement, native loading/error handling, deep links, proper link/navigation handling, and potential push. **Approval is NOT guaranteed.** See Policy verification 2026-07-17.
- *Test:* Phase 1 research (done); real test at Phase 15.
- *Backup:* add push/native features; emphasize members-only utility. Hours at risk: 8–40 (includes possible push add). **Re-VERIFY reviewer stance before submission.**

**U8 — Apple subscription / external-checkout policy (3.1.1). VERIFIED 2026-07-17 (storefront-dependent, re-verify before submission).**
- *Why:* In-app path leads to Stripe web checkout (`window.location.href` to Stripe). Selling in-app violates 3.1.1.
- *Finding (APP-004):* V1 shows **no in-app purchase UI**; existing web subscribers access membership; unsubscribed see a neutral inactive state. External purchase **links** are storefront-dependent (broader US latitude under 3.1.1(a); restricted elsewhere). **Do not rely on reader-app (3.1.3) classification.** External-purchase language must be re-verified before submission.
- *Test:* Phase 1 research (done) + Phase 10 implementation. *Pass:* app doesn't sell in-app; entitlement-on-web recognized; messaging compliant. *Backup:* native IAP as last resort (+30–40h). Hours at risk: 6–40. **VERIFY storefront rules before submission.**

**U9 — Google Play subscription policy. VERIFIED 2026-07-17 (region-dependent, re-verify before submission).**
- *Finding (APP-006):* Existing subscribers access previously purchased membership; do **not** sell subscriptions via outside billing in V1; Play Billing rules differ from Apple and external-billing latitude is region-dependent. Hours at risk: 4–20. **Re-VERIFY before submission.**

**U10 — Web-purchased subscription access inside app.** Structurally fine (entitlement in Clerk metadata via webhook). Verify in Phase 2 with a subscribed test account. Hours at risk: 1–3.

**U11 — Account deletion compliance. VERIFIED 2026-07-17 — resolved into a requirement.** Apple 5.1.1(v) requires an **in-app deletion path** when the app supports account creation; Google requires **both** in-app **and** an external web resource. Current page is email-only (`data-deletion/page.tsx`) and is **insufficient**. **In-app deletion is now Required for V1** (§3, APP-041). Hours at risk: 3–12. *(No longer an open unknown; it is scoped work.)*

**U12 — Sign in with Apple requirement. VERIFIED 2026-07-17 (trigger confirmed; conditional on APP-007).** Apple 4.8 requires an equivalent login option **only if** third-party/social login (e.g., Google) is offered. **First-party email auth avoids the trigger** and is the preferred V1 posture — CANDIDATE pending APP-007 (Clerk dashboard). Hours at risk: 0–10. **VERIFY at APP-007.**

**U13 — Vimeo playback in WebView.** iframe autoplay/inline/fullscreen quirks on iOS. Test Phase 2/8. Backup: `allowsInlineMediaPlayback` config. Hours at risk: 2–10.

**U14 — Deep links.** `target="_blank"` links exist (`onboarding/sms/sms-client.tsx`, marketing pages) that may open blank/broken in WebView. Deferred feature but must not break flow. Hours at risk: 3–14.

**U15 — External links / new windows / popups.** Same `target="_blank"` concern + Stripe/Clerk external domains. Must configure which URLs open in-app vs system browser. Hours at risk: 2–8.

**U16 — File downloads / share cards.** `html2canvas`/`html-to-image` share cards (`VictoryShareCardPreview.tsx`) generate images client-side; download/share behavior differs in WebView. Deferred but note. Hours at risk: 1–6.

**U17 — Website deployment behavior after app release.** Because the app loads the live site, a bad web deploy instantly affects the app with no store gate. This is a **permanent operational risk**, not a one-time test. Mitigation: app-signal awareness so web changes consider the app; monitoring. Hours at risk: ongoing.

---

## 6. HOUR BUDGET

| Workstream | Best | Most likely | Conservative | In V1? | Notes |
|---|--:|--:|--:|---|---|
| Repo & architecture validation | 2 | 3 | 5 | Yes | Phase 0 |
| Platform-policy verification | 2 | 3 | 6 | Yes | Phase 1; Tyler + research |
| iOS proof of concept | 4 | 6 | 10 | Yes | Phase 2; highest-risk test |
| Android proof of concept | 2 | 4 | 8 | Yes | Phase 3 |
| Architecture decision checkpoint | 1 | 1 | 2 | Yes | Phase 4 |
| Capacitor + iOS + Android project setup | 5 | 7 | 16 | Yes | Phase 5 |
| App shell (status bar/safe area/back/loading) | 4 | 6 | 12 | Yes | Phase 5–6 |
| Direct-to-Victory-Room routing | 2 | 3 | 6 | Yes | Phase 7 |
| Clerk auth + session + OAuth hardening | 5 | 10 | 24 | Yes | Phase 6; biggest eng risk |
| Subscription handling + compliant messaging | 3 | 6 | 16 | Yes | Phase 10; policy-driven |
| Member-surface testing (VR focus, Ask Pat, Film/Vimeo, account) | 4 | 6 | 14 | Yes | Phase 8 |
| Links + deep links | 3 | 6 | 14 | Partial | Phase 9; deep links deferrable |
| Offline / network-error / error handling | 2 | 4 | 8 | Yes | Phase 11 |
| Icons + splash + branding assets | 3 | 5 | 10 | Yes | Phase 12 |
| Analytics + crash reporting | 3 | 5 | 10 | Yes | Phase 11 |
| Privacy review + account-deletion compliance | 3 | 5 | 12 | Yes/conditional | Phase 10 |
| Apple store setup | 3 | 5 | 12 | Yes | Phase 13/15; Tyler-heavy |
| Google Play setup | 2 | 4 | 10 | Yes | Phase 14/16; Tyler-heavy |
| Store descriptions + screenshots | 2 | 4 | 8 | Yes | Tyler-heavy |
| iOS real-device + TestFlight | 3 | 5 | 10 | Yes | Phase 13 |
| Android real-device + closed track | 3 | 5 | 10 | Yes | Phase 14 |
| Submission prep (both) | 2 | 2 | 6 | Yes | Phase 15/16 |
| Review-response buffer | 4 | 7 | 24 | Yes | Phase 17 |
| Documentation & handoff maintenance | 2 | 3 | 5 | Yes | ongoing |
| **TOTAL** | **~70** | **~115** | **~258** | | |

- **Most-likely total: ~115 focused hours** (matches the recommended estimate; repository evidence supports it).
- **Not included:** store review *waiting* time; native push notifications (parking lot); native IAP (only if forced — would add ~30–40h); any product redesign; ongoing web maintenance.
- **Could make it materially LOWER (~70h):** Clerk session "just works" in WebView on first try; Apple accepts the wrapper without a push requirement; iOS-first only; no rejection cycles; you already hold Apple/Google developer accounts.
- **Could make it materially HIGHER (~200h+):** Clerk fails in WebView (custom auth work); Apple forces native IAP; multiple 4.2/3.1.1 rejection cycles; Google new-account 14-day closed-testing friction; Vimeo playback problems.
- **Engineering hours (Cursor-heavy): ~65–70h** — Capacitor/shell setup, routing, auth/session hardening, subscription-messaging logic, error/loading states, analytics/crash wiring, member-surface fixes.
- **Tyler setup/testing/store-account hours: ~45–50h** — Apple Developer + Play Console enrollment, signing/provisioning, device testing, TestFlight/closed track, screenshots, privacy/data-safety forms, store copy, policy research.
- **Not included (unpredictable store-review waiting): separate** — Apple ~1–3 days/submission with possible rejection cycles; Google possibly a mandated ~14-day closed test for new personal accounts. *REQUIRES CURRENT-DOC VERIFICATION.*

### Estimate revision — 2026-07-17 (do not silently change; old value preserved)

- **Old value:** most-likely total **~115 focused hours** ("the 115-hour app").
- **New planning language (current responsible range):** **working target ≈ 115 focused hours; current responsible range ≈ 115–150 focused hours.** "The 115-hour app" is preserved as the **project shorthand** for the full polished middle-path version.
- **Reason:** APP-003–APP-006 confirmed that **in-app account deletion is now Required for V1** (not conditional) and that **push notifications** may be needed as a 4.2 rejection response; the **production shell architecture is unresolved pending POC** (Capacitor vs native shell), which adds comparison/decision effort; and Google's **12-tester/14-day** closed-testing rule may apply. The estimate **must be revised again after the architecture + Clerk-session POC**.
- **Explicitly separate (not folded into the range):** native IAP, native authentication, or any Apple-required major native feature are **separately-approved scope expansions**, not part of this range. Store-review *waiting* remains excluded.
- **False-precision caveat:** this is a planning range, not a promise. Treat the single-number total in the table as the working-target midpoint, not a commitment.

---

## 7. PHASED IMPLEMENTATION PLAN

*Sequence follows Phase 0–18. Each phase is 3–15 focused hours (some checkpoints shorter). Production website is NOT at risk in any phase unless explicitly noted; the shell renders the live site read-only (production mechanism chosen at Phase 4, DEC-020) and app-side adaptations are gated behind an app signal.*

### Phase 0 — Master-plan & repository baseline (~3h)
- **Goal:** Commit this master plan + baseline to the repo as the durable control document.
- **Why now:** Everything else references it.
- **Scope:** Create `docs/mobile-app-master-plan.md` (this document) and `docs/mobile-app-session-handoff.md`.
- **Non-scope:** Any Capacitor/app code.
- **Repo areas:** `docs/` only.
- **Accounts:** none.
- **Risks:** none.
- **Steps:** paste plan; confirm baseline facts still match repo; set all tasks NOT STARTED (except this phase's docs tasks once done).
- **Tests:** doc renders; task IDs unique.
- **DoD:** master plan + handoff files exist.
- **Evidence:** file paths + baseline verification section.
- **Safe stop:** after files created.
- **Rollback:** delete docs.
- **Website at risk?** No.
- **Before next phase:** plan approved by Tyler.

### Phase 1 — Current platform-policy verification (~3h)
- **Goal:** Confirm current Apple/Google/Clerk/Stripe policies for a native shell that renders the live site with web checkout.
- **Why now:** Policy shapes architecture (IAP, account deletion, Sign in with Apple, min-functionality) before any build.
- **Scope:** Research + write findings into the decision log. Confirm: 4.2 wrapper stance; 3.1.1 + external-purchase-link entitlements; reader-app rules; account-deletion requirement; Sign in with Apple triggers; Play Billing + new-account closed-testing.
- **Non-scope:** Code.
- **Repo areas:** `docs/` (decision log).
- **Accounts:** none yet (research only).
- **Risks:** policy ambiguity → record as assumptions to re-verify.
- **Tests:** each policy item has a dated source note.
- **DoD:** decision log updated with verified-as-of-date policy notes.
- **Evidence:** decision log entries with dates + links.
- **Safe stop:** after write-up.
- **Website at risk?** No.
- **Before next phase:** Tyler understands IAP/deletion posture.

### Phase 2 — Throwaway iPhone proof of concept (~6h)
- **Goal:** Kill or confirm the top risks (U1, U3, U4, U6, U10, U13) on real iOS hardware.
- **Why now:** Do the scariest test before serious investment.
- **Scope (must test):** website loads; Clerk **email** login; **session persists after force-close/reopen**; reaches Victory Room; authenticated API call (Ask Pat); Vimeo plays; external links behave; a **subscribed test account** sees entitlement; note OAuth if enabled.
- **Non-scope:** Icons, splash, store setup, polish, Android. **This POC is disposable — it must NOT become production architecture, and it does not settle the production shell (Phase 4 decides that).**
- **Repo areas:** none in the website; a *separate, disposable* throwaway project **outside** the Next.js repo (and separate from the eventual `summitt-mindset-mobile` production repo).
- **Accounts:** Apple ID for local device run (free provisioning ok); a test Clerk user (subscribed).
- **Risks:** Clerk WebView failure (U1) — the whole go/no-go.
- **Steps:** create a disposable Capacitor app pointed at the live `/dashboard/victory-room` (using `server.url` **for this dev/POC test only — NOT a production commitment**) → run on device → execute the test checklist → record every result. Also note observations relevant to choosing between a Capacitor-production-WebView vs a native `WKWebView` shell.
- **Tests:** the 9-item checklist above.
- **DoD:** every checklist item has PASS/FAIL + notes.
- **Evidence:** screenshots/screen-recording + a results table in the handoff doc.
- **Safe stop:** after checklist recorded.
- **Rollback:** delete throwaway project.
- **Website at risk?** No (read-only remote load).
- **Before next phase:** results feed Checkpoint A.

### Phase 3 — Android proof of concept (~4h)
- **Goal:** Repeat Phase 2 critical tests on Android WebView (U2).
- **Scope:** same checklist on Android emulator + one real device.
- **Non-scope:** production setup, polish.
- **Accounts:** none (local run).
- **DoD:** Android checklist recorded PASS/FAIL.
- **Evidence:** results table + captures.
- **Website at risk?** No.
- **Before next phase:** results feed Checkpoint B.

### Phase 4 — Architecture decision checkpoint (~1h)
- **Goal:** Formal **go/no-go AND production-shell architecture selection** based on POC evidence (Checkpoints A+B). This is where DEC-020's unresolved architecture is resolved.
- **Scope:** decide among candidates — **(a) Capacitor with a purpose-built production WebView, (b) a minimal direct native iOS `WKWebView` + Android WebView shell, (c) a superior evidence-backed production-safe hybrid** — on the basis of: reliable Clerk session persistence, automatic live-website updates, proper native navigation/link handling, strongest App Store approval posture, lowest maintenance burden. Also decide proceed / adapt auth. Record decision + any hour re-estimate. **`server.url` may only be chosen for production here with explicit recorded justification.**
- **Non-scope:** building; React Native; duplicating website screens.
- **DoD:** production-shell architecture chosen and logged with rationale (update DEC-020); estimate confirmed or revised (with reason).
- **Website at risk?** No.
- **Before next phase:** GO + architecture recorded.

### Phase 5 — Production app-shell foundation (~10h)
- **Goal:** Create the durable production shell (iOS + Android) **in the separate `summitt-mindset-mobile` repository**, using the architecture chosen at Phase 4, that renders production, with icons/splash placeholders, status bar, safe areas, loading state.
- **Why now:** Foundation for all further work, only after POC proves feasibility **and Phase 4 selects the shell architecture**.
- **Scope:** create/bootstrap `summitt-mindset-mobile` (repo-identity precheck first); build the Phase-4-selected shell (Capacitor-production-WebView **or** native `WKWebView`/Android WebView) that renders the live member experience — **not assumed to be `server.url`**; app name/bundle IDs; status-bar + safe-area handling; loading indicator; Android back-button config.
- **Non-scope:** auth deep work, store submission, deep links, analytics; editing this website repo (any needed site adaptation is a separate website-repo cycle).
- **Repo areas:** the `summitt-mindset-mobile` repo; possibly a tiny `src/lib/app-webview.ts` signal helper in the **website** repo (app-gated, separate authorized cycle) — only if needed.
- **Accounts:** Apple bundle ID + Android package name decisions.
- **Risks:** bundle-ID/signing confusion.
- **Tests:** app launches to VR on both platforms; safe areas correct; back button sane.
- **DoD:** installable dev build on both platforms loading production.
- **Evidence:** build logs + device screenshots.
- **Safe stop:** after both platforms build.
- **Rollback:** shell is separate; no website impact.
- **Website at risk?** No (unless an app signal helper is added to the site — gate + review).
- **Before next phase:** stable shell.

### Phase 6 — Authentication & session hardening (~10h)
- **Goal:** Make Clerk login + persistence robust to the agreed standard (U1–U4).
- **Scope:** configure WebView cookie/storage persistence; handle OAuth return if social enabled; ensure no redirect loops in `/sign-in`→`/post-sign-in`→VR; confirm entitlement recognized.
- **Non-scope:** rewriting auth natively (only if POC proved necessary → separate decision).
- **Repo areas:** Capacitor config; possibly app-gated site tweak (behind app signal) for OAuth return; **do not** change Clerk core web behavior.
- **Accounts:** Clerk dashboard (allowed origins / redirect URLs may need the app scheme).
- **Risks:** OAuth callback (U3), session expiry.
- **Tests:** login (email + any enabled social); force-close persistence; token refresh over time; entitlement gate.
- **DoD:** login + persistence meet Checkpoint standard on both platforms.
- **Evidence:** recorded multi-session test.
- **Website at risk?** Low (Clerk dashboard config affects web too — change carefully, test web login after).
- **Before next phase:** auth stable.

### Phase 7 — Direct-to-Victory-Room routing (~3h)
- **Goal:** Guarantee cold-launch lands in Victory Room for authed+subscribed users.
- **Scope:** set start URL / entry logic to `/dashboard/victory-room`; verify unauth path redirects correctly and returns to VR post-login.
- **Non-scope:** hiding nav/marketing chrome (optional, deferrable).
- **Repo areas:** Capacitor start config; optional app-gated entry route.
- **Tests:** cold launch authed → VR; cold launch unauth → sign-in → VR.
- **DoD:** both flows land in VR reliably.
- **Evidence:** screen recordings.
- **Website at risk?** No.

### Phase 8 — Member-surface compatibility testing (~6h)
- **Goal:** Verify reused surfaces work in-app. **Victory Room gets the most attention.**
- **Scope:** VR (all sections, share preview render, scrolling, links), then Ask Pat (submit → answer), Film Room (list + Vimeo playback), Account (`/user`, Clerk profile, manage membership). Log issues; fix only WebView-compat blockers.
- **Non-scope:** any redesign or feature change to these surfaces.
- **Repo areas:** test-only; fixes limited to WebView-compat CSS behind app signal if unavoidable.
- **Tests:** per-surface checklist; VR deep test.
- **DoD:** each surface PASS or documented deferrable issue.
- **Evidence:** per-surface results table.
- **Website at risk?** No (test-only).

### Phase 9 — Links, navigation & deep-link behavior (~6h)
- **Goal:** Correct in-app vs external link handling; optional deep links.
- **Scope:** define which URLs open in-app (same-origin) vs system browser (Stripe, `target="_blank"` marketing/SMS links in `onboarding/sms/sms-client.tsx`); prevent blank-window dead-ends. Deep links = strongly recommended, deferrable.
- **Non-scope:** rich universal-link routing (post-launch if heavy).
- **Tests:** every external link opens correctly; no white screens; back returns to app.
- **DoD:** link policy implemented + tested.
- **Website at risk?** No.

### Phase 10 — Compliance & account-management requirements (~10h combined)
- **Goal:** Satisfy store policy: purchase messaging, account deletion, privacy.
- **Scope:** store-compliant handling of the subscribe path inside the app (reader-app posture per Phase 1 findings); in-app account-deletion action if required (current `data-deletion` is email-only); accurate privacy/data-safety content.
- **Non-scope:** native IAP unless forced.
- **Repo areas:** possibly an app-gated adjustment to the subscribe/account surface; a real deletion endpoint if required (**must not touch SMS tables destructively without care** — scope a safe deletion path separately if built).
- **Accounts:** Apple/Google console privacy sections.
- **Risks:** U8/U9/U11.
- **Tests:** no in-app selling that violates policy; deletion path works if built.
- **DoD:** compliance checklist green for both stores.
- **Website at risk?** Medium if a deletion endpoint is built — design read-safe, review carefully, keep away from SMS pipelines.

### Phase 11 — Analytics, crash reporting & error handling (~9h combined)
- **Goal:** Observability + graceful failures.
- **Scope:** crash reporting (e.g., Sentry/Crashlytics) in the shell; minimal events (launch, login success, reached VR, load error); offline/network-error screen; timeout handling for the remote load.
- **Non-scope:** deep product analytics.
- **Tests:** force offline → error screen; trigger a crash → captured.
- **DoD:** crashes + key events visible in dashboards; no white-screen on failure.
- **Website at risk?** No.

### Phase 12 — Branding, icons, splash & store assets (~5h)
- **Goal:** Real app icon (brand orange `#f97316`), splash, screenshots per device size.
- **Scope:** generate icon/splash sets from `public/brand/` art; capture store screenshots from real devices.
- **Non-scope:** new brand design.
- **Accounts:** none.
- **DoD:** all required asset sizes present.
- **Website at risk?** No.

### Phase 13 — iOS real-device testing & TestFlight (~5h)
- **Goal:** Distribute internally via TestFlight; validate on real hardware.
- **Accounts:** **Apple Developer Program ($99/yr) enrollment, certs, provisioning.**
- **Tests:** full primary flow on TestFlight build.
- **DoD:** TestFlight build installable + primary flow passes.
- **Website at risk?** No.

### Phase 14 — Android real-device & closed-track testing (~5h)
- **Goal:** Play Console internal/closed testing.
- **Accounts:** **Google Play Console ($25 one-time); possible mandated closed-test period.**
- **DoD:** closed-track build passes primary flow.
- **Website at risk?** No.

### Phase 15 — Apple submission (~5h + review wait)
- **Goal:** Submit to App Store.
- **Scope:** App Privacy answers, review notes (explain reader-app + web entitlement + test credentials), submit.
- **Risks:** 4.2/3.1.1 rejection.
- **DoD:** submitted; status tracked.
- **Website at risk?** No.

### Phase 16 — Google submission (~4h + review wait)
- **Goal:** Submit to Play production.
- **DoD:** submitted; data-safety accurate.
- **Website at risk?** No.

### Phase 17 — Review responses & launch (~7h buffer)
- **Goal:** Resolve rejections; go live.
- **Scope:** respond to reviewer feedback; add native feature (e.g., push) *only if* required to clear 4.2.
- **DoD:** both apps approved + live.
- **Website at risk?** No.

### Phase 18 — Post-launch stabilization (ongoing, ~3h initial)
- **Goal:** Monitor; define web-deploy safety for the app (U17).
- **Scope:** watch crash/analytics; add a lightweight "does a web deploy break the app?" smoke check to the release habit; keep master plan current.
- **DoD:** monitoring defined; handoff doc current.
- **Website at risk?** Ongoing awareness (web deploys affect app live).

---

## 8. MASTER TASK TRACKER

*Statuses: NOT STARTED / IN PROGRESS / BLOCKED / COMPLETE / DEFERRED / REMOVED.*

**Repo ownership legend:** **WEBSITE** = this repo (`Summitt-mindset.git`): docs, policy records, Clerk-dashboard findings, any authorized site-side adaptation/deletion endpoint, master-plan maintenance. **MOBILE** = the separate `summitt-mindset-mobile` repo: shell code, native config, icons/splash, store builds/submissions. **POC** = disposable throwaway project (neither production repo). No task edits both repos unless explicitly authorized (DEC-016).

| ID | Phase | Repo | Task | Status | Est h | Act h | Dependencies | Evidence | Notes |
|---|---|---|---|---|--:|--:|---|---|---|
| APP-000 | 0 | WEBSITE | Create `docs/mobile-app-master-plan.md` from the approved plan | COMPLETE | 1 | NOT RECORDED | — | `docs/mobile-app-master-plan.md` created with sections 1–19 + status banner + baseline verification | Done 2026-07-17 |
| APP-001 | 0 | WEBSITE | Re-verify baseline table vs current repo; note diffs | COMPLETE | 1 | NOT RECORDED | APP-000 | "Baseline verification — 2026-07-17" section; 14/14 facts confirmed, no material discrepancy | Clean tree at `21aa2b4` |
| APP-002 | 0 | WEBSITE | Initialize decision log + risk register + parking lot + handoff | COMPLETE | 1 | NOT RECORDED | APP-000 | §10 decision log, §11 risk register, §12 parking lot embedded; `docs/mobile-app-session-handoff.md` created | Single-master-file + handoff approach |
| APP-003 | 1 | WEBSITE | Verify Apple 4.2 wrapper stance (current) | COMPLETE | 1 | NOT RECORDED | APP-002 | "Policy verification — 2026-07-17" section + official sources | Allowed but reviewer-subjective; not guaranteed |
| APP-004 | 1 | WEBSITE | Verify Apple 3.1.1 / 3.1.1(a) external-purchase-link + reader (3.1.3) rules | COMPLETE | 1 | NOT RECORDED | APP-002 | "Policy verification — 2026-07-17" section + official sources | V1 = no in-app selling; storefront-dependent; re-verify before submission |
| APP-005 | 1 | WEBSITE | Verify Apple account-deletion (5.1.1(v)) + Sign in with Apple (4.8) triggers | COMPLETE | 0.5 | NOT RECORDED | APP-002 | "Policy verification — 2026-07-17" section + official sources | In-app deletion now Required for V1; email-login avoids 4.8 |
| APP-006 | 1 | WEBSITE | Verify Google Play Billing + account deletion + data safety + new-account closed-test rules | COMPLETE | 0.5 | NOT RECORDED | APP-002 | "Policy verification — 2026-07-17" section + official sources | 12-tester/14-day rule may apply; Tyler must confirm account (APP-060) |
| APP-007 | 1 | WEBSITE | Check Clerk dashboard: which login methods are enabled (email/social) | NOT STARTED | 0.5 | | APP-005 | | **EXACT NEXT TASK.** Tyler + Clerk dashboard; decides 4.8/OAuth posture |
| APP-008 | 2 | POC | Create disposable throwaway iOS POC (NOT `summitt-mindset-mobile`, NOT production); repo-identity precheck | NOT STARTED | 1.5 | | APP-004,APP-007 | | Disposable; does not settle production shell |
| APP-009 | 2 | POC | Load production URL `/dashboard/victory-room` on iOS device | NOT STARTED | 0.5 | | APP-008 | | |
| APP-010 | 2 | POC | Test Clerk email login on iOS | NOT STARTED | 0.5 | | APP-009 | | U3 |
| APP-011 | 2 | POC | Test session persistence after iOS force-close/reopen | NOT STARTED | 0.5 | | APP-010 | | U1 (critical) |
| APP-012 | 2 | POC | Test reaching Victory Room authed on iOS | NOT STARTED | 0.5 | | APP-011 | | |
| APP-013 | 2 | POC | Test authenticated API call (Ask Pat) on iOS | NOT STARTED | 0.5 | | APP-012 | | U6 |
| APP-014 | 2 | POC | Test Vimeo playback on iOS | NOT STARTED | 0.5 | | APP-012 | | U13 |
| APP-015 | 2 | POC | Test external-link behavior on iOS | NOT STARTED | 0.5 | | APP-012 | | U15 |
| APP-016 | 2 | POC | Test subscribed-account entitlement recognized on iOS | NOT STARTED | 0.5 | | APP-012 | | U10 |
| APP-017 | 2 | POC | Record iOS POC results table + captures | NOT STARTED | 0.5 | | APP-009,APP-010,APP-011,APP-012,APP-013,APP-014,APP-015,APP-016 | | Feeds Checkpoint A |
| APP-018 | 3 | POC | Create throwaway Android POC + run emulator/device | NOT STARTED | 1.5 | | APP-017 | | |
| APP-019 | 3 | POC | Repeat critical checklist on Android (login/persist/VR/API/Vimeo) | NOT STARTED | 2 | | APP-018 | | U2 |
| APP-020 | 3 | POC | Record Android POC results table | NOT STARTED | 0.5 | | APP-019 | | Feeds Checkpoint B |
| APP-021 | 4 | WEBSITE | Architecture go/no-go **+ production-shell selection** + estimate confirm/revise | NOT STARTED | 1 | | APP-017,APP-020 | | Checkpoint (§17); resolves DEC-020 |
| APP-022 | 5 | MOBILE | Bootstrap the separate `summitt-mindset-mobile` repo + create production shell (iOS+Android) per Phase-4 architecture, bundle IDs; repo-identity precheck | NOT STARTED | 3 | | APP-021,APP-059 | | Depends on APP-059 repo creation |
| APP-023 | 5 | MOBILE | Configure the Phase-4-selected production load mechanism (render live site) — NOT assumed `server.url` | NOT STARTED | 1 | | APP-022 | | `server.url` only with recorded Phase-4 justification |
| APP-024 | 5 | MOBILE | Status bar + safe-area handling both platforms | NOT STARTED | 2 | | APP-023 | | |
| APP-025 | 5 | MOBILE | Android hardware back-button behavior | NOT STARTED | 1 | | APP-023 | | |
| APP-026 | 5 | MOBILE | Loading indicator for remote load | NOT STARTED | 1 | | APP-023 | | |
| APP-027 | 6 | MOBILE | WebView cookie/storage persistence config (iOS) | NOT STARTED | 3 | | APP-023 | | U1 |
| APP-028 | 6 | MOBILE | WebView cookie/storage persistence config (Android) | NOT STARTED | 2 | | APP-023 | | U2 |
| APP-029 | 6 | MOBILE | OAuth/social return handling (if social enabled) | NOT STARTED | 3 | | APP-007,APP-027 | | U3; may be DEFERRED if email-only (APP-061) |
| APP-030 | 6 | MOBILE | Verify no redirect loop `/sign-in`→`/post-sign-in`→VR | NOT STARTED | 2 | | APP-027 | | U4 |
| APP-031 | 7 | MOBILE | Set cold-launch start to Victory Room | NOT STARTED | 1 | | APP-030 | | |
| APP-032 | 7 | MOBILE | Verify unauth cold-launch returns to VR post-login | NOT STARTED | 2 | | APP-031 | | |
| APP-033 | 8 | MOBILE | Victory Room full in-app compatibility test | NOT STARTED | 2.5 | | APP-031 | | Highest attention |
| APP-034 | 8 | MOBILE | Ask Pat in-app test | NOT STARTED | 1 | | APP-031 | | |
| APP-035 | 8 | MOBILE | Film Room + Vimeo in-app test | NOT STARTED | 1.5 | | APP-031 | | |
| APP-036 | 8 | MOBILE | Account/`/user` + manage-membership in-app test | NOT STARTED | 1 | | APP-031 | | |
| APP-037 | 9 | MOBILE | Define + implement in-app vs external link policy | NOT STARTED | 3 | | APP-031 | | U15 |
| APP-038 | 9 | MOBILE | Handle `target="_blank"` links (no blank dead-ends) | NOT STARTED | 1.5 | | APP-037 | | onboarding/sms + marketing |
| APP-039 | 9 | MOBILE | Deep links (SMS/marketing → app) | NOT STARTED | 1.5 | | APP-037 | | DEFERRABLE |
| APP-040 | 10 | MOBILE | Store-compliant subscribe/purchase messaging in app (V1 = neutral inactive-membership state, no in-app selling) | NOT STARTED | 4 | | APP-004,APP-021 | | U8/U9 |
| APP-041 | 10 | WEBSITE | In-app account-deletion action — **REQUIRED before submission** (Apple 5.1.1(v)/Google) | NOT STARTED | 3 | | APP-005 | | Keep away from SMS tables; no longer conditional |
| APP-042 | 10 | WEBSITE | Draft accurate privacy/data-safety content | NOT STARTED | 2 | | APP-005,APP-006 | | Tyler + forms |
| APP-043 | 11 | MOBILE | Integrate crash reporting in shell | NOT STARTED | 2.5 | | APP-022 | | |
| APP-044 | 11 | MOBILE | Minimal analytics events (launch/login/VR/error) | NOT STARTED | 2 | | APP-043 | | |
| APP-045 | 11 | MOBILE | Offline/network-error screen + load timeout | NOT STARTED | 3 | | APP-026 | | |
| APP-046 | 12 | MOBILE | Generate app icon set (both platforms) | NOT STARTED | 2 | | APP-022 | | |
| APP-047 | 12 | MOBILE | Generate splash screens | NOT STARTED | 1.5 | | APP-022 | | |
| APP-048 | 12 | MOBILE | Capture store screenshots per device size | NOT STARTED | 2 | | APP-033 | | Tyler |
| APP-049 | 13 | MOBILE | Apple Developer enrollment + signing/provisioning | NOT STARTED | 2.5 | | APP-021 | | Tyler + Apple |
| APP-050 | 13 | MOBILE | iOS TestFlight build + internal test | NOT STARTED | 2.5 | | APP-049,APP-046 | | |
| APP-051 | 14 | MOBILE | Play Console setup + signing | NOT STARTED | 2 | | APP-021,APP-060 | | Tyler + Google |
| APP-052 | 14 | MOBILE | Android closed-track build + test | NOT STARTED | 3 | | APP-051,APP-046 | | Possible 12-tester/14-day wait (APP-060) |
| APP-053 | 15 | MOBILE | Apple store listing + App Privacy + review notes | NOT STARTED | 3 | | APP-041,APP-042,APP-048,APP-050 | | Deletion (APP-041) required first |
| APP-054 | 15 | MOBILE | Submit to App Store | NOT STARTED | 0.5 | | APP-053 | | Checkpoint D first |
| APP-055 | 16 | MOBILE | Play listing + data-safety + submit | NOT STARTED | 3.5 | | APP-041,APP-042,APP-048,APP-052 | | Checkpoint E first; deletion required |
| APP-056 | 17 | MOBILE | Respond to review feedback (buffer) | NOT STARTED | 7 | | APP-054,APP-055 | | |
| APP-057 | 18 | MOBILE | Define post-launch monitoring + web-deploy smoke check | NOT STARTED | 3 | | APP-056 | | U17; smoke check touches website repo (separate cycle) |
| APP-058 | all | WEBSITE | Maintain master plan + handoff each session | NOT STARTED | 3 | | APP-000 | | ongoing |
| APP-059 | 5 | MOBILE | Create/bootstrap the `summitt-mindset-mobile` repository (repo-identity + `.gitignore` + no secrets); own git verdict | NOT STARTED | 1 | | APP-021 | | Repo not yet created; blocks APP-022 |
| APP-060 | 1 | WEBSITE | Tyler confirms Google Play account type + creation date (12-tester/14-day applicability) | NOT STARTED | 0.5 | | APP-006 | | Tyler + Play Console |
| APP-061 | 6 | WEBSITE | Finalize V1 login posture (email-only vs social) after APP-007; record decision | NOT STARTED | 0.5 | | APP-007 | | Confirms/settles DEC-018 |

---

## 9. DEPENDENCY MAP

- **Critical path:** APP-000 → APP-003/004/005/006 (policy, COMPLETE) → **APP-007 (Clerk dashboard)** → APP-008..017 (iOS POC) → APP-021 (go/no-go **+ shell architecture**) → **APP-059 (create mobile repo)** → APP-022/023 (shell) → APP-027/028/030 (auth+session) → APP-031/032 (VR routing) → **APP-041 (in-app deletion, required)** + APP-040 (purchase compliance) → APP-049/050 (TestFlight) / APP-051/052 (closed track) → APP-053/054 & APP-055 (submit) → APP-056 (review) → launch.
- **Repo ownership on the path:** planning/policy/deletion-endpoint/docs are **WEBSITE**; shell/config/store builds are **MOBILE** (`summitt-mindset-mobile`); POC tasks are disposable **POC** projects. No task edits both repos without explicit authorization (DEC-016).
- **New dependencies:** APP-022 now depends on **APP-059** (mobile repo must exist first). APP-051/052 depend on **APP-060** (Play account confirmation). APP-053/APP-055 depend on **APP-041** (in-app deletion required before submission). APP-061 depends on APP-007.
- **Parallelizable:** Android POC (APP-018..020) alongside finishing iOS notes; icons/splash (APP-046/047) alongside auth; analytics/crash (APP-043/044) alongside member-surface testing; store copy/screenshots drafting (APP-042/048) alongside compliance; APP-060 (Tyler confirms Play account) anytime after APP-006.
- **Require Tyler:** APP-007 (Clerk dashboard), APP-042/048 (privacy + screenshots), all device testing, all store-account tasks.
- **Require Apple Developer access:** APP-049, APP-050, APP-053, APP-054.
- **Require Google Play access:** APP-051, APP-052, APP-055.
- **Require Clerk configuration:** APP-007, APP-029, APP-030 (allowed origins/redirect URLs).
- **Require DNS/domain changes:** *only if* you adopt an `app.summittmindset.com` alias (APP-023) — otherwise none.
- **Require production deployments:** none for core wrapper; only if an app-signal helper is added to the site (Phase 5/6/7) or a deletion endpoint (APP-041).
- **Require current policy research:** APP-003..006.
- **Must wait until app IDs + signing identities exist:** APP-050, APP-052, APP-053, APP-055 (all submission/testing tasks).

---

## 10. DECISION LOG

| Decision ID | Decision | Reason | Date | Status | Revisit trigger |
|---|---|---|---|---|---|
| DEC-001 | Website remains the product | Single source of truth; startup pivots frequently | 2026-07-17 | ACTIVE | Fundamental strategy change |
| DEC-002 | SMS remains primary value; app must not touch it | SMS is the core product (`lib/` + crons) | 2026-07-17 | ACTIVE | Product priority change |
| DEC-003 | Victory Room is the app landing destination | Second-most valuable surface | 2026-07-17 | ACTIVE | VR deprecated/renamed |
| DEC-004 | Capacitor is the **leading candidate** shell (not React Native) | Reuse 100% of RSC UI; RN = full rewrite. Reclassified from "confirmed" to "leading candidate pending POC" (see DEC-020) | 2026-07-17 | ACTIVE (amended) | POC fails (Checkpoint A/B) |
| DEC-005 | ~~Load production remotely via `server.url`~~ **AMENDED:** render the live site so web changes auto-appear; production load mechanism is **UNRESOLVED pending POC** — `server.url` is a dev/live-reload config and is **NOT approved production truth** | "Web changes appear automatically" mandate remains; but `server.url` was wrongly recorded as settled production. See Architecture correction 2026-07-17 + DEC-020 | 2026-07-17 | AMENDED — superseded by DEC-020 | Phase 4 architecture decision |
| DEC-006 | One shared website codebase; no native screens | Avoid second product | 2026-07-17 | ACTIVE | — |
| DEC-007 | Push notifications deferred unless required for approval | Not needed for core flow; SMS covers it | 2026-07-17 | ACTIVE | Apple 4.2 rejection requires it |
| DEC-008 | Native IAP deferred unless policy forces it | Web + SMS conversion already works; entitlement in Clerk | 2026-07-17 | ACTIVE | Apple 3.1.1 rejection |
| DEC-009 | No product redesign during app project | Scope control | 2026-07-17 | ACTIVE | — |
| DEC-010 | Future web deploys should update the app automatically | Startup velocity | 2026-07-17 | ACTIVE | — |
| DEC-011 | App-specific site behavior only behind a detectable app signal | Isolation/greppability | 2026-07-17 | ACTIVE | — |
| DEC-012 | Master plan lives in one file + append-only handoff log | Easiest for Cursor/ChatGPT continuity | 2026-07-17 | ACTIVE | Files grow unwieldy |
| DEC-013 | **Mobile shell lives in a separate Git repository** (`summitt-mindset-mobile`) | Safety + workflow isolation; independent `git add .`; no contamination of the website/SMS repo | 2026-07-17 | ACTIVE | Fundamental strategy change |
| DEC-014 | **Website repository remains the current-business repository** | It is the live product source of truth | 2026-07-17 | ACTIVE | — |
| DEC-015 | **App-related website changes require their own website-repo audit + implementation cycle** | Prevents mobile work from silently changing the live product | 2026-07-17 | ACTIVE | — |
| DEC-016 | **Every task confirms repo identity before editing; every repo gets its own `git status --short` + `git add .` verdict; no task edits both repos unless explicitly authorized** | Cross-repo safety | 2026-07-17 | ACTIVE | — |
| DEC-017 | **No website secrets or server-only code may be copied into the mobile repo** | Security; shell talks to site only over HTTPS | 2026-07-17 | ACTIVE | — |
| DEC-018 | **CANDIDATE:** V1 login = first-party email authentication (avoid Apple 4.8 Sign in with Apple trigger) | APP-005 finding; social login triggers 4.8 | 2026-07-17 | CANDIDATE — pending APP-007/APP-061 | APP-007 shows social logins enabled |
| DEC-019 | **CANDIDATE:** iPhone-first sequencing; hide all in-app purchasing in V1 (neutral inactive-membership state) | APP-003/APP-004 posture; lowers Apple risk | 2026-07-17 | CANDIDATE — confirm at Phase 4/Checkpoint D | Policy re-verification changes posture |
| DEC-020 | **Production shell architecture is UNRESOLVED pending POC.** Candidates: (a) Capacitor + purpose-built production WebView, (b) minimal direct native iOS `WKWebView` + Android WebView shell, (c) superior evidence-backed hybrid. `server.url` NOT approved as production. Do NOT pivot to React Native or duplicate screens. Decision made at Phase 4 on: Clerk session persistence, auto live updates, native nav/link handling, App Store posture, maintenance burden | Official Capacitor docs place `server.url` in dev/live-reload; production uses compiled `webDir`. Prior audit wrongly recorded `server.url` as settled production | 2026-07-17 | ACTIVE (open) | Phase 4 architecture checkpoint resolves it |

---

## 11. RISK REGISTER

| Risk ID | Risk | Prob | Impact | Early warning | Mitigation | Fallback | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| RISK-01 | Clerk session fails in WebView | Med | Critical | POC login/persist fails | WebView cookie config; Clerk WebView guidance | Native auth adaptation (major) | Tyler+Cursor | OPEN |
| RISK-02 | OAuth callback fails in WebView | Med | High | Social login dead-ends in POC | In-app-browser return handling; email-only in app | Hide social in app | Tyler+Cursor | OPEN |
| RISK-03 | Repeated sign-ins / session expiry | Med | High | Users re-login on reopen | Token refresh + persistence tuning | Extend session; document standard | Cursor | OPEN |
| RISK-04 | Apple 4.2 minimum-functionality rejection | Med-High | High | Reviewer cites "just a website" | Add native features (push), members-only framing | Add push; richer native shell | Tyler | OPEN |
| RISK-05 | Apple 3.1.1 payment rejection | Med | High | Reviewer flags web checkout | V1 shows **no in-app selling** (neutral inactive state); do NOT rely on reader-app classification; external purchase **links** are **storefront-dependent** (broader US latitude under 3.1.1(a), restricted elsewhere) — re-verify per storefront before submission | Native IAP (+30–40h) | Tyler | OPEN |
| RISK-06 | Google payment-policy issue | Low-Med | Med | Play flags external billing | Same reader posture | Play Billing | Tyler | OPEN |
| RISK-07 | Vimeo WebView playback issue | Low-Med | Med | POC video won't play inline | `allowsInlineMediaPlayback`, fullscreen config | Native player (deferred) | Cursor | OPEN |
| RISK-08 | External-link/new-window dead-ends | Med | Med | Blank screens on `_blank` links | In-app vs system-browser policy | Force system browser | Cursor | OPEN |
| RISK-09 | Website update breaks the app | Med | High | App breaks with no store change | Web-deploy smoke check; app-signal awareness | Roll back web deploy | Tyler | OPEN |
| RISK-10 | Production domain outage takes app down | Low | High | Site down = app blank | Offline/error screen; status monitoring | Error screen + retry | Tyler | OPEN |
| RISK-11 | Wrapper-specific CSS problems (safe area/notch) | Med | Low-Med | Overlap under notch/status bar | Safe-area CSS behind app signal | Minor CSS fixes | Cursor | OPEN |
| RISK-12 | Deep-link failure | Low | Low | Links don't open app | Standard universal/app links | Defer deep links | Cursor | OPEN |
| RISK-13 | Account-deletion noncompliance | Med | High | Apple flags no in-app deletion | Build in-app deletion action | Expedite deletion endpoint | Tyler+Cursor | OPEN |
| RISK-14 | Privacy-disclosure error | Med | Med | Store flags data-safety mismatch | Careful audit of SMS/AI/journal data | Correct + resubmit | Tyler | OPEN |
| RISK-15 | Scope creep | High | High | Tasks not passing Master Scope Rule | §12 parking lot; scope test | Reject to parking lot | Tyler | OPEN |
| RISK-16 | App-specific code contaminates main product | Med | Med | Ungated app code in site | Gate behind app signal; isolate helper | Refactor/remove | Cursor | OPEN |
| RISK-17 | Website pivots during app implementation | High | Med | VR/routes change mid-project | Loose coupling to remote site; retest after web changes | Update baseline + retest | Tyler | OPEN |
| RISK-18 | Master-plan doc goes stale | Med | High | Statuses not updated | §13 handoff protocol every session | Reconstruct from git + tracker | Cursor | OPEN |
| RISK-19 | **Premature commitment to a development-oriented remote-server config (`server.url`) as production** | Med | High | Plans/tasks treat `server.url` as the settled production mechanism before Phase 4 | Keep architecture unresolved until POC (DEC-020); `server.url` only for disposable POC; production mechanism chosen at Phase 4 with recorded justification | Adopt native `WKWebView`/Android WebView shell or Capacitor `webDir`-based production build | Cursor+Tyler | OPEN |
| RISK-20 | **Cross-repo contamination / secret leakage between website and `summitt-mindset-mobile`** | Med | High | App code appears in website repo, or website secrets/server code appear in mobile repo | Repo-identity precheck every task (DEC-016); no shared secrets (DEC-017); per-repo git verdicts | Revert offending commit; rotate any leaked secret | Cursor+Tyler | OPEN |
| RISK-21 | **Google Play 12-tester / 14-day closed-testing delay for new personal accounts** | Med | Med | Play Console blocks production until closed test completes | Confirm account type/creation date early (APP-060); recruit 12 testers ahead of Android submission | Sequence iPhone-first; start Android closed test early | Tyler | OPEN |

---

## 12. SCOPE-CREEP PARKING LOT

| Idea | Why it is not V1 | Possible future phase | Trigger to reconsider |
|---|---|---|---|
| Push notifications | SMS covers engagement; not needed for core flow | Post-launch / Phase 17 if forced | Apple 4.2 requires it, or retention need |
| Native Victory Room rewrite | Violates "reuse website" | Never (unless strategy changes) | Web VR performance unacceptable in WebView |
| Offline mode | Not needed to reach VR online | Post-launch | Users demand offline VR |
| Native navigation | No native screens in scope | Post-launch | UX complaints |
| Native subscriptions (IAP) | Web + SMS conversion works | Only if policy forces | Apple/Google rejection |
| Apple Watch | Out of scope | Never planned | New strategy |
| Home-screen widgets | Out of scope | Post-launch | Retention experiment |
| Native share sheets | Web share cards exist | Post-launch | Share friction reported |
| Biometric login | Clerk session persistence handles convenience | Post-launch | Security requirement |
| Advanced native analytics | Minimal events suffice for V1 | Post-launch | Data needs grow |
| New onboarding | Reuse existing web onboarding | Never (this project) | Product decision |
| Victory Room redesign | No redesign in app project | Separate web project | Product decision |
| Ask Pat redesign | Supporting surface; reuse | Separate web project | Product decision |
| Film Room redesign | Supporting surface; reuse | Separate web project | Product decision |
| New SMS behavior | SMS off-limits | Separate SMS project | Explicit approval |
| New pricing | Out of scope | Separate web project | Business decision |
| New app-only features | Contradicts "one product" | Post-launch consideration | Strong validated need |

---

## 13. STOPPING AND RESUMING PROTOCOL

At the **end of every implementation session**, Cursor must append a handoff entry (to `docs/mobile-app-session-handoff.md`) containing all of the following:

**Session summary** — Date; tasks attempted (IDs); completed (IDs); partially completed (IDs + % + what remains); blocked (IDs + blocker); actual focused hours.

**Repository identity + state (PER REPO)** — For **each** repository touched this session (website `Summitt-mindset.git` and/or `summitt-mindset-mobile`): confirmed repo identity (`git rev-parse --show-toplevel`, `git remote -v`, branch); latest commit hash; `git status --short` output; staged? committed? pushed?; **its own explicit verdict: is that repo's full worktree safe for `git add .`?**; list untracked files; any env/config changes not stored in git (and where they live). A clean verdict for one repo says nothing about the other (DEC-013/DEC-016). State whether `summitt-mindset-mobile` exists yet.

**Testing state** — Tests run/passed/failed (names); manual device tests completed; manual tests still required; current Vercel deploy status; current iOS build status; current Android build status.

**External state** — Apple Developer setup status; Google Play setup status; TestFlight status; Google testing-track status; store submission status; any review messages received; credentials/access Tyler still needs to provide.

**Exact resume point** — Next task ID; exact next action (one sentence); files likely involved; prerequisite checks to run first; known risks; **what NOT to redo**; **what NOT to touch** (always includes: SMS system, `supabaseServer`, server secrets, `vercel.json` crons).

> The handoff must be self-contained: a brand-new ChatGPT conversation with zero prior context must be able to resume correctly from it alone.

---

## 14. MASTER-PLAN MAINTENANCE RULES

**File structure in use:**
- **`docs/mobile-app-master-plan.md`** — the durable spine (sections 1–19, including task tracker, decision log, risk register, parking lot). Primary document.
- **`docs/mobile-app-session-handoff.md`** — rolling append-only handoff log (§13).
- Split the decision log / risk register into their own files (`docs/mobile-app-decision-log.md`, `docs/mobile-app-risk-register.md`) **only if** they outgrow ~1 screen each.

**Recommendation:** One master file + one append-only handoff file. Fewer files = less drift and a fresh ChatGPT/Cursor session can load full context in one read. The task tracker stays inside the master file so status and plan never diverge.

**Maintenance rules:**
- Update task statuses after every session.
- Record actual hours next to estimates (write `NOT RECORDED` rather than inventing).
- Never erase completed history (append, don't overwrite).
- Add every decision to the decision log with a date.
- Add newly discovered risks to the register.
- Move any scope addition to the parking lot (§12) — never silently into V1.
- Update the repository-baseline table (§4) whenever architecture or repo facts change.
- Do not silently change estimates; record old value, new value, and reason.
- Keep the "exact next task" obvious in the status banner at all times.
- Never mark a task COMPLETE without recorded evidence.
- Never let the plan become aspirational fiction — status must reflect repo/build reality.

---

## 15. FUTURE CURSOR PROMPT TEMPLATE

```
[MISSION]
<paste Permanent Mission Statement from §1>

[MASTER PLAN]
Read docs/mobile-app-master-plan.md and docs/mobile-app-session-handoff.md before doing anything.

[MANDATORY REPO IDENTITY CHECK]
Run git rev-parse --show-toplevel; git remote -v; git branch --show-current; git status --short. Confirm you are in the correct repository for this task (WEBSITE = Summitt-mindset.git, or MOBILE = summitt-mindset-mobile). If it is the wrong repo, STOP without editing. Do not edit both repos unless this prompt explicitly authorizes it.

[TARGET REPO]
<WEBSITE (Summitt-mindset.git) | MOBILE (summitt-mindset-mobile) | disposable POC project>

[ARCHITECTURE NOTE]
Production shell architecture is UNRESOLVED pending the Phase 4 POC (DEC-020). Capacitor is the leading candidate; `server.url` is NOT approved production truth. Do not hard-code a production `server.url` dependency before Phase 4.

[CURRENT PHASE]
Phase <N> — <name>

[TASK IDS ASSIGNED]
Complete ONLY: <APP-0xx>[, APP-0yy]. Do not advance into any later phase or unlisted task.

[ALLOWED FILES/SYSTEMS]
<explicit list — e.g., the summitt-mindset-mobile shell only; or a single app-gated website helper>

[EXPLICIT NON-SCOPE]
- Do NOT touch: SMS system (src/lib/*sms*, v2-*, v3-*, src/app/api/cron/*, src/app/api/twilio/*, vercel.json), supabaseServer, server secrets.
- Do NOT redesign any product surface.
- Do NOT add features from the parking lot.

[REQUIRED PRELIMINARY INSPECTION]
State the current state of the assigned task IDs and confirm dependencies are COMPLETE.

[IMPLEMENTATION REQUIREMENTS]
<what "done" looks like for these task IDs>

[TEST REQUIREMENTS]
<exact tests / device checks to run and record>

[PRODUCTION-SAFETY REQUIREMENTS]
Confirm no change endangers the live website. If a site-side change is unavoidable, gate it behind the app signal and flag it explicitly.

[DOCUMENTATION-UPDATE REQUIREMENTS]
Update task statuses, actual hours, evidence, and append a §13 handoff entry.

[GIT RESTRICTIONS]
Do not stage, commit, push, branch, or migrate unless I explicitly say so in this prompt.

[REQUIRED FINAL RESPONSE STRUCTURE]
1) Repo identity confirmed 2) What you changed (files) 3) Test results 4) Task status updates 5) Production-safety verdict 6) `git add .` safety verdict PER REPO touched (safe/unsafe + why) 7) Exact next task ID + action.
```

---

## 16. FUTURE CHATGPT HANDOFF TEMPLATE

```
SUMMITT MINDSET APP — HANDOFF
Mission: Polished iOS+Android native shell that renders the live https://summittmindset.com member experience; tap icon → stay signed in (Clerk) → land in Victory Room (/dashboard/victory-room). Website stays the product; web changes auto-appear; do not touch SMS; no native redesign; no React Native.
Architecture: UNRESOLVED pending Phase 4 POC (DEC-020). Capacitor is the leading candidate; a minimal native WKWebView/Android WebView shell is also a candidate. server.url is NOT approved production truth (it is Capacitor dev/live-reload). Next.js 16 App Router; Clerk auth; entitlement in Clerk publicMetadata; Stripe web checkout (NOT shown in-app in V1); Supabase server-only; Vimeo iframe.
Repos: WEBSITE = Summitt-mindset.git (this doc lives here). MOBILE = summitt-mindset-mobile (separate; NOT YET CREATED). Confirm repo identity before editing; per-repo git verdicts; never edit both without authorization; never copy website secrets into mobile.
Current phase: <N — name>
Completed task IDs: <list>
Current task: <APP-0xx — one line>
Blockers: <list or none>
Repo state (per repo): WEBSITE branch <x>, commit <hash>, git status <clean/dirty>, add-all safe? <yes/no>; MOBILE <exists?/status>.
Last test results: <key PASS/FAIL>
Store status: Apple <status>, Google <status>, TestFlight <status>
Exact next step: <one sentence>
Master plan file: docs/mobile-app-master-plan.md (+ session-handoff.md)
Warnings: do not modify SMS/crons/twilio/supabaseServer/secrets; web deploys affect the app live; do not treat server.url as settled production.
Deferred: push, native IAP, deep links, offline, redesigns (see parking lot). Required-for-V1 now includes in-app account deletion + no in-app selling + (candidate) email-only login.
```

---

## 17. GO/NO-GO CHECKPOINTS

**Checkpoint A — After iPhone POC (Phase 2).**
- *Evidence:* iOS POC results table (APP-017).
- *Pass:* website loads; email login works; **session persists after force-close**; reaches VR; API call works; Vimeo plays; entitlement recognized.
- *Fail:* session doesn't persist OR login unusable.
- *Decides:* Tyler.
- *If fail:* try Clerk WebView config/guidance; if still failing, reconsider architecture (native auth adaptation or PWA fallback).
- *Revise hours?* Yes if auth needs custom work.

**Checkpoint B — After Android POC (Phase 3).**
- *Evidence:* APP-020 table. *Pass/Fail/Decides:* as A for Android. *If fail:* Android-specific cookie config; consider iOS-first launch. *Revise hours?* Possibly.

**Checkpoint C — Before production app-shell (Phase 5).**
- *Evidence:* A+B passed; **Phase 4 production-shell architecture selected (DEC-020 resolved)**; DEC-004 confirmed; `summitt-mindset-mobile` repo created (APP-059). *Pass:* both platforms viable; architecture chosen with rationale; estimate confirmed/revised. *Fail:* unresolved auth or undecided architecture. *Decides:* Tyler. *If fail:* stay in POC or pivot. *Revise hours?* Yes if scope changed.

**Checkpoint D — Before Apple submission (Phase 15).**
- *Evidence:* TestFlight primary-flow pass; compliance checklist green — **in-app account deletion (APP-041) present and working**, **no in-app selling** (neutral inactive-membership state), App Privacy accurate, external-purchase/reader posture re-verified for the target storefront.
- *Pass:* flow works on TestFlight; policy posture defensible; deletion + no-in-app-selling confirmed. *Fail:* unresolved 3.1.1/4.2/deletion, or missing in-app deletion. *Decides:* Tyler. *If fail:* add native feature (e.g., push) or adjust posture before submitting. *Revise hours?* Yes if adding push/IAP.

**Checkpoint E — Before Google submission (Phase 16).**
- *Evidence:* closed-track pass (**including the 12-tester/14-day requirement if APP-060 shows it applies**); Data Safety accurate; **in-app account deletion present + external web deletion resource available**; no outside-billing selling in V1. *Pass:* flow works; billing + deletion + data-safety posture compliant. *Fail:* billing/data-safety/deletion issues, or unmet testing requirement. *Decides:* Tyler. *If fail:* fix before submit. *Revise hours?* Possibly.

---

## 18. APP-LAUNCH DEFINITION OF DONE

- Available through the App Store and Google Play (or the intended stores).
- Opens from the app icon on both platforms.
- Routes correctly and reliably to Victory Room on cold launch (authed+subscribed).
- Clerk authentication works (email + any enabled method) inside the app.
- Session persistence meets the agreed standard (no repeated logins within a normal session lifetime; verified across force-close/reopen).
- Entitlement works (subscribed users get access; unsubscribed follow existing behavior without policy violation).
- **SMS remains completely unaffected** (no changes to Twilio/cron/`lib` SMS code; verified untouched).
- Victory Room works in-app (all sections render, scroll, links).
- Ask Pat works in-app (submit → answer).
- Film Room works in-app (list + Vimeo playback).
- Account view + required account-deletion path work per store policy.
- Error behavior acceptable (offline/network-error screen, no white-screen).
- Analytics + crash reporting active and reporting.
- Store privacy/data-safety information is accurate to actual data flows.
- Website deployments update the displayed app experience automatically (verified with a test web change).
- Master documentation current (tracker statuses, actual hours, decision log, handoff).
- Post-launch monitoring defined (crash/analytics watch + web-deploy smoke check).

---

## 19. FINAL VERDICT

### RECOMMENDED ARCHITECTURE
**A polished iOS + Android native shell that renders the live `https://summittmindset.com` member experience**, opening to `/dashboard/victory-room`, built in a **separate repository** (`summitt-mindset-mobile`). **Capacitor is the leading candidate** (clean native-plugin path for status bar, splash, deep links, push; satisfies the "web changes appear automatically" mandate) — but the **final production shell architecture is UNRESOLVED pending the Phase 4 proof of concept (DEC-020)**, which compares (a) Capacitor with a purpose-built production WebView, (b) a minimal direct native iOS `WKWebView` + Android WebView shell, and (c) any superior evidence-backed production-safe hybrid, judged on Clerk session persistence, automatic live updates, native nav/link handling, App Store posture, and maintenance burden. **`server.url` is NOT approved as the production implementation** — it is Capacitor's dev/live-reload configuration; ordinary production Capacitor apps ship compiled assets via `webDir`. React Native is explicitly rejected (it would discard the entire server-rendered UI), and website screens must not be duplicated. Confirm Apple's tolerance for a shell that renders a website (RISK-04) early; mitigate by keeping it members-only and adding a native feature if review demands it.

### VERIFIED CURRENT BASELINE
Next.js **16.0.5** App Router; **84 pages, 78 API routes, ~8 client pages** (overwhelmingly RSC); Clerk `@clerk/nextjs` ^6.35.5 (`layout.tsx`, `middleware.ts`); Victory Room at `/dashboard/victory-room` (`force-dynamic`, `currentUser()` gate → `/sign-in`); canonical post-login router `post-sign-in/page.tsx` → `MEMBER_APP_HOME_PATH` = `/dashboard/victory-room`; entitlement in Clerk `publicMetadata`; Stripe **web checkout** via full-page redirect; Supabase **service-role server-only** (`supabase-server.ts`); Vimeo **iframe**; SMS = Twilio + crons + huge `lib/` brain; `data-deletion` is **email-only**; domain `https://summittmindset.com`; **no PWA, no Capacitor/RN, no app icons**. (Re-verified 2026-07-17 — see "Baseline verification — 2026-07-17".)

### MOST-LIKELY TOTAL HOURS
**Working target ≈ 115 focused hours; current responsible range ≈ 115–150 focused hours** (best ~70, conservative ~258). "The 115-hour app" is preserved as project shorthand for the full polished middle-path version. Range widened 2026-07-17 because in-app account deletion is now Required (not conditional), push may be needed for 4.2, the production shell architecture is unresolved pending POC, and Google's 12-tester/14-day rule may apply (see §6 Estimate revision). Engineering ~65–70h; Tyler setup/testing/store ~45–50h. **Excludes** store-review waiting, push, and native IAP; native IAP / native auth / any Apple-required major native feature are **separately-approved scope expansions**. Estimate must be revised again after the architecture + Clerk-session POC.

### HOURS BY PHASE
P0 ~3 · P1 ~3 · P2 ~6 · P3 ~4 · P4 ~1 · P5 ~10 · P6 ~10 · P7 ~3 · P8 ~6 · P9 ~6 · P10 ~10 · P11 ~9 · P12 ~5 · P13 ~5 · P14 ~5 · P15 ~5 · P16 ~4 · P17 ~7 · P18 ~3 (+~2 ongoing docs). ≈ **115h**.

### CRITICAL PATH
Master plan → policy verify → **iPhone POC (Clerk session persistence)** → go/no-go → shell → auth/session hardening → direct-to-VR routing → purchase-compliance → TestFlight/closed-track → submissions → review responses → launch.

### FIRST GO/NO-GO TEST
**Does the Clerk session persist in an iOS WKWebView after force-close/reopen and land the user in Victory Room without re-login?** (Checkpoint A / APP-011.) Everything depends on this; test it before any production build.

### BIGGEST TECHNICAL RISK
**Clerk session persistence + OAuth inside the WebView** (RISK-01/RISK-02). If it fails, the "stay signed in" value evaporates and hours could roughly double.

### BIGGEST STORE-REVIEW RISK
**Apple** — the combination of **4.2 minimum-functionality** (a shell that renders a website) and **3.1.1** (in-app path leading to Stripe web checkout). Both **REQUIRE CURRENT APPLE-DOC VERIFICATION** and may force adding push and/or reworking purchase messaging.

### FIRST TEN TASK IDS
APP-000, APP-001, APP-002, APP-003, APP-004, APP-005, APP-006, APP-007, APP-008, APP-009.

### RECOMMENDED MASTER-PLAN FILE STRUCTURE
Two files: `docs/mobile-app-master-plan.md` (spine + task tracker + decision log + risk register + parking lot) and `docs/mobile-app-session-handoff.md` (append-only session log). Split decision log / risk register into their own files only if they outgrow a screen.

### EXACT NEXT CURSOR PROMPT
The next controlled task is **APP-007** (Phase 1 — check the Clerk dashboard for which login methods are enabled: email vs social). APP-003–APP-006 are COMPLETE (see "Policy verification — 2026-07-17"). APP-007 requires Tyler + the Clerk dashboard; it decides the Sign in with Apple (4.8) and OAuth posture and feeds candidate decision DEC-018/APP-061. It does not begin any shell implementation and does not create the `summitt-mindset-mobile` repo.

---

*End of master plan v1.1. Maintained per §14. Do not let it become aspirational fiction — update statuses and evidence every session.*
