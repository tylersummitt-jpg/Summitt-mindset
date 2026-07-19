# SUMMITT MINDSET — MOBILE APP MASTER PLAN
*Project-control document. Version 1.5.11. Created 2026-07-17. Read-only-audit basis. v1.1 (2026-07-17): recorded APP-003–APP-006 policy findings, the separate-mobile-repository decision, and the production-architecture correction (`server.url` is NOT approved production truth). v1.2 (2026-07-17): completed APP-007 + APP-061 with confirmed Clerk dashboard truth; DEC-018 set ACTIVE (app-only first-party email auth on the same Clerk instance); recorded the long-session launch standard (7-day lifetime rejected; 180-day min / ~1yr preferred) and the Google-origin-user POC acceptance criteria. v1.3 (2026-07-17): recorded the mobile-repository bootstrap plan + iPhone POC plan ("iPhone POC + mobile bootstrap plan — 2026-07-17"); added APP-067–APP-070; set exact next task to APP-059 (Tyler creates empty private repo) → APP-067. v1.4 (2026-07-17): recorded APP-008 Stage 1 physical-device live-shell POC PASS + APP-070 architecture observations; Candidate A2 is the evidence-backed leading architecture; APP-021 remains open (Android Checkpoint B + formal Phase-4 selection + estimate revise still unmet); Clerk long-session remains a production blocker. v1.4.1 (2026-07-17): strict-completion correction — APP-010 and APP-016 restored to NOT STARTED (Stage 1 observations preserved; full original acceptance stacks not formally proven); APP-008 clarified as intentional evolution into `summitt-mindset-mobile`. v1.5 (2026-07-18): recorded APP-062–APP-064 COMPLETE — production Clerk upgraded Hobby→Pro ($20/mo annual); max lifetime set to **180 days** (inactivity off); no website/mobile code change. APP-065 IN PROGRESS (elapsed-time validation still open; short-cycle post-change force-close/reopen PASS only). v1.5.1 (2026-07-18): APP-010, APP-016, APP-069 COMPLETE after Tyler privately verified the Google-origin baseline comparison PASS (no private identifiers committed); Checkpoint A identity/entitlement gates closed; APP-065 remains IN PROGRESS. v1.5.2 (2026-07-18): APP-041 account-deletion audit recorded; APP-041A COMPLETE (live Supabase schema + Clerk Dashboard verification, read-only); APP-041 parent IN PROGRESS with phases APP-041B–F NOT STARTED; DEC-023 APPROVED-FOR-IMPLEMENTATION (not implemented); obsolete 3h APP-041 estimate replaced by ~24–40h planning range. v1.5.3 (2026-07-18): APP-041B1 COMPLETE in repository (not deployed) — `account_deletion_requests` migration + typed repository/tests; no endpoint/UI/SMS/Stripe/Clerk/purge; APP-041B parent IN PROGRESS. v1.5.4 (2026-07-18): **APP-041B2a** local SMS unlink + anti-resurrection foundation **in worktree only** (migration not applied; not committed/deployed); no public deletion capability; unlink ≠ STOP; coach-job final-send guard; APP-041 and APP-041B remain IN PROGRESS. v1.5.5 (2026-07-18): APP-041B1 + APP-041B2a **committed/pushed and applied to production Supabase**; structural + permission + transactional ROLLBACK validation PASS (fake clerk id only; no real user data touched); APP-041 / APP-041B remain IN PROGRESS; no public deletion capability. v1.5.7 (2026-07-18): **APP-041B3b** Stripe anti-resurrection **IMPLEMENTED — PENDING REVIEW** in worktree only (no migration); B3a treated COMPLETE applied/validated; APP-041 remains IN PROGRESS. v1.5.8 (2026-07-18): **APP-041B3b COMPLETE** — independently reviewed, corrected, committed, pushed, merged at `aab8b02d804c162797e7cdb853acfe49ef4ecd89`; no migration; no public deletion capability; exact next is a read-only remaining-slices audit. v1.5.9 (2026-07-19): **APP-041B2b COMPLETE** — outbound SMS final-send deletion guards committed/pushed at `61f615a0837535a06e2b392c8126226f94163616`; no migration; path-specific lookup recovery; no public deletion. v1.5.10 (2026-07-19): **APP-041C1 COMPLETE** — purge/anonymization policy freeze committed at `8e5d73bba72291cbbc2ba71fc98b0ccccbc7a5b2`. v1.5.11 (2026-07-19): **APP-041C2** initially recorded as IMPLEMENTED — PENDING REVIEW in worktree (migrations not yet applied at that changelog moment). **Superseded:** APP-041C2 is now **COMPLETE** — migrations applied and production-validated (fake transactional target/survivor + zero-residue); commit `176da7011ade7698a9b738485f629bde239b838a`. **APP-041C3** IMPLEMENTED — PENDING REVIEW (server-only orchestrator; compact durable post-purge marker; no public deletion).*

---

## STATUS BANNER

| Field | Value |
|---|---|
| Plan version | 1.5.11 |
| Last verified date | 2026-07-19 |
| Current phase | **APP-041** IN PROGRESS (APP-041A COMPLETE; **B1**+**B2a**+**B2b**+**B3a**+**B3b** COMPLETE; **APP-041C1** COMPLETE; **APP-041C2** COMPLETE/applied+validated; **APP-041C3** COMPLETE; **APP-041D0** COMPLETE at `0c3fe21…`; **APP-041D1** COMPLETE at `8dcf2e3…`; **APP-041E1** COMPLETE at `3c4e6f0…`; **APP-041E2** COMPLETE at `f024a7e…`; **APP-041E3a** IMPLEMENTED — PENDING REVIEW — unreachable production-safe stage wiring — **no public deletion capability**); **APP-065** IN PROGRESS; APP-021 still open |
| Current assigned task IDs | APP-041E3a review, APP-065 (IN PROGRESS), APP-041 (IN PROGRESS), APP-015, APP-066, APP-018–APP-021 |
| Last completed task IDs | APP-041E2, APP-041E1, APP-041D1, APP-041D0, APP-041C3, APP-041C2, APP-041C1, APP-041B2b, APP-041B3b, APP-041B3a, APP-041B2a, APP-041B1, APP-041A, APP-010, APP-016, APP-069, APP-062, APP-063, APP-064 (also: APP-008 Stage 1 PASS, APP-009, APP-011–APP-014, APP-017, APP-059, APP-070) |
| Current blocker | **APP-065** elapsed-time proof still open. **APP-041** Required for V1 — parent IN PROGRESS; **no user account can currently initiate deletion**. APP-015 open. Android unstarted. APP-021 open. |
| Production shell architecture | **Candidate A2 is the selected leading architecture based on current physical-device evidence** (custom Swift `LiveShellViewController` + one native `WKWebView` inside the Capacitor-generated iOS project; live site loaded by the native controller; **no `server.url`**). Candidate B (bare native WKWebView) remains fallback only. **APP-021 not yet COMPLETE** — Android Checkpoint B OR explicit iOS-first amendment, estimate confirm/revise, and formal DEC-020 close still required. Production use of Capacitor `server.url` remains **prohibited**. |
| V1 login posture | **DECIDED (DEC-018 ACTIVE):** app-only first-party **email verification-code** auth on the **same** Clerk instance. Website keeps Google unchanged. **APP-010 COMPLETE:** intended email-code posture on physical iPhone; same existing Clerk identity confirmed; no duplicate Clerk user; relationship/member state intact (Tyler privately verified APP-069 baseline comparison PASS — no private identifiers committed). Google OAuth remains outside intended V1 app-only email posture. |
| Session-lifetime standard | **Production Clerk Dashboard configured:** maximum lifetime **ENABLED at 180 days**; inactivity timeout **DISABLED** (DEC-022; APP-062–064 COMPLETE). **Not permanent / not indefinite.** Website application code never enforced a 7-day limit. Short-cycle force-close/reopen after the change **PASS**. **Multi-month / full 180-day elapsed persistence is NOT proven** — that is **APP-065 (IN PROGRESS)**. Client Trust formal requirements remain with APP-066. |
| Mobile repository | Separate repo `summitt-mindset-mobile` — **exists**; Stage 1 physical-device POC was run from it (intentional evolution from the original throwaway-outside-repo assumption — see APP-008 notes). This document lives in the website/SMS repo. Do not edit the mobile repo from website-doc tasks. |
| Exact next task | **Review APP-041E3a** (unreachable production-safe stage wiring). Then discovery RPC/helper → admin read-only observability → disabled cron route only after those are reviewed. Do **not** claim deletion is live. Do **not** jump to public UI. Parallel: **APP-065**, **APP-015**, **APP-066**, **APP-021**. |

> **How to use this document:** This is the single durable control document for the mobile-app project. It is designed so a brand-new ChatGPT conversation or a fresh Cursor session can resume with zero prior context. Read this file plus `docs/mobile-app-session-handoff.md` before doing anything. Never mark a task COMPLETE without recorded evidence. Move every scope addition to the parking lot (§12). Do not touch the SMS system. The production mobile shell lives in a **separate repository** (`summitt-mindset-mobile`); every task must confirm repository identity before editing (see DEC-013–DEC-017).

---

## 1. NORTH STAR

- **SMS is the primary product value.** The app must not modify, proxy, intercept, or endanger the Twilio SMS system (`src/app/api/cron/*`, `src/app/api/twilio/*`, `src/app/api/sms/*`, and the ~600-file SMS brain under `src/lib/`).
- **Victory Room is the secondary product value** and is the app's landing destination (`/dashboard/victory-room`).
- **The app exists to remove friction in reaching Victory Room** — tap icon, stay signed in, land in Victory Room. Nothing more in V1.
- **The member signs in once and stays signed in for months.** A forced sign-in every week or every month is unacceptable. Production Clerk **Dashboard** maximum lifetime is now **180 days** (DEC-022; inactivity off). That ceiling lived in Clerk configuration (formerly 7 days on Hobby), **not** in website application code. **Elapsed 180-day persistence is not yet proven** (APP-065).
- **App login is first-party email only.** V1 authenticates via Clerk **email verification code** on the **same** Clerk instance (no Google/social shown in the app); the **website keeps Google unchanged**. Never a second Clerk instance, never a separate user pool, never globally remove Google (DEC-018).
- **The website remains the product.** The live Next.js app at `https://summittmindset.com` is the single source of product truth.
- **The app is a doorway into the website**, not a second product.
- **One shared web experience must be preserved.** No duplicated screens in native code.
- **Website changes must automatically appear in the app.** The shell must render the live Summitt Mindset member experience so future website changes appear automatically without a new store submission. **Candidate A2 is the selected leading architecture based on current physical-device evidence** (custom Swift live `WKWebView` inside the Capacitor-generated iOS project). **APP-021 has not formally closed the production decision.** Capacitor `server.url` remains **prohibited** for production.
- **The goal is not a native redesign.** No Victory Room / Ask Pat / Film Room redesign as part of this project.
- **The production mobile shell lives in a separate repository** (`summitt-mindset-mobile`); this website/SMS repo remains the current-business source of truth.

### PERMANENT MISSION STATEMENT (paste at the top of every future Cursor prompt)

> **Summitt Mindset Mobile App Mission:** We are building a polished iPhone + Android app that is a high-quality native shell around the live Summitt Mindset member experience (`https://summittmindset.com`) — NOT a separate native rewrite. The shell must render the live site so web changes appear automatically without a new store submission. **Candidate A2 is the selected leading architecture based on current physical-device evidence** (custom Swift `LiveShellViewController` + one native `WKWebView` inside the Capacitor-generated iOS project; live load by the native controller; no CapBridge as the visible root). Candidate B (bare native WKWebView/Android WebView) remains the fallback only if a later blocker appears. **APP-021 formal Phase-4 close is still open.** Capacitor `server.url` is NOT approved as the final production implementation. The app must let a member tap the icon, stay signed in via Clerk, and land directly in Victory Room (`/dashboard/victory-room`). The production shell lives in a **separate repo** (`summitt-mindset-mobile`); this is the website/SMS repo. We are NOT building native screens, NOT duplicating website screens, NOT pivoting to React Native, NOT redesigning any product surface, NOT touching the SMS system, and NOT adding features just because mobile apps usually have them. Every task must be justified by: "Is this required to let a member download the app, tap the icon, remain signed in, and enter the existing Victory Room safely and reliably?"

---

## 2. NON-NEGOTIABLE ARCHITECTURE PRINCIPLES

1. **One product codebase + a separate shell repository.** The Next.js website is the product and must preserve the one-codebase strategy. The mobile shell is a thin native wrapper that **must live in its own dedicated repository** (`summitt-mindset-mobile`) — never inside this website/SMS repo. No website secrets or server code may be copied into the mobile repo.
2. **Reuse the website directly** by rendering the live site so deploys to Vercel appear in the app automatically. **Candidate A2 is the selected leading architecture based on current physical-device evidence** (see APP-070 / DEC-020). Capacitor `server.url` (a dev/live-reload setting) is **NOT** approved production truth. Candidate B (bare native `WKWebView`/Android WebView) remains fallback only. **APP-021 formal close still open.**
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
15. **Candidate A2 is the selected leading architecture based on current physical-device evidence**; formal production close remains **APP-021**. No phase may hard-code a production dependency on `server.url`.

---

## 3. V1 DEFINITION

### Required for V1
- iOS + Android **native shell (Capacitor leading candidate; final architecture pending POC — DEC-020)** that **renders the live Summitt Mindset member experience** so web changes appear automatically. Lives in the separate `summitt-mindset-mobile` repo.
- Launches to **Victory Room** (`/dashboard/victory-room`); unauthenticated users hit the existing `/sign-in` → `/post-sign-in` flow and end at Victory Room.
- **Clerk session persists** across force-close/reopen (no repeated logins) to the agreed standard (see Checkpoint A pass criteria).
- **Long-session launch requirement (non-negotiable):** *The mobile app does not ship with a seven-day session lifetime.* Production Clerk is configured for a **180-day maximum lifetime** with inactivity timeout **off** (DEC-022; APP-062–064). **Do not promise users they stay signed in forever** — sessions remain bounded; expired/revoked sessions require secure Clerk reauthentication. **APP-065** must prove honest elapsed-time behavior; short-cycle force-close/reopen alone is insufficient. (DEC-021 product standard; DEC-022 configuration decision.)
- **Entitlement recognized** unchanged (Clerk `publicMetadata.summittSubscribed`/`summittPlan`).
- Core reused surfaces load and function: **Victory Room (primary), Ask Pat, Film Room/Vimeo, Account** (`/user`).
- **No in-app selling in V1.** V1 does **not** show the Stripe checkout inside the app. Existing web subscribers access their membership normally; unsubscribed users receive a **neutral inactive-membership state** (no purchase UI). *(APP-004 finding; do not rely on reader-app classification; external-purchase language is storefront-dependent and must be re-verified before submission.)*
- **App-only first-party email authentication (DECIDED — DEC-018 ACTIVE).** The app shows Clerk **email verification code** (password optional) on the **same** Clerk production instance and **does not** show Google/social. The **website keeps Google unchanged**. Because the app offers no social login, **Sign in with Apple is not required in V1** (Apple 4.8 not triggered). Existing Google-origin users sign in with the **same verified email + a one-time code**, resolving to the **same existing Clerk identity** (**APP-010 / APP-069 COMPLETE** — Tyler privately verified; no private identifiers committed). Never create a second Clerk instance, never a separate user pool, never globally disable Google.
- **In-app account deletion action** (moved into Required for V1 per APP-005). Apple 5.1.1(v) requires an in-app deletion path when the app supports account creation, and Google requires both an in-app path and an external web resource. The current `data-deletion` page is **email-request only and is insufficient** as the complete app deletion flow. **APP-041 parent is IN PROGRESS** (APP-041A COMPLETE 2026-07-18); **DEC-023 APPROVED-FOR-IMPLEMENTATION** (not implemented). Do **not** build deletion code until APP-041B planning closes. **SMS principle:** do not broadly refactor or endanger the SMS system; a complete deletion workflow must narrowly and deliberately handle SMS audience, identity, pending-job, consent, STOP, and resurrection behavior; required STOP/opt-out evidence must not be blindly destroyed; no implementation phase may proceed without narrow tests proving other users’ SMS behavior remains unchanged.
- App icon + splash screen + correct app name.
- Safe-area/status-bar handling; Android hardware back button behaves sanely.
- Basic loading + network-error state so a failed load isn't a white screen.
- Crash reporting + minimal analytics (launch, login success, reached-Victory-Room).
- Store listings (privacy nutrition labels / Play data-safety) that are **accurate** to the SMS/AI/journal data flows.

### Required only if Apple or Google demands it
- **Sign in with Apple** — **NOT required in V1** because the app offers no Google/social login (DEC-018 ACTIVE; APP-007 confirmed Google is enabled on the shared instance but the app hides it). Becomes required only if the app later chooses to show Google/social (revisit trigger on DEC-018). *Re-verify current Apple 4.8 policy if that ever changes.*
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
3. **Capacitor remains a candidate** for the generated iOS/Android project host; **Candidate A2** (custom Swift live `WKWebView` inside that project) is the evidence-backed **leading** architecture after Stage 1.
4. **`server.url` is NOT approved** as the final production implementation — production use remains **prohibited**.
5. **APP-021 formal close remains open.** Stage 1 evidence selects Candidate A2 as leading; Candidate B (bare native WKWebView/Android WebView) remains fallback only if a later blocker appears.
6. Do **not** pivot to React Native or duplicate website screens.
7. Remaining APP-021 gates: Android Checkpoint B (or explicit iOS-first amendment), estimate confirm/revise, and formal DEC-020 close.
8. Any architecture decision must preserve the one-codebase product strategy.

See DEC-020 (decision log) and RISK-19 (risk register). Stage 1 evidence is recorded in "APP-008 Stage 1 + APP-070 architecture evidence — 2026-07-17".

---

## APP-007 login posture — 2026-07-17

*Completed under APP-007 (login-method verification) and APP-061 (posture decision). Evidence: confirmed production Clerk dashboard screenshots supplied by Tyler 2026-07-17 + repository audit. APP-007 actual hours = `NOT RECORDED`.*

### Confirmed production Clerk truth (2026-07-17)
- **Email:** sign-up + sign-in ENABLED; **email verification code** ENABLED for both; email verification **link** DISABLED.
- **Password:** sign-up ENABLED; add-password ENABLED.
- **Social/SSO:** **Google ENABLED and used for sign-in**; **Sign in with Apple NOT enabled**; no other social; no enterprise SSO.
- **Phone / Username / Passkeys:** all DISABLED.
- **Client Trust:** ENABLED — new-device sign-ins require extra verification.
- **Sessions (as of APP-007, 2026-07-17):** maximum lifetime was ENABLED at **7 days** on Hobby (control labeled **Pro**); inactivity timeout DISABLED; multi-session DISABLED; no custom JWT templates.
- **Sessions (updated 2026-07-18 — DEC-022 / APP-062–064):** production workspace upgraded Hobby → **Pro** ($20/month billed annually; no optional add-ons). Maximum lifetime **ENABLED at 180 days**; inactivity timeout **DISABLED**. **No website or mobile-shell code change.** Short-cycle post-change iPhone force-close/reopen → Victory Room **PASS**. **180-day elapsed persistence not proven** (APP-065).
- **Account deletion (updated 2026-07-18 — APP-041A):** "Allow users to delete their account" is **ENABLED**. Clerk states that changing this setting affects **new users only**. Existing users can be overridden individually in their user profile; an **"Apply to existing users"** action is available. Tyler **did not** click "Apply to existing users" and **did not** change any Clerk setting. Clerk’s built-in self-delete is **not approved** as the complete Summitt Mindset deletion workflow (not coordinated with Stripe, Supabase, or SMS). See "APP-041 account deletion — 2026-07-18" and DEC-023.

### Repository behavior (verified)
- Sign-in `src/app/sign-in/[[...sign-in]]/page.tsx` and sign-up `src/app/sign-up/[[...sign-up]]/page.tsx` render Clerk `<SignIn/>`/`<SignUp/>` with **no provider list, no `appearance`/`elements`, no `oauthFlow`** → **provider visibility is 100% dashboard-controlled on a single shared Clerk instance.** The **same `<SignIn/>` screen would show Google in both the website and a future WebView app.**
- The backend keys identity on **`clerk_user_id`** (`src/lib/clerk-rest.ts`; Supabase `user_profiles`, SMS memory, Stripe metadata, journal), and entitlement lives in Clerk `publicMetadata`. **A duplicate Clerk user would orphan a member from their data/entitlement** (RISK-22).

### V1 login decision (DEC-018 ACTIVE)
App V1 uses **app-only first-party email authentication on the SAME Clerk instance**: email verification code is the universal factor (password optional); Google is not shown in the app; Sign in with Apple is not required (no social in app); the website keeps Google unchanged. Existing Google-origin users sign in with their **same verified email + one-time code**, which resolves to their **existing Clerk identity**. **APP-010 / APP-069 COMPLETE (2026-07-18):** Tyler privately verified the baseline comparison PASS — same existing Clerk identity confirmed; no duplicate Clerk user; **no private identifiers committed.**

### Path comparison (recorded)
- **Path A — app-only email (CHOSEN):** cleanest, safest. No SIWA, no OAuth-in-WebView return, one user pool, website untouched, lowest maintenance.
- **Path B — add Sign in with Apple + keep Google in app (REJECTED for V1):** materially more complex — Apple Developer Services ID/key, Clerk provider config, OAuth + WebView callback return handling (the U3/RISK-02 hard problem), and account-linking. Only if product later requires social in-app.
- **Path C — globally remove Google (PROHIBITED):** harms existing web users who depend on Google; is a website product change; disfavored unless evidence proves no existing user depends on Google.

### APP-061 mechanism hierarchy (decision recorded; implementation deferred)
1. **Preferred:** a dedicated app sign-in route/surface using a **custom/headless Clerk `useSignIn` flow**, email verification code first, **same Clerk production instance**, no Google/social shown.
2. **Acceptable fallback:** an app-specific Clerk sign-in presentation that **genuinely removes** social from the app without globally changing the website. Do **not** rely on fragile CSS-only hiding unless no better supported approach exists.
3. **Prohibited:** separate Clerk instance; global removal of Google; duplicating users; native auth that creates a separate identity system; any app login that changes normal website behavior.

### iPhone POC acceptance criteria (to execute in Phase 2 — do NOT implement now)
Use at least one **real test account that originally used Google sign-in, is currently subscribed, and has real Victory Room/member data.** Verify:
1. App shows **email verification-code** login **without Google**.
2. User enters the **same Google-associated email**.
3. Clerk **sends and accepts** the email code.
4. Clerk resolves to the **same existing `clerk_user_id`**.
5. **No duplicate** Clerk user is created.
6. **Subscription entitlement** remains recognized.
7. **Victory Room** shows the correct existing data (Current Goal, history, SMS relationship state intact).
8. Closing and reopening the app **preserves the session**.
9. **Force-closing** and reopening **preserves the session**.
10. Client Trust verification occurs **no more than expected for a first new-device sign-in**.
11. Reopening the app **does not repeatedly** trigger a new-device challenge.
12. The app **lands directly in Victory Room**.
13. The session remains valid **across multiple days**.
14. After the Clerk lifetime is increased in a later approved task, the session remains usable **within the selected long-term window**.
15. **Expired sessions degrade to a clean login screen** — never a blank screen or redirect loop.

Equivalent critical checks (1–13, 15) are added to the Android POC (Phase 3).

---

## APP-041 account deletion — 2026-07-18

*Control record for APP-041. APP-041B1 and APP-041B2a are committed/pushed and applied to production Supabase (validated). Neither enables public account deletion. No private identifiers are stored here.*

### Status
- **APP-041 (parent):** **IN PROGRESS** — Required for V1; **not COMPLETE**.
- **APP-041A:** **COMPLETE** (live-schema + Clerk Dashboard verification).
- **APP-041B1:** **COMPLETE and applied/validated** — durable `account_deletion_requests` + lease/CAS RPCs in production. **No** public endpoint, UI, reauth, Stripe cancel, Clerk delete, purge, or cron.
- **APP-041B2a:** **COMPLETE and applied/validated** — atomic local SMS unlink RPC + orchestrator helper, anti-resurrection guards (audience sync / START / onboarding), nonterminal coach-job cancellation, live `sms_identities` removal, final inbound-coach pre-send eligibility gates (main + safety short-circuit), START blocked acknowledgment (no false “rejoined”), atomic `steps.sms_binding_removed` (no phone/PII). **No public deletion capability** — no user account can currently initiate deletion.
- **APP-041B3a:** **COMPLETE, committed, pushed; migration applied and verified** — server-only Stripe cancellation orchestration with ownership gates; CAS `stripe_result` (18-arg) applied in production. **No** public endpoint/UI.
- **APP-041B3b:** **COMPLETE, committed and pushed** at `aab8b02d804c162797e7cdb853acfe49ef4ecd89` (`feat: prevent Stripe entitlement resurrection during deletion`) — independently reviewed and corrected before merge. **No migration** created or required. **No** public endpoint/UI. **No** real Stripe/Clerk/Supabase/Twilio action during implementation/testing.
- **APP-041B2b:** **COMPLETE, committed and pushed** at `61f615a0837535a06e2b392c8126226f94163616` — final transport-level outbound SMS deletion guard in `sendSMS`; daily self-heal cannot reinsert deleting users; daily/weekly/evening/guided/onboarding/admin paths hardened; inbound coach B2a + transport defense. Intentional deletion blocks terminal; lookup failures fail-closed at transport with path-specific recovery (see known risks). **No migration.** **No** public initiation.
- **APP-041C1:** **COMPLETE** (committed/pushed at `8e5d73bba72291cbbc2ba71fc98b0ccccbc7a5b2`) — canonical purge/anonymization policy freeze in `docs/account-deletion-purge-matrix.md`.
- **APP-041C2:** **COMPLETE** at `176da7011ade7698a9b738485f629bde239b838a` — migrations applied + fake-user transactional validation + post-rollback zero-residue. STOP tombstone; delete-all testimonials; challenge DELETE by exact `clerk_user_id` only.
- **APP-041C3:** **COMPLETE** (`7f1a7e022a50f123c3dbf82b510a0ef5f2bf40ee`) — server-only purge orchestrator + compact durable marker. **No public endpoint/UI. No Clerk delete. No worker/cron.**
- **APP-041D0:** **COMPLETE** (`0c3fe21f888be68111a2f807a3aca4d91ec2eba6`) — 22-arg CAS applied; schema cache reloaded; signature/security verified; legacy 20-key smoke passed; zero synthetic residue.
- **APP-041D1:** **COMPLETE** (`8dcf2e3037f7af49e8e31a784d6fa835eb6e4147`) — Clerk deletion-last adapter + orchestrator; injected fake only; durable `clerk_delete_rpc` marker; no real Clerk call; no public initiation/UI.
- **APP-041E1:** **COMPLETE** (`3c4e6f07cf1d3246dc31fb83703ffb245abf6ea9`) — one-request / one-stage reconciler; required injected stages; no scheduler/cron/route; no batch scanner; no real Clerk call; no public initiation/UI.
- **APP-041E2:** **COMPLETE** (`f024a7e56bc278bd8efc7e06e38fdff433cdca7c`) — execution safety: stage throw/malformed normalization; frozen trusted dependency bundle; `executeTrustedAccountDeletionReconcile` boundary; no live provider factory; no scheduler/route.
- **APP-041E3 architecture verdict:** Vercel Cron + private Node route + bounded ID-only discovery + one-stage reconciler (kill switch default off; batch 1; admin observability before live enablement).
- **APP-041E3a:** **IMPLEMENTED — PENDING REVIEW** — unreachable production-safe stage wiring (trusted SMS/Stripe/purge factories; Clerk REST adapter uninvoked; production dependency factory fail-closed). **No** route/cron/discovery/admin UI. **No** automatic deletion.
- Exact next action: **review E3a** → discovery RPC/helper → admin read-only observability → disabled cron route only after those are reviewed → authenticated initiation/UI later. Canonical matrix: `docs/account-deletion-purge-matrix.md`.

### APP-041B3b protections (COMPLETE at `aab8b02…`)
- Checkout creation, checkout confirmation, and resume membership blocked during account deletion.
- Normal pause/cancel routes blocked during deletion so they do not compete with deletion orchestration.
- Entitlement-increasing Stripe webhook writes blocked during deletion; completed deletion rows also block late entitlement restoration.
- Entitlement-decreasing events may still safely lock access.
- Non-entitled `customer.subscription.updated` during deletion writes only `summittSubscribed=false` + `summittPlan=null` (active plan metadata cannot act as an entitlement side channel).
- Webhook deletion lookup failure is retryable: current event dedupe row released → HTTP 500 → Stripe may retry.
- Intentional deletion blocks: retain dedupe → HTTP 200 → no entitlement restoration.
- Second deletion checks immediately before entitlement-increasing Clerk/SMS writes.
- Ordinary users without a deletion row retain existing checkout, billing, and webhook behavior.

### Still not implemented (do not claim otherwise)
- Real Clerk user deletion wiring; scheduled/trusted worker entrypoint; admin recovery for failed/stuck deletion requests
- Public account-deletion API; user-facing Delete Account UI; reauthentication requirement
- Privacy/data-deletion copy update for STOP/Stripe/testimonial/tombstone/provider retention (required before public UI)
- Real end-to-end deletion test
- App-store deletion compliance (not complete until end-to-end deletion is proven)

### Known risks (honest)
- Stripe, Supabase, and Clerk are **not** one atomic transaction.
- Stripe checkout/resume may complete before a second deletion guard; local entitlement restoration is still blocked.
- Failed/stuck deletion rows block membership management **and outbound SMS** until an admin recovery process exists.
- Completed deletion rows intentionally block late entitlement restoration **and outbound SMS**.
- Webhook dedupe remains insert-before-handler; lookup failure uses targeted dedupe release.
- Outbound SMS: final DB check immediately before `messages.create` is not atomic with Twilio acceptance (theoretical residual race; practical risk very small after B2a + B2b).
- Outbound SMS deletion **lookup failure** is fail-closed at transport (no Twilio) and is **not** evidence of deletion. Path recovery (do not conflate):
  - **Inbound coach:** becomes job `failed` with `next_retry_at`; the worker **automatically** selects and retries.
  - **Daily SMS:** becomes `send_failed`; existing CASE A may **automatically** retry on later cron passes in the same send window/day (subject to existing attempt/window limits).
  - **Weekly SMS:** early lookup (before reservation) creates no event → another Sunday-window cron tick can retry; **post-reservation** `send_failed` is **not** auto-reclaimed (unique weekly event remains) → operator/admin event reset + resend, or next weekly period (Twilio-provider-failure parity; B2b did not invent a new failure class).
  - **Evening/admin SMS:** early lookup can be retried by admin before reservation; **post-reservation** `send_failed` needs operator/admin event reset + resend (not an automatic retry engine; Twilio-parity).
  - **Guided:** proposal rollback → guided action can be invoked again.
  - **Onboarding:** HTTP 500 → client retry; no successful-send latch is written.

### Implemented backend foundation (B1 + B2a — live in production DB)
- Durable deletion-request state (`account_deletion_requests`)
- Atomic lease (`acquire_account_deletion_lease`) and CAS (`cas_account_deletion_request`, 16-arg)
- Local SMS unlink RPC (`suppress_sms_for_account_deletion`)
- Audience removal; nonterminal inbound-coach job cancellation; live `sms_identities` removal
- Final inbound-coach pre-send eligibility gates; START/onboarding/audience anti-resurrection guards
- Unlink distinct from STOP; no phone HMAC/hash/evidence table; real STOP inbound rows untouched

### Production migration + validation evidence (2026-07-18)
- Repo HEAD lineage includes B2a at `723bc6b299230bdf320cc4e6ad04a277507c8d5b` (B1 committed/pushed earlier).
- Applied in order to production Supabase (each reported Success / No rows returned):
  1. `20260718120000_account_deletion_requests.sql`
  2. `20260718130000_account_deletion_sms_suppress.sql`
- Objects verified: `public.account_deletion_requests`; `acquire_account_deletion_lease(uuid,text,integer)`; 16-arg `cas_account_deletion_request(...)`; `suppress_sms_for_account_deletion(text,uuid)`.
- Routine checks: CAS + suppress exist; both `SECURITY INVOKER`; suppress returns text; old 14-arg CAS replaced by 16-arg.
- Privileges (all three RPCs): anon execute = false; authenticated execute = false; service_role execute = true.
- Transactional path (fake Clerk user id only; `BEGIN` … `ROLLBACK`): no pre-existing matching rows → insert temporary deletion request → acquire lease → `requested` → `suppressing_sms` (`sms_result=pending`) → real suppress RPC returned `already_absent` (no fake identity) → `sms_suppressed` (`sms_result=already_done`) → lock cleared → `ROLLBACK` → cleanup confirmed **zero** rows in `account_deletion_requests`, `sms_identities`, `sms_audience`, `sms_inbound_coach_jobs`.
- **No real user data touched.** No real account deleted; no real SMS identity removed; no real subscription canceled.
### Repository audit conclusions (read-only)
- No complete store-compliant account-deletion system exists today.
- `/data-deletion` is an email/support-request resource, not an authenticated deletion workflow; retain and eventually improve it as Google’s **external** deletion resource.
- Account UX today: `/user` (Clerk `<UserProfile />` + membership) and cancel/pause membership APIs — **no coordinated delete**.
- **Clerk-only deletion is incomplete and unsafe:** would leave application data, could leave Stripe billing active, and can orphan SMS identity/state (including phone uniqueness / START–STOP behavior).
- User identity is primarily keyed by **`clerk_user_id`** across app tables; Stripe customer/subscription IDs live in Clerk `publicMetadata`; SMS also uses `phone_number`.
- Deletion cannot rely on one universal parent-user row or one automatic cascade across the whole database.

### Clerk Dashboard verification (Tyler, 2026-07-18) — APP-041A evidence
- Inspected production Clerk Dashboard only.
- “Allow users to delete their account” is **ENABLED**.
- Clerk explicitly states changing this setting affects **new users only**.
- Existing users can be overridden individually; **"Apply to existing users"** is available.
- Tyler **did not** click “Apply to existing users.”
- Tyler **did not** change any Clerk setting.
- Built-in Clerk self-delete is **not** the approved complete product workflow.

### Live Supabase schema verification (Tyler, 2026-07-18) — APP-041A evidence
Tyler ran **three read-only** `information_schema` queries in the production Supabase SQL Editor. **No production rows were viewed.** No inserts, updates, deletes, schema changes, functions, or migrations were executed.

| Query | Structural finding (no row content recorded) |
|---|---|
| 1 — user-linked columns | User-linked data is distributed across many public-schema tables. Most application records use `clerk_user_id`; some SMS records also use `phone_number`. |
| 2 — foreign keys / delete rules | Some `v2_commitment` child relationships use **ON DELETE CASCADE** (coaching memory, SMS thread memory, commitment events/intake, seasons, goal-coherence, Victory Room snapshots, and related). **RESTRICT** relationships involving `user_identity_version` require ordered cleanup. Other relationships use **SET NULL** / **NO ACTION**. Many legacy/application user-linked tables have **no** FK that would auto-clean from one parent deletion → orchestrator needs an explicit table-by-table plan. |
| 3 — PKs / uniques | Several one-row-per-user tables are keyed by or unique on `clerk_user_id` (profile, SMS-state, retention, summary, preference, shipping, and related). **`sms_identities`** has strict phone/user uniqueness (phone is a unique identifying key; Clerk binding is unique). Many other tables are multi-row per user and need scoped `clerk_user_id` cleanup. SMS phone binding requires deliberate release/tombstone plus STOP/consent retention — not blind delete. |

**Evidence classes (keep distinct):**
- **Repository-proven usage** — tables/code paths found in the website repo audit.
- **Live-schema structural verification** — column/FK/unique behavior confirmed via `information_schema` (APP-041A).
- **Unresolved final purge semantics** — **RESOLVED for V1 product policy in APP-041C1** (`docs/account-deletion-purge-matrix.md`). Execution (C2 RPC) and privacy-copy update remain outstanding.
- **Legal/retention decisions** — still open (parallelizable; not blockers to APP-041A).

### DEC-023 — Recommended V1 deletion architecture (**APPROVED-FOR-IMPLEMENTATION**, not IMPLEMENTED)
One **website-owned** deletion flow usable in normal browsers and inside the iPhone WKWebView (no native-only delete UI required for V1):
1. Authenticate; deliberate confirmation; recent reauthentication.
2. Target **only** the authenticated user’s own account (never a client-supplied user id as authority).
3. Durably mark deletion pending / record status.
4. **Suppress outbound SMS first** (audience, identity, pending jobs); do not broadly refactor SMS.
5. Cancel any active or paused Stripe subscription **before** identity deletion.
6. Scoped application-data purge or anonymization (explicit table matrix — APP-041B).
7. Retain required financial records and STOP/opt-out / consent evidence appropriately.
8. Delete the **Clerk** user **last**.
9. Terminate the session; show completion state.
10. Idempotent retry/reconciliation for partial failure.
11. Deletion-aware webhook/cron protections to prevent entitlement/SMS **resurrection**.

`/data-deletion` remains Google’s external resource and should be improved later (APP-041F), not removed.

### SMS principle (replaces “keep away from SMS tables”)
- Do **not** broadly refactor or endanger the SMS system.
- A complete deletion workflow **must** narrowly and deliberately handle SMS audience, identity, pending-job, consent, STOP, and resurrection behavior.
- Required STOP/opt-out evidence must **not** be blindly destroyed.
- No implementation phase may proceed without narrow tests proving **other users’** SMS behavior remains unchanged.

### Legal / retention open questions (parallelizable — not APP-041A blockers)
- SMS STOP/opt-out evidence retention period
- Stripe customer retention versus deletion
- Financial/tax-record retention
- Refunds on account deletion
- Testimonials and feedback retention
- Admin/CRM-note treatment
- Challenge-participant email treatment
- Whether a grace/undo period is desired

*Not legal advice — confirm with counsel/accountant as needed.*

### Phase breakdown and hours
| Phase | Scope | Status | Est. focused hours |
|---|---|---|---|
| APP-041A | Live schema + Clerk Dashboard verification | **COMPLETE** | 2–4 |
| APP-041B1 | Durable state migration + repository + tests (no endpoint) | **COMPLETE applied/validated** | ~3–5 of B band |
| APP-041B2a | Local SMS unlink + anti-resurrection + coach final-send gates (no public API) | **COMPLETE applied/validated** | ~4–6 of B band |
| APP-041B3a | Stripe cancellation orchestration (no public API; distinct from churn) | **COMPLETE applied/validated** | ~3–5 of B band |
| APP-041B3b | Stripe/checkout/resume anti-resurrection guards (no public API) | **COMPLETE** (`aab8b02…`; no migration) | ~2–4 of B band |
| APP-041B2b | Outbound SMS final-send deletion guards (no public API) | **COMPLETE** (`61f615a…`; no migration) | ~2–4 of B band |
| APP-041B | Durable deletion state + backend orchestrator (parent) | **IN PROGRESS** | 8–14 |
| APP-041C1 | Purge/anonymization policy + dependency freeze (docs only) | **COMPLETE** (`8e5d73b…`) | ~1–2 |
| APP-041C2 | Server-only purge RPC + CAS `purge_result` wiring (no public API) | **COMPLETE** | ~4–8 |
| APP-041C3 | Application purge orchestrator (no public initiation) | **COMPLETE** | ~2–4 |
| APP-041D0 | CAS `clerk_result` foundation (22-arg) | **COMPLETE** | ~1–2 |
| APP-041D1 | Clerk deletion-last adapter/orchestrator (injected) | **COMPLETE** (`8dcf2e3…`) | ~3–5 |
| APP-041E1 | Trusted one-request reconciler (no scheduler/route) | **COMPLETE** (`3c4e6f0…`) | ~2–4 |
| APP-041E2 | Trusted execution safety (throw/malformed + dep bundle) | **COMPLETE** (`f024a7e…`) | ~2–3 |
| APP-041E3a | Unreachable production-safe stage wiring | **IMPLEMENTED — PENDING REVIEW** | ~3–4 |
| APP-041C | Account UI + deliberate confirmation + reauthentication (**distinct** from C1–C3 purge slices) | NOT STARTED | 3–5 |
| APP-041D | Stripe/SMS race and resurrection hardening | NOT STARTED | 4–8 |
| APP-041E | Automated tests + physical-iPhone validation | NOT STARTED | 6–10 |
| APP-041F | Privacy/store documentation + final evidence | NOT STARTED | 1–2 |
| **APP-041 total** | Parent workstream | **IN PROGRESS** | **≈ 24–40** |

Remaining after APP-041A: approximately **22–36** focused hours (B1–B3b consumed part of the B band). Obsolete tracker estimate of **3 hours** is retired.

### Exact next action
**Review APP-041E3a** (unreachable production-safe stage wiring; no route/cron). Then discovery RPC/helper → admin read-only observability → disabled cron route only after those are reviewed. **Do not** claim deletion is live. **Do not** jump to public UI. **Do not** claim store compliance until end-to-end deletion is proven.
---

## Production Clerk 180-day session decision — 2026-07-18

*Recorded after APP-062–APP-064 completed outside the repository via the production Clerk Dashboard. No website application code and no mobile-shell code were changed.*

### Distinctions (keep precise)
1. **Repository code:** No seven-day Clerk session limit exists in website application code. No website implementation was required for this change.
2. **Clerk Dashboard configuration:** The prior seven-day limit was production Clerk **maximum-lifetime** configuration on the **Hobby** plan. **Clerk Pro** explicitly includes **Custom session lifetime**. Production was upgraded Hobby → Pro and reconfigured to **180 days**.
3. **Verified testing (short-cycle only):** After the settings change, Tyler force-closed and reopened the physical iPhone app → opened directly to Victory Room; existing session remained valid; internal navigation worked; no immediate regression observed.
4. **Unverified testing:** Multi-month / full **180-day elapsed** persistence is **not** proven. True expiry behavior at 180 days is **not** yet observed. Revoked-session and natural-expiry reauthentication remain part of downstream validation under **APP-065**.
5. **Security posture:** Maximum lifetime remains **enabled** (bounded). Inactivity timeout remains **disabled**. Expired or revoked sessions must still require secure Clerk reauthentication. The session is **not** permanent or indefinite.

### Decision (DEC-022)
- Production Clerk uses a **180-day** maximum session lifetime.
- Inactivity timeout remains **disabled**.
- Intended to reduce recurring login friction while retaining periodic secure reauthentication.
- The setting applies to both normal website browsers and the iOS WKWebView (same production Clerk instance).
- **APP-065** remains responsible for honest elapsed-time validation.

### Plan / pricing facts (no secrets)
- Prior plan: Hobby (enforced 7-day maximum lifetime).
- Selected: Clerk Pro, **$20/month billed annually**, no optional add-ons.
- Clerk permitted the 180-day value under Pro.

---

## iPhone POC + mobile bootstrap plan — 2026-07-17

*Recorded from the completed read-only audit titled "IPHONE PROOF OF CONCEPT AND MOBILE REPOSITORY BOOTSTRAP PLAN." This section is a durable plan only — no repository was created, no app/native/Capacitor project exists, no packages installed, no Clerk changes, no Xcode opened. Tasks APP-067–APP-070 are NOT STARTED.*

### A. Mobile-repository bootstrap plan (APP-059 → APP-067 → APP-068)
1. The `summitt-mindset-mobile` repository is **private**.
2. **Tyler creates the empty GitHub repository manually** unless authenticated tooling (e.g., `gh`) is **explicitly confirmed** available and authorized. No agent creates the repo without that explicit confirmation.
3. It is **cloned outside** the website repository (never nested inside `summitt-app`).
4. **Initial files only** (guardrail-document bootstrap, APP-067):
   - `README.md`
   - `.gitignore`
   - `docs/mobile-repo-guardrails.md`
   - `docs/mobile-session-handoff.md`
   - `docs/architecture-decision.md` (decision **placeholder** — final shell chosen by APP-021)
5. **No `app`, `ios`, `android`, Capacitor, Xcode, or Gradle project during bootstrap.**
6. The mobile repo **points to this master plan** in the website/SMS repo but **does not duplicate it**.
7. **Every handoff records both repositories' relevant HEAD hashes** (website + mobile).
8. **Every task confirms repository identity before editing** (`git rev-parse --show-toplevel`, `git remote -v`, branch, HEAD, `git status --short`).
9. **Each repository receives an independent `git status` and `git add .` safety verdict.**
10. **No task edits both repositories** unless explicitly authorized (DEC-016).
11. **No website secret or server/SMS code may enter the mobile repo:** no server code, no SMS code, no service-role key, no Clerk secret, no Stripe secret, no Twilio key, no OpenAI key, no `.env`/environment file.

**Proposed `.gitignore` categories (to create later under APP-067, NOT now):**
- Node/JS: `node_modules/`, build output, logs, caches.
- Environment/secrets: `.env`, `.env.*`, `*.pem`, `*.key`, `*.keystore`, `*.jks`, `*.p8`, `*.p12`, `*.mobileprovision`, `*.cer`, `GoogleService-Info.plist`, `google-services.json`.
- iOS/Xcode: `ios/Pods/`, `*.xcuserstate`, `xcuserdata/`, `DerivedData/`, `build/`.
- Android/Gradle: `android/.gradle/`, `android/build/`, `android/app/build/`, `local.properties`, `.gradle/`.
- Capacitor (if later adopted): generated native platform build artifacts.
- OS/editor: `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/` (as appropriate).
- Evidence: POC screenshots/recordings and any file containing personal data, emails, codes, or tokens.

**Prohibited signing/secrets in Git (any repo):** Apple distribution/development certificates + private keys, `.p8` App Store Connect API keys, `.mobileprovision` profiles, Android keystores + passwords, Firebase config with keys, and any Clerk/Stripe/Twilio/OpenAI/Supabase secret or `.env`.

### B. Architecture POC plan (APP-068 records matrix; APP-021 decides)
- **Capacitor is the first shell candidate** — shared iOS/Android tooling, single JS/TS project, lower maintenance.
- A **direct native WKWebView (iOS) / Android WebView shell is the fallback** if Capacitor fails a critical technical gate.
- **Capacitor `server.url` is NOT approved as settled production architecture** (it is Capacitor's dev/live-reload configuration).
- The **exact production-grade WebView mechanism must be explicitly proposed and approved before APP-008 implementation** of the production shell (APP-022+).
- **React Native and duplicated native screens remain OUT OF SCOPE.**
- **APP-021 selects the production shell only after POC evidence** (fed by APP-070).

**Comparison matrix (to record in `docs/architecture-decision.md`; final choice pending Phase 4 / APP-021):**

| Option | iOS | Android | Live web updates | Cookie/session persistence | Maintenance | POC role |
|---|---|---|---|---|---|---|
| Capacitor production WebView (mechanism TBD, NOT `server.url`) | WKWebView | Android WebView | Must be proven | Must be proven (`__client`, session) | Lower (shared) | **First candidate** |
| Native WKWebView + Android WebView shell | WKWebView | Android WebView | Must be proven | Must be proven | Higher (two native apps) | **Fallback** |
| React Native / duplicated native screens | — | — | — | — | Highest | **Out of scope** |

### C. iPhone POC checklist (20 items, with evidence)
Run against a **real dedicated subscribed test account originally created through Google** (see §D). Each item requires evidence (redacted screenshot/recording); **raw evidence must NOT be committed to Git**.
1. App shows **email verification-code** login with **Google NOT displayed**. *(screenshot of login surface)*
2. Login uses the **same Google-associated email** and Clerk **sends + accepts** the code. *(recording)*
3. Login resolves to the **same existing `clerk_user_id`**. *(compare to APP-069 baseline)*
4. **No duplicate Clerk user** is created. *(Clerk user count unchanged; one matching user)*
5. **Subscription entitlement preserved** (`publicMetadata` unchanged). *(baseline compare)*
6. **Victory Room** shows correct existing data (Current Goal, history). *(screenshot)*
7. **SMS / member relationship state unaffected** (no SMS side effects). *(confirm no messages sent; state intact)*
8. **Ask Pat works** in the app. *(recording)*
9. **Vimeo video playback works** in the app. *(recording)*
10. **Close and reopen** the app → **session preserved** (no re-login). *(recording)*
11. **Force-close and reopen** → **session preserved**. *(recording)*
12. **Client Trust challenges only once** as expected for a first new-device sign-in. *(observation log)*
13. Reopening **does not repeatedly** trigger a new-device challenge. *(observation log)*
14. App **lands directly in Victory Room** after login. *(recording)*
15. **External links behave correctly** (open appropriately, no trapping/dead-ends). *(recording)*
16. **Network failure never produces a blank white screen** (graceful state instead). *(recording with airplane mode)*
17. Session remains valid **across multiple days** (as far as a short POC allows). *(dated screenshots)*
18. **Expired session degrades to a clean login screen** — never a blank screen or redirect loop. *(observation)*
19. **Same clerk_user_id + one matching Clerk user + unchanged entitlement + unchanged member data** re-verified after login (post-login baseline compare). *(baseline compare)*
20. Overall app behaves like a **stable native shell**, not an unstable browser window. *(qualitative summary + recordings)*

*(Items 1–13, 15–18, 20 have equivalent Android-POC counterparts in Phase 3.)*

**Evidence handling:** all screenshots and recordings must **redact personal information** (email, phone, real names, tokens, codes). **Raw evidence must not be committed to Git** in either repository.

### D. Test-account decision (APP-069)
- Use a **dedicated subscribed test account originally created through Google**.
- **Do not use Tyler's primary personal account** unless no safer option exists.
- Give it **realistic but non-sensitive** Victory Room and Current Goal data.
- **Capture privately BEFORE the POC** (do NOT commit): `clerk_user_id`, primary email, `publicMetadata` entitlement, Victory Room/goal state, and **total Clerk user count**.
- **After app email-code login, verify:** same `clerk_user_id`; exactly **one** matching Clerk user; **unchanged** entitlement; **unchanged** member data.
- **Do not put the email, codes, tokens, or private screenshots into Git.**
- **Status (2026-07-18): COMPLETE.** Tyler privately verified the baseline comparison; comparison **passed**. Same existing Clerk identity confirmed; no duplicate Clerk user created; subscribed entitlement and existing member data preserved. **No private identifiers committed.**

### E. Session and Client Trust plan (two stages)
**Stage A — before any Clerk lifetime change:**
- Prove cookies/session **survive ordinary close and force-close**.
- Prove Client Trust **challenges only once** as expected (not repeatedly).
- Prove **email-code login works cleanly** for the Google-origin user.

### Stage B — after Clerk Pro / lifetime change (APP-064 COMPLETE 2026-07-18)
- Production max lifetime is **180 days**; inactivity **off** (DEC-022).
- **APP-065 (IN PROGRESS):** verify elapsed-time persistence on iPhone (and later Android) across a meaningful calendar window; verify clean expiry → secure Clerk reauthentication; do **not** close APP-065 from immediate force-close/reopen alone (that short-cycle check already PASS after the settings change).

> **A short POC / immediate reopen cannot prove actual multi-month or full 180-day persistence.** True long-duration persistence is confirmed over calendar time under APP-065.

### F. Apple tooling requirements (by phase)
**Before local POC:**
- Current Mac / macOS
- Xcode + command-line tools
- Physical iPhone
- USB connection
- Apple ID
- Developer Mode (on the iPhone)
- Trust established between Mac and iPhone
- Tentative bundle identifier

> **Free provisioning may be enough for a disposable local POC**, but this **must be verified against the actual Xcode setup** (free provisioning has limits: short-lived signing, device caps, and some entitlement restrictions).

**Before TestFlight:**
- Paid **Apple Developer Program** ($99/yr)
- **App Store Connect** record
- Distribution signing / provisioning

**Before submission:**
- Compliance, privacy nutrition labels, **in-app account deletion**, screenshots, review notes, and **session-lifetime verification**.

### G. Go / no-go criteria (APP-021 gate)
**The POC FAILS if any of these occurs:**
- A **duplicate Clerk identity** is created.
- **Existing entitlement or history is lost.**
- **Session does not survive force-close.**
- **Client Trust repeatedly challenges** the same installation.
- **Authenticated APIs fail** inside the shell.
- **Victory Room fails** to load/function.
- **Live website updates cannot be supported** by the shell.
- The **shell behaves like an unstable browser window.**

**Fallback sequence (in order):**
1. **Correct Clerk / WebView configuration** in the Capacitor candidate.
2. If still failing, **test a direct native WKWebView shell.**
3. **Do not jump to React Native or native screen duplication** without a **formal failed-plan decision.**

---

## APP-008 Stage 1 + APP-070 architecture evidence — 2026-07-17

*Documentation-only record in the website master tracker. Evidence was manually verified on a **physical iPhone** in the separate `summitt-mindset-mobile` repository. No private identifiers (email, Clerk user id, codes, Apple/Team IDs, device UDID, Ask Pat content, Victory Room/goal text, screenshots, cookies, or trace IDs) are stored here. SMS behavior and website product logic were **not** changed by the mobile POC.*

### APP-008 implementation-location clarification (intentional evolution)
- Original Phase-2 plan assumed a **disposable throwaway** POC **outside** the eventual production mobile repo.
- Stage 1 was instead implemented in the dedicated **`summitt-mindset-mobile`** repository.
- That location change is an **intentional evolution**, documented here — not silent rewrite of history.
- **APP-008 COMPLETE** reflects the working physical-device POC and its recorded results (below).
- **APP-069 COMPLETE (2026-07-18):** Tyler privately verified the Google-origin subscribed test-account baseline comparison; comparison **passed**. Same existing Clerk identity confirmed; no duplicate Clerk user created; subscribed entitlement and existing member data preserved. **No private identifiers committed** to Git.

### Architecture tested (APP-070)
- Capacitor-generated iOS project
- Custom Swift `LiveShellViewController`
- Exactly one native `WKWebView`
- `WKWebsiteDataStore.default()`
- Live website loaded **directly by the native controller**
- **No Capacitor `server.url`**
- Victory Room as initial destination
- Existing website remains the product / source of truth

### Candidate selection language
**Candidate A2 is the selected leading architecture based on current physical-device evidence:** a custom Swift `WKWebView` live shell inside the Capacitor-generated iOS project (not CapBridge as the visible root).

**Why A2 leads (evidence-backed, not risk-free):**
- One persistent native `WKWebView`
- First-party Clerk session survived ordinary lifecycle, force-close, and full iPhone reboot testing
- Live website remains the single product source of truth
- No duplicated native product screens
- No `server.url` dependency
- Video, forms, keyboard, navigation, one controlled write (Ask Pat), and offline retry worked on-device
- Preserves Capacitor-generated project structure for later native capabilities while avoiding CapBridge as the visible root

**Candidate B** (bare native WKWebView / Android WebView shell) remains the **fallback only if a later blocker appears**. Production use of Capacitor `server.url` remains **prohibited**.

**This does not mean all production risks are resolved.** APP-021 (formal Phase-4 go/no-go + architecture selection + estimate confirm/revise) remains **open**.

### Stage 1 verified results (APP-008 — PASS)
| # | Result | Status |
|---|---|---|
| 1 | Live Summitt Mindset sign-in page rendered inside the app | PASS |
| 2 | Email verification-code authentication succeeded for the existing test account | PASS |
| 3 | Victory Room loaded with expected test-account data | PASS |
| 4 | No duplicate-user symptom was observed | PASS |
| 5 | Immediate force-close persistence passed | PASS |
| 6 | Repeated force-close and reopen passed | PASS |
| 7 | Full iPhone reboot persistence passed | PASS |
| 8 | No visible sign-in flash occurred | PASS |
| 9 | No white or blank launch screen occurred | PASS |
| 10 | No unusual launch delay was observed | PASS |
| 11 | Internal navigation remained inside the app | PASS |
| 12 | Film Room video playback passed | PASS |
| 13 | Audio, play/pause, full-screen, and exit from full-screen passed | PASS |
| 14 | Ask Pat layout and keyboard behavior passed | PASS |
| 15 | One controlled Ask Pat submission returned exactly one response with no observed duplicate submission | PASS |
| 16 | Offline launch displayed the designed connection-error state instead of a blank screen | PASS |
| 17 | Restoring connectivity and tapping Try Again returned to Victory Room while preserving authentication | PASS |
| 18 | Account/settings and visible test-account information appeared correct | PASS |
| 19 | Left-edge back navigation behaved normally | PASS |
| 20 | Backgrounding and resuming the app behaved normally | PASS |

**APP-008 Stage 1 live-shell POC: PASS.** **APP-070: COMPLETE** (architecture tested + observations recorded above).

### Strict completion truth (v1.5.1 — post APP-069 private baseline PASS)
- **COMPLETE means the task’s original acceptance criteria were fully satisfied.**
- **APP-069 COMPLETE.** Tyler privately verified the Google-origin subscribed test-account baseline comparison; comparison **passed**. **No private identifiers committed.**
- **APP-010 COMPLETE.** Intended email-code login posture on physical iPhone; email-code auth worked; **same existing Clerk identity confirmed**; **no duplicate Clerk user created**; relationship/member state intact.
- **APP-016 COMPLETE.** Subscribed account reached expected Victory Room/account surfaces; **subscribed entitlement matched the private baseline** (formally verified, not UI-inferred only); existing member data preserved.
- **Do not imply:** exhaustive testing of all account data; Android parity; long-term / 180-day elapsed session persistence; all Client Trust scenarios; App Store readiness; APP-065 complete; APP-015 complete; APP-021 complete.

### Explicit claim boundaries (do NOT over-claim)
- **Not claimed:** multi-week or multi-month / full **180-day elapsed** persistence; Google OAuth support; Android support; account deletion completion; push notifications; full external-link coverage; complete App Store readiness; exhaustive testing of every website page; exhaustive testing of every member-data write; that SMS behavior was exercised or changed; that Client Trust formal gates fully passed; that APP-065 is complete.
- **Preserved open work:** **APP-065** (elapsed-time long-session validation) remains **IN PROGRESS**; account deletion (APP-041) remains a **production requirement**; Android remains **unstarted**; Google OAuth remains outside the intended V1 app-only email posture; external-link handling was **not meaningfully exercised** (APP-015 remains open); Client Trust formal closure (APP-066) remains open; broader production-readiness and App Store work remains; SMS behavior and website product logic were **not** changed by the mobile POC. Production Clerk is configured for **180 days** (DEC-022) — configuration is done; elapsed proof is not. **APP-010 / APP-016 / APP-069 are COMPLETE** (private comparison PASS; no private values stored).

### APP-021 status after this evidence
**APP-021 remains NOT STARTED / open.** Evidence supports selecting Candidate A2 as the **leading** architecture, but the master plan’s Phase-4 acceptance criteria are not fully met yet. **Do not mark APP-021 COMPLETE.**

**Smallest remaining requirement for APP-021:**
1. Checkpoint A identity/entitlement gates are now closed (APP-010 / APP-016 / APP-069 COMPLETE; short-cycle iPhone shell/auth/member-surface evidence PASS). Remaining Checkpoint A limitations stay explicit (APP-065 elapsed proof, APP-015, Client Trust, Android, account deletion, App Store readiness), **and**
2. Either complete Android Checkpoint B (APP-018→APP-020) **or** explicitly amend APP-021 dependencies to allow an **iOS-first** architecture selection with Android deferred, **and**
3. Confirm or revise the hour estimate with recorded reason, **and**
4. Update DEC-020 from “open / unresolved” to the formal selected production shell.

Until those steps are done, do **not** treat DEC-020 as closed and do **not** mark APP-021 COMPLETE.

### Next master-plan work block (priority order)
1. **APP-065** — honest **elapsed-time** long-session validation (IN PROGRESS). Short-cycle post-180-day-config force-close/reopen already PASS; do not close APP-065 on that alone.
2. **APP-041** — account deletion parent **IN PROGRESS** (B1–B3b + B2b + C1 + **C2–D0 COMPLETE**; **D1** pending review). Exact next: **review D1 → worker/reconciler**. No public deletion capability. Canonical matrix: `docs/account-deletion-purge-matrix.md`.
3. **APP-015** — external-link policy when a natural link surface is available.
4. **APP-066** — Client Trust formal confirmation (**not** claimed as already fully passed).
5. **APP-021 planning gates** — Android Checkpoint B **or** explicit approved iOS-first dependency amendment + estimate confirm/revise + formal DEC-020 close.
6. **Remaining production-readiness and App Store requirements** — privacy/data-safety (APP-042), purchase messaging (APP-040), icons/splash/screenshots, TestFlight path (APP-049+), etc.
7. **Android only when the iOS path is sufficiently stable** — APP-018→APP-020 (and later Android production shell work).

---

## 5. BIGGEST UNKNOWNS (ranked)

> All platform-policy items are **LABELED: REQUIRES CURRENT-DOCUMENTATION VERIFICATION** — do not treat as settled fact.

**U1 — Clerk session persistence inside iOS WKWebView (HIGHEST).**
- *Why:* The entire "stay signed in, no re-login" promise depends on Clerk cookies/session surviving in WKWebView across force-close. Clerk is cookie/session based (`@clerk/nextjs`).
- *Two distinct factors:* **(a)** does the WebView persist the session cookie across force-close? and **(b)** the Clerk **maximum session lifetime** ceiling — formerly **7 days** on Hobby Dashboard (rejected for production, DEC-021); now configured to **180 days** (DEC-022 / APP-064). Website application code never implemented a 7-day limit. Even perfect cookie persistence cannot exceed the Dashboard lifetime ceiling, so **APP-065** must verify elapsed-time behavior (and clean expiry → secure reauth).
- *Stage 1 evidence (2026-07-17):* Factor **(a) PASS** on physical iPhone under Candidate A2 — immediate force-close, repeated force-close, and **full reboot** persistence passed; no sign-in flash; offline retry preserved auth.
- *Config update (2026-07-18):* Factor **(b) configured** to 180 days (inactivity off) after Pro upgrade. Immediate post-change force-close/reopen → Victory Room **PASS**. Factor **(b) elapsed-time proof remains OPEN** under APP-065 — multi-month / full-window persistence **not claimed**.
- *Test early:* Phase 2 (first thing) — Stage 1 done for (a).
- *Cheapest test:* throwaway Capacitor iOS app loading the live `/sign-in`, log in, force-close, reopen, hit `/dashboard/victory-room`.
- *Pass:* reopening lands in Victory Room without re-login for at least a normal session lifetime; and (later) stays signed in across the selected long-term window.
- *Fail consequence:* users re-login constantly → core value destroyed.
- *Backup:* Clerk WebView/native guidance, custom cookie persistence config, or (last resort) `@clerk/clerk-expo`-style native auth (major scope change). *REQUIRES CLERK-DOC VERIFICATION.*
- *Hours at risk:* 10–24 (remaining risk is primarily lifetime configuration + long-duration proof, not short-cycle cookie survival).

**U2 — Clerk session persistence inside Android WebView.**
- Same as U1 for Android WebView (different cookie/storage behavior). Test in Phase 3. **Android remains unstarted.** Hours at risk: 6–16.

**U3 — Clerk OAuth / social-login behavior in WebView. RESOLVED for V1 (2026-07-17).**
- *Finding (APP-007):* Google IS enabled on the shared Clerk instance and Apple is NOT. But **V1 hides social in the app and uses email-code only (DEC-018 ACTIVE)**, so **OAuth-in-WebView return handling is out of scope for V1** and Sign in with Apple is not required. The website keeps Google. OAuth-return work (APP-029) is only needed if the app ever chooses to show social (DEC-018 revisit trigger).
- *Stage 1 + APP-069 residual (APP-010 COMPLETE 2026-07-18):* intended email-code login posture on physical iPhone; email-code auth worked; **same existing Clerk identity confirmed**; **no duplicate Clerk user created**; relationship/member state intact. Tyler privately verified the baseline comparison; **no private identifiers committed**. Google OAuth remains **outside** intended V1 app-only email posture. Hours at risk (V1 residual): ~0.

**U4 — Redirect/callback behavior (middleware, post-sign-in, subscribe returns).**
- *Why:* `middleware.ts` redirects unauth → `/sign-in`; `post-sign-in` chains redirects; Stripe returns to `/subscribe/success`. Redirect chains can loop or break in a WebView.
- *Stage 1:* live sign-in → Victory Room path worked on-device; broader subscribe-return chains not exhaustively claimed. *Pass:* full logged-out→VR chain completes. *Backup:* app-signal-gated simplified entry route. Hours at risk: 3–10.

**U5 — Which production shell renders the live site best (architecture unresolved)?**
- *Why:* The "auto-update" mandate requires the shell to render the live site. **This does NOT dictate `server.url`** — that is Capacitor's dev/live-reload config, not approved production truth (see Architecture correction 2026-07-17, DEC-020). The POC must compare Capacitor-with-production-WebView vs a minimal native `WKWebView`/Android WebView shell (and any superior hybrid). Rendering the live site maximizes reuse but increases Apple 4.2 "just a website" risk.
- *Stage 1 evidence (2026-07-17):* **Candidate A2** (custom Swift `LiveShellViewController` + one native `WKWebView` inside Capacitor-generated iOS project; live load by native controller; **no `server.url`**) is the **selected leading architecture based on current physical-device evidence**. Candidate B remains fallback only. **APP-021 / DEC-020 formal close still open** (Android Checkpoint B + estimate revise unmet).
- *Test:* Phase 1 (policy, done) + Phase 2/4 (technical + architecture decision). *Pass:* a candidate loads reliably, persists Clerk sessions, handles navigation/links, and is store-defensible. *Backup:* native-shell candidate; add native features. Hours at risk: 4–12. **VERIFY at Phase 4 checkpoint (APP-021).**

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

**U10 — Web-purchased subscription access inside app.** Structurally fine (entitlement in Clerk metadata via webhook). **APP-016 COMPLETE (2026-07-18):** subscribed entitlement matched the private baseline (formally verified, not UI-inferred only); subscribed account reached expected Victory Room/account surfaces; existing member data preserved. Tyler privately verified; **no private identifiers committed**. Hours at risk (formal entitlement residual): ~0. Unsubscribed negative control and exhaustive member-data coverage remain outside this closure.

**U11 — Account deletion compliance. VERIFIED 2026-07-17 — requirement; architecture sized 2026-07-18.** Apple 5.1.1(v) requires an **in-app deletion path** when the app supports account creation; Google requires **both** in-app **and** an external web resource. Current page is email-only (`data-deletion/page.tsx`) and is **insufficient**. **APP-041 parent IN PROGRESS**; **APP-041A COMPLETE**; DEC-023 **APPROVED-FOR-IMPLEMENTATION** (not implemented). Planning range **≈ 24–40 focused hours** (obsolete 3h tracker estimate retired). Hours remaining after APP-041A: **≈ 22–36**.

**U12 — Sign in with Apple requirement. RESOLVED 2026-07-17.** APP-007 confirmed Google is enabled (Apple not). Because **V1 shows no social in the app** (DEC-018 ACTIVE), Apple 4.8 is **not triggered** and **SIWA is not required in V1**. Hours at risk (V1): 0. Revisit only if the app later adds social login.

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
- **Clerk Pro is an operating expense, not engineering hours.** Raising the Clerk maximum session lifetime beyond the Hobby 7-day ceiling required **Clerk Pro** (Custom session lifetime). **APP-062–064 COMPLETE (2026-07-18):** production upgraded to Pro at **$20/month billed annually**; max lifetime set to **180 days**; inactivity off; **no website/mobile code change**. Remaining work is **APP-065** elapsed-time proof (not eng hours for the setting itself).
- **False-precision caveat:** this is a planning range, not a promise. Treat the single-number total in the table as the working-target midpoint, not a commitment.

### Estimate revision — 2026-07-18 (APP-041 sized after audit + APP-041A)

- **Prior APP-041 tracker line item:** **3 focused hours** (obsolete; understated orchestration reality).
- **Prior responsible project range:** ≈ **115–150** focused hours (v1.1 revision already treated deletion as Required, but with a thin placeholder).
- **New APP-041 planning range:** approximately **24–40 focused hours** total (APP-041A 2–4 COMPLETE; APP-041B 8–14; APP-041C 3–5; APP-041D 4–8; APP-041E 6–10; APP-041F 1–2). Remaining after APP-041A: ≈ **22–36**.
- **Newly discovered effort vs prior 3h line item:** roughly **+21–37 focused hours** of coordinated website deletion work (Stripe cancel, SMS kill/tombstone/resurrection guards, multi-table purge, Clerk-last, retry) — distinct from work already completed (policy, Stage 1 POC, Clerk Pro/180-day config, APP-010/016/069).
- **Updated responsible project range:** working target shorthand remains **"the 115-hour app"**; current responsible range ≈ **130–175 focused hours** (widened only to absorb the newly sized APP-041 orchestration band; not false precision).
- **Not claimed:** APP-041 implemented; overall project re-baselined to a single new midpoint; push/native IAP folded in.

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
- **Scope (must test):** website loads; Clerk **email verification-code** login **with no Google shown**; **session persists after force-close/reopen**; reaches Victory Room; authenticated API call (Ask Pat); Vimeo plays; external links behave; a **subscribed test account** sees entitlement. **Must use a real account that originally used Google sign-in, is subscribed, and has real member data**, and run the full **15-item iPhone POC acceptance criteria** in "APP-007 login posture — 2026-07-17" (same-`clerk_user_id` resolution, no duplicate user, entitlement/VR/Current Goal/history/SMS state intact, Client Trust single challenge, multi-day session, clean expiry).
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
- **Scope:** same checklist on Android emulator + one real device, **including the equivalent critical login-posture checks** (email-code login with no Google, same-`clerk_user_id` resolution for a Google-origin subscribed account, no duplicate user, entitlement/VR intact, session persists across force-close, Client Trust not repeatedly challenged, multi-day session, clean expiry — items 1–13 & 15 of the iPhone POC acceptance criteria).
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
- **Goal:** Make Clerk login + persistence robust to the agreed standard (U1–U4) using the **app-only email-code posture (DEC-018 ACTIVE)** — no Google/social shown in the app; website unchanged.
- **Scope:** implement the chosen APP-061 mechanism (preferred: dedicated app sign-in surface / headless `useSignIn`, email-code first, same Clerk instance); configure WebView cookie/storage persistence; ensure no redirect loops in `/sign-in`→`/post-sign-in`→VR; confirm entitlement recognized; confirm Google-origin users resolve to the same `clerk_user_id` (no duplicate). **OAuth-return handling (APP-029) is NOT in V1 scope** unless social is later added. Session-lifetime is a separate track (APP-062–APP-066).
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
| APP-007 | 1 | WEBSITE | Check Clerk dashboard: which login methods are enabled (email/social) | COMPLETE | 0.5 | NOT RECORDED | APP-005 | "APP-007 login posture — 2026-07-17" section (confirmed 2026-07-17 dashboard screenshots + repo audit) | Google enabled, Apple not, email-code enabled, 7-day lifetime, Client Trust on, deletion new-users-only/existing unknown |
| APP-008 | 2 | POC | Create disposable throwaway iOS POC (NOT production); repo-identity precheck | COMPLETE | 1.5 | NOT RECORDED | APP-059,APP-067,APP-069 | "APP-008 Stage 1 + APP-070 architecture evidence — 2026-07-17" | **Stage 1 live-shell POC: PASS** on physical iPhone. **Intentional evolution:** implemented in dedicated `summitt-mindset-mobile` (not the original throwaway-outside-repo assumption). Completion reflects the working physical-device POC + recorded results. Does **not** mark APP-069 complete; does not settle APP-021 / DEC-020 |
| APP-009 | 2 | POC | Load production URL `/dashboard/victory-room` on iOS device | COMPLETE | 0.5 | NOT RECORDED | APP-008 | Stage 1 evidence § results 1, 3 | Live site + Victory Room initial destination verified |
| APP-010 | 2 | POC | Test Clerk email login on iOS | COMPLETE | 0.5 | NOT RECORDED | APP-009 | Stage 1 + APP-069 private baseline PASS (2026-07-18) | Intended email-code login posture on physical iPhone; email-code auth worked; **same existing Clerk identity confirmed**; **no duplicate Clerk user**; relationship/member state intact. Tyler privately verified baseline comparison; **no private identifiers committed**. Google OAuth not claimed |
| APP-011 | 2 | POC | Test session persistence after iOS force-close/reopen | COMPLETE | 0.5 | NOT RECORDED | APP-010 | Stage 1 evidence § results 5–7, 20 | Force-close, repeated force-close, and full reboot PASS. Multi-week/month NOT claimed. (Former Hobby 7-day Dashboard ceiling replaced by 180-day config — APP-064; elapsed proof is APP-065.) |
| APP-012 | 2 | POC | Test reaching Victory Room authed on iOS | COMPLETE | 0.5 | NOT RECORDED | APP-011 | Stage 1 evidence § results 3, 17–18 | VR + account/settings appeared correct |
| APP-013 | 2 | POC | Test authenticated API call (Ask Pat) on iOS | COMPLETE | 0.5 | NOT RECORDED | APP-012 | Stage 1 evidence § results 14–15 | Layout/keyboard PASS; one controlled submission → one response; no private content recorded |
| APP-014 | 2 | POC | Test Vimeo playback on iOS | COMPLETE | 0.5 | NOT RECORDED | APP-012 | Stage 1 evidence § results 12–13 | Film Room playback + audio/play-pause/fullscreen PASS |
| APP-015 | 2 | POC | Test external-link behavior on iOS | NOT STARTED | 0.5 | | APP-012 | | **Not meaningfully exercised** — tested surfaces exposed no natural external link. Remains open |
| APP-016 | 2 | POC | Test subscribed-account entitlement recognized on iOS | COMPLETE | 0.5 | NOT RECORDED | APP-012 | Stage 1 UI surfaces + APP-069 private baseline PASS (2026-07-18) | Subscribed account reached expected Victory Room/account surfaces; **subscribed entitlement matched private baseline** (formally verified, not UI-inferred only); existing member data preserved. Tyler privately verified; **no private identifiers committed** |
| APP-017 | 2 | POC | Record iOS POC results table + captures | COMPLETE | 0.5 | NOT RECORDED | APP-009,APP-010,APP-011,APP-012,APP-013,APP-014,APP-016 | "APP-008 Stage 1 + APP-070 architecture evidence — 2026-07-17" (20-row results table) + APP-069 private baseline PASS | Feeds Checkpoint A. No private captures/identifiers committed to Git. **APP-015 remains open** |
| APP-018 | 3 | POC | Create throwaway Android POC + run emulator/device | NOT STARTED | 1.5 | | APP-017 | | Android remains unstarted — defer until iOS path is sufficiently stable |
| APP-019 | 3 | POC | Repeat critical checklist on Android (login/persist/VR/API/Vimeo) | NOT STARTED | 2 | | APP-018 | | U2 |
| APP-020 | 3 | POC | Record Android POC results table | NOT STARTED | 0.5 | | APP-019 | | Feeds Checkpoint B |
| APP-021 | 4 | WEBSITE | Architecture go/no-go **+ production-shell selection** + estimate confirm/revise | NOT STARTED | 1 | | APP-017,APP-020 | | **OPEN.** Candidate A2 is evidence-backed **leading** architecture. Checkpoint A identity/entitlement gates closed (APP-010/016/069 COMPLETE). Phase-4 still unmet: Android Checkpoint B **or** explicit approved iOS-first amendment, estimate confirm/revise, and formal DEC-020 close. Do **not** mark COMPLETE |
| APP-022 | 5 | MOBILE | Bootstrap the separate `summitt-mindset-mobile` repo + create production shell (iOS+Android) per Phase-4 architecture, bundle IDs; repo-identity precheck | NOT STARTED | 3 | | APP-021,APP-059 | | Depends on APP-059 repo creation |
| APP-023 | 5 | MOBILE | Configure the Phase-4-selected production load mechanism (render live site) — NOT assumed `server.url` | NOT STARTED | 1 | | APP-022 | | `server.url` only with recorded Phase-4 justification |
| APP-024 | 5 | MOBILE | Status bar + safe-area handling both platforms | NOT STARTED | 2 | | APP-023 | | |
| APP-025 | 5 | MOBILE | Android hardware back-button behavior | NOT STARTED | 1 | | APP-023 | | |
| APP-026 | 5 | MOBILE | Loading indicator for remote load | NOT STARTED | 1 | | APP-023 | | |
| APP-027 | 6 | MOBILE | WebView cookie/storage persistence config (iOS) | NOT STARTED | 3 | | APP-023 | | U1 |
| APP-028 | 6 | MOBILE | WebView cookie/storage persistence config (Android) | NOT STARTED | 2 | | APP-023 | | U2 |
| APP-029 | 6 | MOBILE | OAuth/social return handling (if social enabled) | DEFERRED | 3 | | APP-007,APP-027 | APP-007/APP-061 chose app-only email (DEC-018 ACTIVE) | NOT in V1 scope — app shows no social; revisit only if DEC-018 changes |
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
| APP-041 | 10 | WEBSITE | In-app account-deletion **parent workstream** — **REQUIRED before submission** (Apple 5.1.1(v)/Google) | IN PROGRESS | 24–40 | | APP-005 | "APP-041 account deletion — 2026-07-18"; DEC-023 | Parent only — **not COMPLETE**. Phases APP-041A–F. Obsolete est. 3h retired. **SMS:** do not broadly refactor/endanger SMS; narrowly handle audience/identity/jobs/consent/STOP/resurrection; do not blindly destroy STOP evidence; prove other users unchanged. Clerk-only delete is **not** full deletion |
| APP-041A | 10 | WEBSITE | Live Supabase schema + Clerk Dashboard verification (read-only) | COMPLETE | 2–4 | NOT RECORDED | APP-041 | "APP-041 account deletion — 2026-07-18" | Repo audit + three read-only `information_schema` queries + Clerk inspect. No settings/data/schema changed. Existing-user apply **not** clicked. Implementation contract may now be designed from real schema evidence |
| APP-041B | 10 | WEBSITE | Durable deletion state + backend orchestrator (parent) | IN PROGRESS | 8–14 | | APP-041A | APP-041B1 + B2a applied | **Not COMPLETE.** B1+B2a foundation live in production DB; Stripe/purge/Clerk delete not started. No public initiate until APP-041C |
| APP-041B1 | 10 | WEBSITE | Durable `account_deletion_requests` + repository/tests (no HTTP) | COMPLETE | 3–5 | NOT RECORDED | APP-041A | migration `20260718120000_account_deletion_requests.sql` applied + validated | **Applied/validated in production.** No endpoint/UI/Stripe/Clerk/purge. No account deletable via this slice |
| APP-041B2a | 10 | WEBSITE | Local SMS unlink + anti-resurrection + coach final-send gate (no public API) | COMPLETE | ~4–6 of B band | NOT RECORDED | APP-041B1 | migration `20260718130000_account_deletion_sms_suppress.sql` applied + validated; HEAD lineage `723bc6b…` | **Applied/validated in production.** Unlink ≠ STOP. No phone hash/HMAC/evidence table. No public deletion capability |
| APP-041B2b | 10 | WEBSITE | Outbound SMS final-send deletion guards (no public API) | COMPLETE | ~2–4 of B band | NOT RECORDED | APP-041B2a | HEAD `61f615a0837535a06e2b392c8126226f94163616` | **Committed/pushed.** No migration. Path-specific lookup recovery. No public deletion |
| APP-041B3a | 10 | WEBSITE | Stripe cancellation orchestration (no public API) | COMPLETE | ~3–5 of B band | NOT RECORDED | APP-041B1 | migration `20260718140000_account_deletion_cas_stripe_result.sql` applied | **Applied/validated.** No public deletion |
| APP-041B3b | 10 | WEBSITE | Stripe entitlement anti-resurrection (no public API) | COMPLETE | ~2–4 of B band | NOT RECORDED | APP-041B3a | HEAD `aab8b02…` | **Committed/pushed.** No migration. No public deletion |
| APP-041C1 | 10 | WEBSITE | Purge/anonymization policy + dependency freeze (docs only) | COMPLETE | ~1–2 | NOT RECORDED | APP-041B2b | `docs/account-deletion-purge-matrix.md`; HEAD `8e5d73b…` | **Committed/pushed.** Docs only at C1. |
| APP-041C2 | 10 | WEBSITE | Server-only purge RPC + CAS `purge_result` (no public API) | COMPLETE | ~4–8 | | APP-041C1 | migrations `20260719120000_…` + `20260719121000_…` **applied + validated** | Fake-user ROLLBACK + zero-residue passed. No public endpoint. No Clerk delete. |
| APP-041C3 | 10 | WEBSITE | Application purge orchestrator (no public initiation) | COMPLETE | ~2–4 | | APP-041C2 | `orchestrate-app-data-purge.ts` | `7f1a7e0…`; no public endpoint; no Clerk delete |
| APP-041D0 | 10 | WEBSITE | CAS clerk_result foundation | COMPLETE | ~1–2 | | APP-041C3 | `20260719130000_…` applied + verified | HEAD `0c3fe21…`; 20-key smoke passed; zero residue |
| APP-041D1 | 10 | WEBSITE | Clerk deletion-last adapter/orchestrator | COMPLETE | ~3–5 | | APP-041D0 | `orchestrate-clerk-deletion.ts` | HEAD `8dcf2e3…`; injected fake only; no real Clerk; no public UI |
| APP-041E1 | 10 | WEBSITE | Trusted one-request / one-stage reconciler | COMPLETE | ~2–4 | | APP-041D1 | `reconcile-account-deletion.ts` | HEAD `3c4e6f0…`; injected stages only; no scheduler/cron/route; no batch scanner |
| APP-041E2 | 10 | WEBSITE | Trusted execution safety foundation | COMPLETE | ~2–3 | | APP-041E1 | throw/malformed normalize + dep bundle + executeTrusted | `f024a7e56bc278bd8efc7e06e38fdff433cdca7c` |
| APP-041E3a | 10 | WEBSITE | Unreachable production-safe stage wiring | IMPLEMENTED — PENDING REVIEW | ~3–4 | | APP-041E2 | trusted SMS/Stripe/purge factories + Clerk REST adapter + production factory | No route/cron/discovery; adapter uninvoked |
| APP-041C | 10 | WEBSITE | Account UI + deliberate confirmation + reauthentication | NOT STARTED | 3–5 | | APP-041B | | Website flow must work in browser + iPhone WKWebView; required before any public delete initiate route |
| APP-041D | 10 | WEBSITE | Stripe/SMS race and resurrection hardening | NOT STARTED | 4–8 | | APP-041B | | Webhook/cron/inbound guards; narrow SMS tests |
| APP-041E | 10 | WEBSITE | Automated tests + physical-iPhone validation | NOT STARTED | 6–10 | | APP-041C,APP-041D | | No private evidence in Git |
| APP-041F | 10 | WEBSITE | Privacy/store documentation + final evidence | NOT STARTED | 1–2 | | APP-041E | | Improve `/data-deletion` as Google external resource; align privacy/terms |
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
| APP-059 | 5 | MOBILE/TYLER | Create the **empty private** `summitt-mindset-mobile` GitHub repository (Tyler creates it manually unless authenticated tooling is explicitly confirmed); clone outside the website repo | COMPLETE | 1 | NOT RECORDED | APP-061 | Stage 1 POC ran from the separate mobile repository | Repo exists; Stage 1 physical-device evidence recorded in website master plan. Website-doc tasks must not edit the mobile repo |
| APP-060 | 1 | WEBSITE | Tyler confirms Google Play account type + creation date (12-tester/14-day applicability) | NOT STARTED | 0.5 | | APP-006 | | Tyler + Play Console |
| APP-061 | 6 | WEBSITE | Finalize V1 login posture (email-only vs social) after APP-007; record decision | COMPLETE | 0.5 | NOT RECORDED | APP-007 | "APP-007 login posture — 2026-07-17" section: DEC-018 ACTIVE (app-only email-code, same instance); mechanism hierarchy + 15-item POC acceptance criteria recorded. Documentation/decision only — implementation is Phase 6 |
| APP-062 | 1 | WEBSITE | Tyler verifies current Clerk Pro pricing + allowed maximum-lifetime behavior | COMPLETE | 0.5 | NOT RECORDED | APP-007 | Production Clerk was on Hobby (7-day max enforced). Clerk Pro includes Custom session lifetime. Tyler selected Pro at **$20/month billed annually** (no optional add-ons) | Opens APP-063/064; operating expense, not eng hours |
| APP-063 | 4 | WEBSITE | Decide final production session lifetime after POC evidence (target 180d min / ~1yr) | COMPLETE | 0.5 | NOT RECORDED | APP-017,APP-062 | **DEC-022:** target chosen as **180 days** maximum lifetime; inactivity timeout **disabled**. Not permanent/indefinite | Do not promise "forever" |
| APP-064 | 6 | MOBILE | Change Clerk maximum session lifetime — **separately-approved Clerk-settings task** | COMPLETE | 0.5 | NOT RECORDED | APP-063 | Production Dashboard: max lifetime **7→180 days** (ENABLED); inactivity **DISABLED**. Affects website browsers + iOS WKWebView (same Clerk instance). **No app/website code change** | Short-cycle post-change iPhone force-close/reopen → VR PASS; does **not** complete APP-065 |
| APP-065 | 6 | MOBILE | Verify the new lifetime on iPhone + Android (stays signed in across long-term window) | IN PROGRESS | 1 | | APP-064 | Immediate post-change force-close/reopen PASS only. **Real elapsed-time** validation across the configured window remains outstanding; true 180-day expiry / revoked-session reauth not yet observed | Must pass before store submission. Do **not** mark COMPLETE from short-cycle alone |
| APP-066 | 6 | MOBILE | Confirm Client Trust does not repeatedly challenge the same app installation | NOT STARTED | 1 | | APP-027,APP-028 | | RISK-23; tie to WebView `__client` cookie persistence |
| APP-067 | 5 | MOBILE | Add mobile-repo `README.md`, `.gitignore`, `docs/mobile-repo-guardrails.md`, `docs/mobile-session-handoff.md`, `docs/architecture-decision.md` (decision placeholder) | NOT STARTED | 1 | | APP-059 | | Guardrail-document bootstrap in the mobile repo. Status in mobile repo may already be ahead — confirm in a mobile-repo task; do not edit mobile repo from this website-doc session |
| APP-068 | 5 | MOBILE | Record the architecture comparison matrix in `docs/architecture-decision.md`; **final choice pending Phase 4 (APP-021)** | NOT STARTED | 0.5 | | APP-067 | | Website master plan now records Candidate A2 as leading (APP-070); mobile-repo matrix still to sync. Final choice remains APP-021 |
| APP-069 | 2 | TYLER | Capture a **private** Google-origin subscribed test-account baseline (clerk_user_id, primary email, publicMetadata entitlement, Victory Room/goal state, total Clerk user count) | COMPLETE | 0.5 | NOT RECORDED | APP-007 | Tyler private baseline comparison PASS (2026-07-18) | Tyler privately captured and compared the required Google-origin subscribed test-account baseline. **Same existing Clerk identity confirmed.** **No duplicate Clerk user created.** Subscribed entitlement and existing member data preserved. Relationship state intact. Comparison **passed**. Tyler privately verified; **no private identifiers committed** to Git |
| APP-070 | 2 | POC | Record which shell architecture was tested and the observations (evidence for APP-021) | COMPLETE | 0.5 | NOT RECORDED | APP-008 | "APP-008 Stage 1 + APP-070 architecture evidence — 2026-07-17" | Candidate A2 leading; Candidate B fallback; `server.url` prohibited. Feeds APP-021 but does not close it |

---

## 9. DEPENDENCY MAP

- **Critical path:** APP-000 → APP-003/004/005/006 (policy, COMPLETE) → **APP-007 (Clerk dashboard, COMPLETE)** → **APP-059 (mobile repo, COMPLETE)** → **APP-008 Stage 1 iPhone live-shell POC (PASS) + APP-070 (COMPLETE; Candidate A2 leading)** → **APP-062–064 COMPLETE (Clerk Pro + 180-day max lifetime)** → **APP-010 / APP-016 / APP-069 COMPLETE (private baseline PASS)** → **APP-065 IN PROGRESS** + **APP-041 IN PROGRESS** (APP-041A COMPLETE; next APP-041B planning) → APP-021 (formal Phase-4 architecture close — still OPEN) → APP-022/023 (production shell harden) → broader device/App Store path → Android (APP-018+) when iOS is sufficiently stable → launch.
- **Repo ownership on the path:** planning/policy/deletion-endpoint/docs are **WEBSITE**; shell/config/store builds are **MOBILE** (`summitt-mindset-mobile`); POC tasks are disposable **POC** projects. No task edits both repos without explicit authorization (DEC-016).
- **v1.5.2 dependency notes:** **APP-062–064 COMPLETE**. **APP-010/016/069 COMPLETE**. **APP-065 IN PROGRESS**. **APP-041 IN PROGRESS** (APP-041A COMPLETE; APP-041B–F NOT STARTED; DEC-023 APPROVED-FOR-IMPLEMENTATION, not implemented; planning range ≈24–40h). **APP-021 remains OPEN**. **APP-015** and **APP-066** remain open. Android APP-018+ deferred until iOS path is sufficiently stable. APP-022 still depends on **APP-021**. APP-053/APP-055 depend on **APP-041** and **APP-065**.
- **Session-lifetime chain:** APP-062 (COMPLETE) → APP-063 (COMPLETE) → APP-064 (COMPLETE) → **APP-065 (IN PROGRESS)** + APP-066 (Client Trust). Former Hobby **7-day** Dashboard ceiling replaced by **180-day** max lifetime (DEC-022). Website code never enforced 7 days. Short-cycle cookie/lifecycle persistence proven; **elapsed 180-day persistence not proven**. **Client Trust formal pass is not claimed** from Stage 1 alone.
- **APP-041 chain:** APP-041A (COMPLETE) → APP-041B (orchestrator; next = planning) → APP-041C (UI) → APP-041D (race hardening) → APP-041E (tests/iPhone) → APP-041F (privacy/store evidence). Parent stays IN PROGRESS until F closes.
- **Parallelizable:** APP-041B planning alongside APP-065; APP-015 / APP-066 alongside; privacy/data-safety drafting (APP-042) alongside; Android POC (APP-018..020) only after iOS is stable enough; icons/splash later. Legal/retention questions parallel — not blockers to APP-041A (already complete) or APP-041B planning.
- **Require Tyler:** APP-065 (elapsed-time device checks), APP-060 (Play account), APP-042/048 (privacy + screenshots), all device testing, all store-account tasks.
- **Require Apple Developer access:** APP-049, APP-050, APP-053, APP-054.
- **Require Google Play access:** APP-051, APP-052, APP-055.
- **Require Clerk configuration:** APP-007, APP-029, APP-030 (allowed origins/redirect URLs); **APP-064 COMPLETE** (max lifetime change already applied in production Dashboard).
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
| DEC-004 | Capacitor-generated project remains the iOS shell host; **Candidate A2** (custom Swift live `WKWebView`) is the evidence-backed **leading** architecture (amended from generic "Capacitor leading candidate") | Stage 1 physical-device POC PASS (APP-008/APP-070). Final APP-021 close still open | 2026-07-17 | ACTIVE (amended; pending APP-021) | APP-021 formal close; later blocker forces Candidate B |
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
| DEC-018 | **V1 mobile authentication uses app-only first-party email authentication on the same Clerk instance.** Google remains on the website. The app does not show Google or other social providers. Email verification code is the universal login factor. | Avoids Apple 4.8 trigger; avoids Sign in with Apple work in V1; avoids OAuth/WebView callback complexity; preserves one user pool + existing Clerk identities; protects website users who depend on Google; supports Google-origin users via verified-email code sign-in (**APP-010 / APP-069 COMPLETE** — same existing Clerk identity confirmed; no duplicate; no private identifiers committed). Confirmed by APP-007 (Google enabled, Apple not, email-code enabled) + APP-061 + private baseline PASS. | 2026-07-17 | **ACTIVE** | Existing Google users cannot authenticate via email code on a future account; Apple rejects the posture; Clerk cannot support a clean app-only email surface; product strategy later requires social login in the app |
| DEC-021 | **7-day session lifetime is rejected for production; members must stay signed in for months.** | The tap-and-stay-signed-in promise is core value; a weekly/monthly forced re-login is unacceptable. Never promise "forever." | 2026-07-17 | ACTIVE (product standard) | Security review requires shorter; elapsed-time proof fails (APP-065) |
| DEC-022 | **Production Clerk maximum session lifetime = 180 days; inactivity timeout remains DISABLED.** Workspace upgraded Hobby → Pro ($20/mo annual; Custom session lifetime included; no optional add-ons). Applies to website browsers and iOS WKWebView (same production Clerk instance). Intended to reduce recurring login friction while retaining periodic secure reauthentication at expiry/revocation. **No website or mobile-shell code change.** APP-065 remains responsible for honest elapsed-time validation — short-cycle post-change force-close/reopen PASS does **not** prove 180-day persistence. | APP-062–064 completed 2026-07-18 via production Clerk Dashboard; prior 7-day ceiling was Hobby Dashboard max-lifetime (not app code) | 2026-07-18 | **ACTIVE** | APP-065 fails; security review shortens; plan/pricing changes |
| DEC-023 | **V1 account deletion is a website-owned coordinated workflow (APPROVED-FOR-IMPLEMENTATION — not IMPLEMENTED).** Authenticated self-only delete; deliberate confirmation + reauth; durable pending status; SMS suppression first; Stripe cancel before identity delete; scoped purge/anonymize; retain required STOP/consent + financial records; Clerk delete last; session terminate; idempotent retry; deletion-aware webhook/cron anti-resurrection. `/data-deletion` remains Google external resource. Clerk Dashboard self-delete alone is **not** sufficient. | APP-041 repository audit + APP-041A live schema/Clerk verification (2026-07-18); store requirements APP-005 | 2026-07-18 | **APPROVED-FOR-IMPLEMENTATION** | Legal/retention answers change order; implementation evidence fails; store policy change |
| DEC-019 | **CANDIDATE:** iPhone-first sequencing; hide all in-app purchasing in V1 (neutral inactive-membership state) | APP-003/APP-004 posture; lowers Apple risk | 2026-07-17 | CANDIDATE — confirm at Phase 4/Checkpoint D | Policy re-verification changes posture |
| DEC-020 | **Production shell architecture: Candidate A2 is the selected leading architecture based on current physical-device evidence** (custom Swift `LiveShellViewController` + one native `WKWebView` inside Capacitor-generated iOS project; live site loaded by native controller; **no `server.url`**). Candidate B (bare native WKWebView/Android WebView) remains fallback only if a later blocker appears. Production `server.url` remains **prohibited**. **Formal APP-021 close still OPEN** (Android Checkpoint B unmet unless iOS-first amendment; estimate confirm/revise unmet). Do NOT pivot to React Native or duplicate screens | Stage 1 iPhone POC PASS + APP-070 observations (2026-07-17). Prior unresolved candidates (a)/(b)/(c) narrowed to A2 leading | 2026-07-17 | ACTIVE (leading selected; formal close pending APP-021) | APP-021 Phase-4 checkpoint formally closes DEC-020 |

---

## 11. RISK REGISTER

| Risk ID | Risk | Prob | Impact | Early warning | Mitigation | Fallback | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| RISK-01 | Clerk session fails in WebView | Low-Med (iOS short-cycle reduced) | Critical | POC login/persist fails | WebView cookie config; Clerk WebView guidance | Native auth adaptation (major) | Tyler+Cursor | **PARTIALLY MITIGATED (iOS Stage 1 PASS)** — force-close + reboot persistence passed under A2; long-session lifetime (RISK-03) and Android (U2) remain OPEN |
| RISK-02 | OAuth callback fails in WebView | Med | High | Social login dead-ends in POC | In-app-browser return handling; email-only in app | Hide social in app | Tyler+Cursor | OPEN |
| RISK-03 | Repeated sign-ins / session expiry (incl. former 7-day Hobby ceiling) | Med | High | Users re-login on reopen or at configured max lifetime | Production max lifetime now **180 days** (DEC-022 / APP-064); prove with APP-065 elapsed-time; keep secure reauth on expiry | Adjust lifetime; document standard | Cursor+Tyler | **PARTIALLY MITIGATED** — config raised; **APP-065 elapsed-time still OPEN** |
| RISK-04 | Apple 4.2 minimum-functionality rejection | Med-High | High | Reviewer cites "just a website" | Add native features (push), members-only framing | Add push; richer native shell | Tyler | OPEN |
| RISK-05 | Apple 3.1.1 payment rejection | Med | High | Reviewer flags web checkout | V1 shows **no in-app selling** (neutral inactive state); do NOT rely on reader-app classification; external purchase **links** are **storefront-dependent** (broader US latitude under 3.1.1(a), restricted elsewhere) — re-verify per storefront before submission | Native IAP (+30–40h) | Tyler | OPEN |
| RISK-06 | Google payment-policy issue | Low-Med | Med | Play flags external billing | Same reader posture | Play Billing | Tyler | OPEN |
| RISK-07 | Vimeo WebView playback issue | Low (iOS Stage 1 reduced) | Med | POC video won't play inline | `allowsInlineMediaPlayback`, fullscreen config | Native player (deferred) | Cursor | **PARTIALLY MITIGATED (iOS Stage 1 PASS)** — Film Room playback + fullscreen passed; Android untested |
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
| RISK-22 | **Duplicate Clerk user orphans a member from data/entitlement** (all backend keyed on `clerk_user_id`) | Med | Critical | App sign-in of a Google-origin user creates a new Clerk id → empty/unsubscribed state | App-only **email-code** sign-in resolves the existing account by verified email (DEC-018); **APP-010 / APP-069 COMPLETE** — same existing Clerk identity confirmed; no duplicate Clerk user created (private comparison PASS; no private identifiers committed) | Clerk account-linking config; block app sign-up; support-assisted merge | Tyler+Cursor | MITIGATED (iPhone subscribed Google-origin test path); revisit if social returns to app |
| RISK-23 | **Client Trust repeatedly challenges the app WebView as a "new device"** | Med | Med | Recurring email-code challenges on reopen | Persist Clerk `__client`/device cookie in WebView (APP-027/028); verify APP-066 | Adjust Client Trust posture; document standard | Cursor+Tyler | OPEN |

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
Candidate A2 is the selected leading architecture based on current physical-device evidence (custom Swift live WKWebView inside Capacitor-generated iOS project). APP-021 formal close still open. Capacitor `server.url` is NOT approved production truth. Do not hard-code a production `server.url` dependency.

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
- *Evidence:* iOS POC results table (APP-017), recorded in "APP-008 Stage 1 + APP-070 architecture evidence — 2026-07-17", plus APP-069 private baseline comparison PASS (2026-07-18). Run against an existing subscribed Google-origin test account using email-code auth (DEC-018).
- *Status (v1.5.1 / 2026-07-18):* **PASS for short-cycle iPhone shell/auth/member-surface evidence.** **APP-010 COMPLETE** — intended email-code login posture; same existing Clerk identity confirmed; no duplicate Clerk user; relationship/member state intact. **APP-016 COMPLETE** — subscribed entitlement matched private baseline (formally verified, not UI-inferred only); expected Victory Room/account surfaces reached; member data preserved. **APP-069 COMPLETE** — Tyler privately verified the baseline comparison; comparison **passed**; **no private identifiers committed**. Identity continuity and no-duplicate-user result formally verified. Subscribed entitlement formally verified. Short-cycle force-close/reboot persistence (APP-011) and Stage 1 member surfaces (APP-009/013/014/017) remain PASS.
- *Limitations kept explicit:* **APP-065 remains IN PROGRESS** — 180-day elapsed persistence is **not** proven. **APP-015** external-link coverage remains open. Client Trust formal closure (APP-066) remains open unless separately evidenced. Android remains unstarted. Account deletion (APP-041) remains open. App Store readiness remains open.
- *Pass:* app shows **email-code login with no Google**; the Google-origin user signs in by email code and resolves to the **same existing Clerk identity** (no duplicate); entitlement + Victory Room + Current Goal + history + relationship state intact; **session persists after force-close**; Client Trust challenges only once for the new device (not repeatedly); session valid across multiple days; expiry degrades to a clean login (no blank/redirect loop); reaches VR; API call works; Vimeo plays.
- *Fail:* session doesn't persist, login unusable, duplicate user created, entitlement lost, or repeated new-device challenges.
- *Decides:* Tyler.
- *If fail:* try Clerk WebView config/guidance and account-linking; if still failing, reconsider architecture (native auth adaptation or PWA fallback).
- *Revise hours?* Yes if auth needs custom work.

**Checkpoint B — After Android POC (Phase 3).**
- *Evidence:* APP-020 table. *Pass/Fail/Decides:* as A for Android. *If fail:* Android-specific cookie config; consider iOS-first launch. *Revise hours?* Possibly.

**Checkpoint C — Before production app-shell (Phase 5).**
- *Evidence:* A+B passed; **Phase 4 production-shell architecture selected (DEC-020 resolved)**; DEC-004 confirmed; `summitt-mindset-mobile` repo created (APP-059). *Pass:* both platforms viable; architecture chosen with rationale; estimate confirmed/revised. *Fail:* unresolved auth or undecided architecture. *Decides:* Tyler. *If fail:* stay in POC or pivot. *Revise hours?* Yes if scope changed.

**Checkpoint D — Before Apple submission (Phase 15).**
- *Evidence:* TestFlight primary-flow pass; compliance checklist green — **in-app account deletion (APP-041) present and working**, **no in-app selling** (neutral inactive-membership state), App Privacy accurate, external-purchase/reader posture re-verified for the target storefront; **long-session lifetime raised and verified (APP-064/APP-065 complete — no 7-day forced re-login)**.
- *Pass:* flow works on TestFlight; policy posture defensible; deletion + no-in-app-selling confirmed; session-lifetime standard met. *Fail:* unresolved 3.1.1/4.2/deletion, missing in-app deletion, or still on 7-day lifetime. *Decides:* Tyler. *If fail:* add native feature (e.g., push) or adjust posture before submitting. *Revise hours?* Yes if adding push/IAP.

**Checkpoint E — Before Google submission (Phase 16).**
- *Evidence:* closed-track pass (**including the 12-tester/14-day requirement if APP-060 shows it applies**); Data Safety accurate; **in-app account deletion present + external web deletion resource available**; no outside-billing selling in V1; **long-session lifetime verified on Android (APP-065)**. *Pass:* flow works; billing + deletion + data-safety + session-lifetime posture compliant. *Fail:* billing/data-safety/deletion issues, unmet testing requirement, or still on 7-day lifetime. *Decides:* Tyler. *If fail:* fix before submit. *Revise hours?* Possibly.

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
**A polished iOS + Android native shell that renders the live `https://summittmindset.com` member experience**, opening to `/dashboard/victory-room`, built in a **separate repository** (`summitt-mindset-mobile`). **Candidate A2 is the selected leading architecture based on current physical-device evidence:** custom Swift `LiveShellViewController` hosting exactly one native `WKWebView` (`WKWebsiteDataStore.default()`) inside the Capacitor-generated iOS project, loading the live website directly — **not** CapBridge as the visible root, and **not** Capacitor `server.url`. Candidate B (bare native WKWebView/Android WebView) remains the fallback only if a later blocker appears. **APP-021 has not formally closed DEC-020** — Android Checkpoint B, estimate confirm/revise, and an explicit Phase-4 decision remain. React Native is explicitly rejected; website screens must not be duplicated. Stage 1 iPhone POC **PASS** (APP-008/APP-070) does **not** resolve Clerk long-session (DEC-021), account deletion (APP-041), Android, external-link policy, or App Store readiness. Confirm Apple's tolerance for a shell that renders a website (RISK-04) early; mitigate by keeping it members-only and adding a native feature if review demands it.

### VERIFIED CURRENT BASELINE
Next.js **16.0.5** App Router; **84 pages, 78 API routes, ~8 client pages** (overwhelmingly RSC); Clerk `@clerk/nextjs` ^6.35.5 (`layout.tsx`, `middleware.ts`); Victory Room at `/dashboard/victory-room` (`force-dynamic`, `currentUser()` gate → `/sign-in`); canonical post-login router `post-sign-in/page.tsx` → `MEMBER_APP_HOME_PATH` = `/dashboard/victory-room`; entitlement in Clerk `publicMetadata`; Stripe **web checkout** via full-page redirect; Supabase **service-role server-only** (`supabase-server.ts`); Vimeo **iframe**; SMS = Twilio + crons + huge `lib/` brain; `data-deletion` is **email-only**; domain `https://summittmindset.com`; mobile shell lives in separate `summitt-mindset-mobile` (Stage 1 POC evidence recorded 2026-07-17). Website repo still has **no** PWA/Capacitor/RN product code. (Baseline re-verified 2026-07-17 — see "Baseline verification — 2026-07-17"; Stage 1 architecture evidence in "APP-008 Stage 1 + APP-070 architecture evidence — 2026-07-17".)

### MOST-LIKELY TOTAL HOURS
**Working target shorthand remains ≈ 115 focused hours ("the 115-hour app"); current responsible range ≈ 130–175 focused hours** (best ~70, conservative ~258). Range widened again 2026-07-18 because APP-041 orchestration was newly sized at **≈ 24–40 focused hours** (obsolete 3h tracker estimate retired; see §6 Estimate revision 2026-07-18). Prior 115–150 band already treated deletion as Required but understated implementation depth. Engineering ~65–70h baseline + APP-041 band; Tyler setup/testing/store ~45–50h. **Excludes** store-review waiting, push, and native IAP; native IAP / native auth / any Apple-required major native feature are **separately-approved scope expansions**. Estimate must still be formally confirmed/revised at **APP-021** after Android path decision + remaining readiness work; Stage 1 did not close that revise step.

### HOURS BY PHASE
P0 ~3 · P1 ~3 · P2 ~6 · P3 ~4 · P4 ~1 · P5 ~10 · P6 ~10 · P7 ~3 · P8 ~6 · P9 ~6 · P10 ~10 · P11 ~9 · P12 ~5 · P13 ~5 · P14 ~5 · P15 ~5 · P16 ~4 · P17 ~7 · P18 ~3 (+~2 ongoing docs). ≈ **115h**.

### CRITICAL PATH
Master plan → policy verify → **iPhone Stage 1 POC PASS (Candidate A2 leading)** → **Clerk Pro + 180-day max lifetime (APP-062–064 COMPLETE)** → **APP-010 / APP-016 / APP-069 COMPLETE (private baseline PASS)** → **APP-065 elapsed-time validation (IN PROGRESS)** + **APP-041 IN PROGRESS** (APP-041A COMPLETE; next APP-041B planning) → formal APP-021 close → production harden / App Store → Android when iOS stable → launch.

### FIRST GO/NO-GO TEST
**Does the Clerk session persist in an iOS WKWebView after force-close/reopen and land the user in Victory Room without re-login?** (Checkpoint A / APP-011.) **Stage 1: PASS** (including full reboot). Production max lifetime now **180 days** (DEC-022); short-cycle post-change reopen PASS. Identity continuity, no-duplicate-user, and subscribed entitlement formally verified (APP-010 / APP-016 / APP-069 COMPLETE). Remaining: **APP-065 elapsed-time proof**, APP-015, Client Trust, account deletion, App Store posture, Android.

### BIGGEST TECHNICAL RISK
**APP-065 elapsed-time long-session validation + Android WebView unknown** (RISK-03 / U2). Short-cycle iOS persistence under A2 is evidence-backed; production Dashboard is configured for 180 days; **multi-month / full-window persistence remains unproven**. OAuth-in-WebView is out of V1 scope (DEC-018).

### BIGGEST STORE-REVIEW RISK
**Apple** — the combination of **4.2 minimum-functionality** (a shell that renders a website) and **3.1.1** (in-app path leading to Stripe web checkout). Both **REQUIRE CURRENT APPLE-DOC VERIFICATION** and may force adding push and/or reworking purchase messaging. **Account deletion (APP-041) remains Required before submission.**

### FIRST TEN TASK IDS
APP-000, APP-001, APP-002, APP-003, APP-004, APP-005, APP-006, APP-007, APP-008, APP-009.

### RECOMMENDED MASTER-PLAN FILE STRUCTURE
Two files: `docs/mobile-app-master-plan.md` (spine + task tracker + decision log + risk register + parking lot) and `docs/mobile-app-session-handoff.md` (append-only session log). Split decision log / risk register into their own files only if they outgrow a screen.

### EXACT NEXT CURSOR PROMPT
**APP-041B1**, **APP-041B2a**, **APP-041B2b**, **APP-041B3a**, **APP-041B3b**, **APP-041C1**, **APP-041C2**, **APP-041C3**, **APP-041D0**, **APP-041D1**, **APP-041E1**, and **APP-041E2** are **COMPLETE**. **APP-041E3a** is **IMPLEMENTED — PENDING REVIEW** (unreachable production-safe stage wiring; no route/cron). APP-041 / APP-041B remain **IN PROGRESS**. Exact next: **review E3a → discovery RPC/helper → admin read-only observability → disabled cron route only after those are reviewed**. Parallel: APP-065, APP-015, APP-066, APP-021 planning. Do **not** mark APP-041 COMPLETE. Do **not** claim end-to-end deletion works.

---

*End of master plan v1.5.11. Maintained per §14. Do not let it become aspirational fiction — update statuses and evidence every session.*
