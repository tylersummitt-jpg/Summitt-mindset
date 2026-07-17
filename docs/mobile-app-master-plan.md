# SUMMITT MINDSET — MOBILE APP MASTER PLAN
*Project-control document. Version 1.0. Created 2026-07-17. Read-only-audit basis.*

---

## STATUS BANNER

| Field | Value |
|---|---|
| Plan version | 1.0 |
| Last verified date | 2026-07-17 |
| Current phase | Phase 0 — Master-plan & repository baseline |
| Current assigned task IDs | APP-000, APP-001, APP-002 |
| Last completed task IDs | APP-000, APP-001, APP-002 |
| Current blocker | None |
| Exact next task | **APP-003** — Verify current Apple 4.2 wrapper stance (REQUIRES APPLE-DOC VERIFICATION) |

> **How to use this document:** This is the single durable control document for the mobile-app project. It is designed so a brand-new ChatGPT conversation or a fresh Cursor session can resume with zero prior context. Read this file plus `docs/mobile-app-session-handoff.md` before doing anything. Never mark a task COMPLETE without recorded evidence. Move every scope addition to the parking lot (§12). Do not touch the SMS system.

---

## 1. NORTH STAR

- **SMS is the primary product value.** The app must not modify, proxy, intercept, or endanger the Twilio SMS system (`src/app/api/cron/*`, `src/app/api/twilio/*`, `src/app/api/sms/*`, and the ~600-file SMS brain under `src/lib/`).
- **Victory Room is the secondary product value** and is the app's landing destination (`/dashboard/victory-room`).
- **The app exists to remove friction in reaching Victory Room** — tap icon, stay signed in, land in Victory Room. Nothing more in V1.
- **The website remains the product.** The live Next.js app at `https://summittmindset.com` is the single source of product truth.
- **The app is a doorway into the website**, not a second product.
- **One shared web experience must be preserved.** No duplicated screens in native code.
- **Website changes must automatically appear in the app.** This forces a *remote-URL* wrapper (the app loads the live site), not bundled web assets.
- **The goal is not a native redesign.** No Victory Room / Ask Pat / Film Room redesign as part of this project.

### PERMANENT MISSION STATEMENT (paste at the top of every future Cursor prompt)

> **Summitt Mindset Mobile App Mission:** We are wrapping the EXISTING live Next.js website (`https://summittmindset.com`) in a Capacitor iOS + Android shell that loads the production site remotely so web changes appear automatically without a new store submission. The app must let a member tap the icon, stay signed in via Clerk, and land directly in Victory Room (`/dashboard/victory-room`). We are NOT building native screens, NOT redesigning any product surface, NOT touching the SMS system, and NOT adding features just because mobile apps usually have them. The website remains the product; the app is a doorway. Every task must be justified by: "Is this required to let a member download the app, tap the icon, remain signed in, and enter the existing Victory Room safely and reliably?"

---

## 2. NON-NEGOTIABLE ARCHITECTURE PRINCIPLES

1. **One product codebase.** The Next.js app is the product. The Capacitor project is a thin shell (its own folder/repo) that points at the live site.
2. **Reuse the website directly** via a remote URL load (Capacitor `server.url`), so deploys to Vercel update the app instantly.
3. **Do not duplicate screens natively.** No native Victory Room, Ask Pat, Film Room, account, or auth screens.
4. **Keep server secrets and server-only code on the server.** Never move `supabaseServer` (`src/lib/supabase-server.ts`, `import "server-only"`, service-role key), Clerk secret, Stripe secret, OpenAI, or Twilio into the app bundle. The app only ever talks to the site over HTTPS.
5. **Do not disturb SMS.** No app task may edit `src/lib/*sms*`, `src/lib/v2-*`, `src/lib/v3-*`, `src/app/api/cron/*`, `src/app/api/twilio/*`, or `vercel.json` crons. SMS is off-limits.
6. **Avoid app-specific forks in website behavior unless absolutely necessary.** If unavoidable (e.g., "open straight to Victory Room, hide marketing chrome"), gate it behind a **detectable app signal** (custom WebView User-Agent suffix, e.g. `SummittApp/1.0`, or a `?app=1` entry param) so it is isolated and greppable. Prefer changing the app's *start URL* over changing site code.
7. **App-specific code must be isolated and easy to identify.** Any site-side adaptation must be tagged (e.g., a single `src/lib/app-webview.ts` helper + a clear comment banner) so it can be found and removed.
8. **Existing production website behavior must remain safe.** Default web/browser behavior is unchanged; app adaptations are additive and behind the app signal.
9. **Every implementation phase must end in a testable state** with recorded evidence.
10. **No phase may begin until the preceding phase's exit criteria are satisfied** (see §17 checkpoints).
11. **No feature is added merely because mobile apps commonly have it.** Push, offline, widgets, biometrics, native nav, IAP → parking lot (§12) unless a store forces it.

---

## 3. V1 DEFINITION

### Required for V1
- iOS + Android Capacitor shell that **loads `https://summittmindset.com` (or an `app.` alias) remotely**.
- Launches to **Victory Room** (`/dashboard/victory-room`); unauthenticated users hit the existing `/sign-in` → `/post-sign-in` flow and end at Victory Room.
- **Clerk session persists** across force-close/reopen (no repeated logins) to the agreed standard (see Checkpoint A pass criteria).
- **Entitlement recognized** unchanged (Clerk `publicMetadata.summittSubscribed`/`summittPlan`).
- Core reused surfaces load and function: **Victory Room (primary), Ask Pat, Film Room/Vimeo, Account** (`/user`).
- App icon + splash screen + correct app name.
- Safe-area/status-bar handling; Android hardware back button behaves sanely.
- Basic loading + network-error state so a failed load isn't a white screen.
- Crash reporting + minimal analytics (launch, login success, reached-Victory-Room).
- Store listings (privacy nutrition labels / Play data-safety) that are **accurate** to the SMS/AI/journal data flows.

### Required only if Apple or Google demands it
- **In-app account deletion** action (current `data-deletion` page is email-request only — Apple usually requires an in-app deletion path). *Verify current Apple policy.*
- **Sign in with Apple** (only if Clerk exposes third-party social logins such as Google in the sign-in UI). *Verify Clerk dashboard + current Apple policy.*
- **Store-compliant handling of web checkout** — messaging changes, hiding/adjusting the subscribe path inside the app, or (worst case) native IAP. *Verify current Apple 3.1.1 / external-purchase-link + Google Play Billing policy.*
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

**U5 — May the wrapper safely load the hosted production site remotely?**
- *Why:* The "auto-update" mandate requires `server.url` → live site. This maximizes reuse but increases Apple 4.2 "just a website" risk.
- *Test:* Phase 1 (policy) + Phase 2 (technical). *Pass:* loads reliably; policy acceptable with native additions. *Backup:* bundle a minimal shell + still load remote content in a WebView view; add native features. Hours at risk: 4–12.

**U6 — Cookies & middleware inside the wrapper (credentialed same-origin fetch).**
- *Why:* Client fetches (`ask-pat-client.tsx` uses `fetch("/api/ask-pat")`; subscribe uses `credentials: "include"`). WebView cookie policy must allow these.
- *Test:* Phase 2 (Ask Pat call). *Pass:* authenticated API calls succeed. Hours at risk: 3–8.

**U7 — Apple minimum-functionality rejection (4.2). REQUIRES APPLE-DOC VERIFICATION.**
- *Why:* Remote-URL wrapper of a website is a known rejection reason.
- *Test:* Phase 1 research; real test at Phase 15.
- *Backup:* add push/native features; emphasize members-only utility. Hours at risk: 8–40 (includes possible push add).

**U8 — Apple subscription / external-checkout policy (3.1.1). REQUIRES APPLE-DOC VERIFICATION.**
- *Why:* In-app path leads to Stripe web checkout (`window.location.href` to Stripe). Selling in-app violates 3.1.1.
- *Test:* Phase 1 research + Phase 10 implementation. *Pass:* app doesn't sell in-app; entitlement-on-web recognized; messaging compliant. *Backup:* reader-app posture; native IAP as last resort (40h). Hours at risk: 6–40.

**U9 — Google Play subscription policy. REQUIRES GOOGLE-DOC VERIFICATION.** Similar to U8; Play Billing rules differ. Hours at risk: 4–20.

**U10 — Web-purchased subscription access inside app.** Structurally fine (entitlement in Clerk metadata via webhook). Verify in Phase 2 with a subscribed test account. Hours at risk: 1–3.

**U11 — Account deletion compliance. REQUIRES APPLE-DOC VERIFICATION.** Current page is email-only (`data-deletion/page.tsx`). Likely need in-app deletion. Hours at risk: 3–12.

**U12 — Sign in with Apple requirement.** Conditional on U3. Hours at risk: 0–10.

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

---

## 7. PHASED IMPLEMENTATION PLAN

*Sequence follows Phase 0–18. Each phase is 3–15 focused hours (some checkpoints shorter). Production website is NOT at risk in any phase unless explicitly noted; the shell loads the live site read-only and app-side adaptations are gated behind an app signal.*

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
- **Goal:** Confirm current Apple/Google/Clerk/Stripe policies for a remote-URL wrapper with web checkout.
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
- **Non-scope:** Icons, splash, store setup, polish, Android. **This POC is disposable — it must NOT become production architecture.**
- **Repo areas:** none in the website; a *separate* throwaway Capacitor project outside the Next.js repo.
- **Accounts:** Apple ID for local device run (free provisioning ok); a test Clerk user (subscribed).
- **Risks:** Clerk WebView failure (U1) — the whole go/no-go.
- **Steps:** create disposable Capacitor app → `server.url = https://summittmindset.com/dashboard/victory-room` → run on device → execute the test checklist → record every result.
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
- **Goal:** Formal **go/no-go** on the Capacitor remote-URL approach based on POC evidence (Checkpoints A+B).
- **Scope:** decide: proceed / adapt auth / reconsider architecture. Record decision + any hour re-estimate.
- **Non-scope:** building.
- **DoD:** decision logged with rationale; estimate confirmed or revised (with reason).
- **Website at risk?** No.
- **Before next phase:** GO recorded.

### Phase 5 — Production app-shell foundation (~10h)
- **Goal:** Create the durable Capacitor project (iOS + Android) that loads production, with icons/splash placeholders, status bar, safe areas, loading state.
- **Why now:** Foundation for all further work, only after POC proves feasibility.
- **Scope:** real Capacitor project (own repo/folder); `server.url` to production (or `app.summittmindset.com`); app name/bundle IDs; status-bar + safe-area handling; loading indicator; Android back-button config.
- **Non-scope:** auth deep work, store submission, deep links, analytics.
- **Repo areas:** new Capacitor project; possibly a tiny `src/lib/app-webview.ts` signal helper (app-gated) — only if needed.
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

| ID | Phase | Task | Status | Est h | Act h | Dependencies | Evidence | Notes |
|---|---|---|---|--:|--:|---|---|---|
| APP-000 | 0 | Create `docs/mobile-app-master-plan.md` from the approved plan | COMPLETE | 1 | NOT RECORDED | — | `docs/mobile-app-master-plan.md` created with sections 1–19 + status banner + baseline verification | Done 2026-07-17 |
| APP-001 | 0 | Re-verify baseline table vs current repo; note diffs | COMPLETE | 1 | NOT RECORDED | APP-000 | "Baseline verification — 2026-07-17" section; 14/14 facts confirmed, no material discrepancy | Clean tree at `21aa2b4` |
| APP-002 | 0 | Initialize decision log + risk register + parking lot + handoff | COMPLETE | 1 | NOT RECORDED | APP-000 | §10 decision log, §11 risk register, §12 parking lot embedded; `docs/mobile-app-session-handoff.md` created | Single-master-file + handoff approach |
| APP-003 | 1 | Verify Apple 4.2 wrapper stance (current) | NOT STARTED | 1 | | APP-002 | | REQUIRES APPLE-DOC |
| APP-004 | 1 | Verify Apple 3.1.1 / external-purchase-link + reader rules | NOT STARTED | 1 | | APP-002 | | REQUIRES APPLE-DOC |
| APP-005 | 1 | Verify Apple account-deletion + Sign in with Apple triggers | NOT STARTED | 0.5 | | APP-002 | | REQUIRES APPLE-DOC |
| APP-006 | 1 | Verify Google Play Billing + new-account closed-test rules | NOT STARTED | 0.5 | | APP-002 | | REQUIRES GOOGLE-DOC |
| APP-007 | 1 | Check Clerk dashboard: which login methods are enabled (email/social) | NOT STARTED | 0.5 | | — | | Tyler + Clerk dashboard |
| APP-008 | 2 | Create throwaway Capacitor iOS shell (disposable) | NOT STARTED | 1.5 | | APP-004,APP-007 | | Not production |
| APP-009 | 2 | Load production URL `/dashboard/victory-room` on iOS device | NOT STARTED | 0.5 | | APP-008 | | |
| APP-010 | 2 | Test Clerk email login on iOS | NOT STARTED | 0.5 | | APP-009 | | U3 |
| APP-011 | 2 | Test session persistence after iOS force-close/reopen | NOT STARTED | 0.5 | | APP-010 | | U1 (critical) |
| APP-012 | 2 | Test reaching Victory Room authed on iOS | NOT STARTED | 0.5 | | APP-011 | | |
| APP-013 | 2 | Test authenticated API call (Ask Pat) on iOS | NOT STARTED | 0.5 | | APP-012 | | U6 |
| APP-014 | 2 | Test Vimeo playback on iOS | NOT STARTED | 0.5 | | APP-012 | | U13 |
| APP-015 | 2 | Test external-link behavior on iOS | NOT STARTED | 0.5 | | APP-012 | | U15 |
| APP-016 | 2 | Test subscribed-account entitlement recognized on iOS | NOT STARTED | 0.5 | | APP-012 | | U10 |
| APP-017 | 2 | Record iOS POC results table + captures | NOT STARTED | 0.5 | | APP-009,APP-010,APP-011,APP-012,APP-013,APP-014,APP-015,APP-016 | | Feeds Checkpoint A |
| APP-018 | 3 | Create throwaway Android shell + run emulator/device | NOT STARTED | 1.5 | | APP-017 | | |
| APP-019 | 3 | Repeat critical checklist on Android (login/persist/VR/API/Vimeo) | NOT STARTED | 2 | | APP-018 | | U2 |
| APP-020 | 3 | Record Android POC results table | NOT STARTED | 0.5 | | APP-019 | | Feeds Checkpoint B |
| APP-021 | 4 | Architecture go/no-go decision + estimate confirm/revise | NOT STARTED | 1 | | APP-017,APP-020 | | Checkpoint (§17) |
| APP-022 | 5 | Create production Capacitor project (iOS+Android), bundle IDs | NOT STARTED | 3 | | APP-021 | | |
| APP-023 | 5 | Configure `server.url` to production/app subdomain | NOT STARTED | 1 | | APP-022 | | |
| APP-024 | 5 | Status bar + safe-area handling both platforms | NOT STARTED | 2 | | APP-023 | | |
| APP-025 | 5 | Android hardware back-button behavior | NOT STARTED | 1 | | APP-023 | | |
| APP-026 | 5 | Loading indicator for remote load | NOT STARTED | 1 | | APP-023 | | |
| APP-027 | 6 | WebView cookie/storage persistence config (iOS) | NOT STARTED | 3 | | APP-023 | | U1 |
| APP-028 | 6 | WebView cookie/storage persistence config (Android) | NOT STARTED | 2 | | APP-023 | | U2 |
| APP-029 | 6 | OAuth/social return handling (if social enabled) | NOT STARTED | 3 | | APP-007,APP-027 | | U3; may be DEFERRED if email-only |
| APP-030 | 6 | Verify no redirect loop `/sign-in`→`/post-sign-in`→VR | NOT STARTED | 2 | | APP-027 | | U4 |
| APP-031 | 7 | Set cold-launch start to Victory Room | NOT STARTED | 1 | | APP-030 | | |
| APP-032 | 7 | Verify unauth cold-launch returns to VR post-login | NOT STARTED | 2 | | APP-031 | | |
| APP-033 | 8 | Victory Room full in-app compatibility test | NOT STARTED | 2.5 | | APP-031 | | Highest attention |
| APP-034 | 8 | Ask Pat in-app test | NOT STARTED | 1 | | APP-031 | | |
| APP-035 | 8 | Film Room + Vimeo in-app test | NOT STARTED | 1.5 | | APP-031 | | |
| APP-036 | 8 | Account/`/user` + manage-membership in-app test | NOT STARTED | 1 | | APP-031 | | |
| APP-037 | 9 | Define + implement in-app vs external link policy | NOT STARTED | 3 | | APP-031 | | U15 |
| APP-038 | 9 | Handle `target="_blank"` links (no blank dead-ends) | NOT STARTED | 1.5 | | APP-037 | | onboarding/sms + marketing |
| APP-039 | 9 | Deep links (SMS/marketing → app) | NOT STARTED | 1.5 | | APP-037 | | DEFERRABLE |
| APP-040 | 10 | Store-compliant subscribe/purchase messaging in app | NOT STARTED | 4 | | APP-004,APP-021 | | U8/U9 |
| APP-041 | 10 | In-app account-deletion action (if required) | NOT STARTED | 3 | | APP-005 | | Keep away from SMS tables |
| APP-042 | 10 | Draft accurate privacy/data-safety content | NOT STARTED | 2 | | APP-005,APP-006 | | Tyler + forms |
| APP-043 | 11 | Integrate crash reporting in shell | NOT STARTED | 2.5 | | APP-022 | | |
| APP-044 | 11 | Minimal analytics events (launch/login/VR/error) | NOT STARTED | 2 | | APP-043 | | |
| APP-045 | 11 | Offline/network-error screen + load timeout | NOT STARTED | 3 | | APP-026 | | |
| APP-046 | 12 | Generate app icon set (both platforms) | NOT STARTED | 2 | | APP-022 | | |
| APP-047 | 12 | Generate splash screens | NOT STARTED | 1.5 | | APP-022 | | |
| APP-048 | 12 | Capture store screenshots per device size | NOT STARTED | 2 | | APP-033 | | Tyler |
| APP-049 | 13 | Apple Developer enrollment + signing/provisioning | NOT STARTED | 2.5 | | APP-021 | | Tyler + Apple |
| APP-050 | 13 | iOS TestFlight build + internal test | NOT STARTED | 2.5 | | APP-049,APP-046 | | |
| APP-051 | 14 | Play Console setup + signing | NOT STARTED | 2 | | APP-021 | | Tyler + Google |
| APP-052 | 14 | Android closed-track build + test | NOT STARTED | 3 | | APP-051,APP-046 | | Possible 14-day wait |
| APP-053 | 15 | Apple store listing + App Privacy + review notes | NOT STARTED | 3 | | APP-042,APP-048,APP-050 | | |
| APP-054 | 15 | Submit to App Store | NOT STARTED | 0.5 | | APP-053 | | Checkpoint D first |
| APP-055 | 16 | Play listing + data-safety + submit | NOT STARTED | 3.5 | | APP-042,APP-048,APP-052 | | Checkpoint E first |
| APP-056 | 17 | Respond to review feedback (buffer) | NOT STARTED | 7 | | APP-054,APP-055 | | |
| APP-057 | 18 | Define post-launch monitoring + web-deploy smoke check | NOT STARTED | 3 | | APP-056 | | U17 |
| APP-058 | all | Maintain master plan + handoff each session | NOT STARTED | 3 | | APP-000 | | ongoing |

---

## 9. DEPENDENCY MAP

- **Critical path:** APP-000 → APP-003/004/007 → APP-008..017 (iOS POC) → APP-021 (go/no-go) → APP-022/023 (shell) → APP-027/028/030 (auth+session) → APP-031/032 (VR routing) → APP-040 (purchase compliance) → APP-049/050 (TestFlight) / APP-051/052 (closed track) → APP-053/054 & APP-055 (submit) → APP-056 (review) → launch.
- **Parallelizable:** Android POC (APP-018..020) alongside finishing iOS notes; icons/splash (APP-046/047) alongside auth; analytics/crash (APP-043/044) alongside member-surface testing; store copy/screenshots drafting (APP-042/048) alongside compliance.
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
| DEC-004 | Use Capacitor wrapper, not React Native | Reuse 100% of RSC UI; RN = full rewrite | 2026-07-17 | ACTIVE | POC fails (Checkpoint A/B) |
| DEC-005 | Load production **remotely** (`server.url`), not bundled | "Web changes appear automatically" mandate | 2026-07-17 | ACTIVE | Apple rejects remote-only load |
| DEC-006 | One shared website codebase; no native screens | Avoid second product | 2026-07-17 | ACTIVE | — |
| DEC-007 | Push notifications deferred unless required for approval | Not needed for core flow; SMS covers it | 2026-07-17 | ACTIVE | Apple 4.2 rejection requires it |
| DEC-008 | Native IAP deferred unless policy forces it | Web + SMS conversion already works; entitlement in Clerk | 2026-07-17 | ACTIVE | Apple 3.1.1 rejection |
| DEC-009 | No product redesign during app project | Scope control | 2026-07-17 | ACTIVE | — |
| DEC-010 | Future web deploys should update the app automatically | Startup velocity | 2026-07-17 | ACTIVE | — |
| DEC-011 | App-specific site behavior only behind a detectable app signal | Isolation/greppability | 2026-07-17 | ACTIVE | — |
| DEC-012 | Master plan lives in one file + append-only handoff log | Easiest for Cursor/ChatGPT continuity | 2026-07-17 | ACTIVE | Files grow unwieldy |

---

## 11. RISK REGISTER

| Risk ID | Risk | Prob | Impact | Early warning | Mitigation | Fallback | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| RISK-01 | Clerk session fails in WebView | Med | Critical | POC login/persist fails | WebView cookie config; Clerk WebView guidance | Native auth adaptation (major) | Tyler+Cursor | OPEN |
| RISK-02 | OAuth callback fails in WebView | Med | High | Social login dead-ends in POC | In-app-browser return handling; email-only in app | Hide social in app | Tyler+Cursor | OPEN |
| RISK-03 | Repeated sign-ins / session expiry | Med | High | Users re-login on reopen | Token refresh + persistence tuning | Extend session; document standard | Cursor | OPEN |
| RISK-04 | Apple 4.2 minimum-functionality rejection | Med-High | High | Reviewer cites "just a website" | Add native features (push), members-only framing | Add push; richer native shell | Tyler | OPEN |
| RISK-05 | Apple 3.1.1 payment rejection | Med | High | Reviewer flags web checkout | Reader-app posture; no in-app selling | Native IAP (+30–40h) | Tyler | OPEN |
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

**Repository state** — Current branch; latest commit hash; `git status --short` output; staged? committed? pushed?; **explicit verdict: is the full worktree safe for `git add .`?**; list untracked files; any env/config changes not stored in git (and where they live).

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

[CURRENT PHASE]
Phase <N> — <name>

[TASK IDS ASSIGNED]
Complete ONLY: <APP-0xx>[, APP-0yy]. Do not advance into any later phase or unlisted task.

[ALLOWED FILES/SYSTEMS]
<explicit list — e.g., the Capacitor project only; or a single app-gated helper>

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
1) What you changed (files) 2) Test results 3) Task status updates 4) Production-safety verdict 5) `git add .` safety verdict (safe/unsafe + why) 6) Exact next task ID + action.
```

---

## 16. FUTURE CHATGPT HANDOFF TEMPLATE

```
SUMMITT MINDSET APP — HANDOFF
Mission: Capacitor iOS+Android shell loading live https://summittmindset.com remotely; tap icon → stay signed in (Clerk) → land in Victory Room (/dashboard/victory-room). Website stays the product; web changes auto-appear; do not touch SMS; no native redesign.
Architecture: Capacitor remote-URL wrapper (server.url = production). Next.js 16 App Router; Clerk auth; entitlement in Clerk publicMetadata; Stripe web checkout; Supabase server-only; Vimeo iframe.
Current phase: <N — name>
Completed task IDs: <list>
Current task: <APP-0xx — one line>
Blockers: <list or none>
Repo state: branch <x>, commit <hash>, git status <clean/dirty>, add-all safe? <yes/no>
Last test results: <key PASS/FAIL>
Store status: Apple <status>, Google <status>, TestFlight <status>
Exact next step: <one sentence>
Master plan file: docs/mobile-app-master-plan.md (+ session-handoff.md)
Warnings: do not modify SMS/crons/twilio/supabaseServer/secrets; web deploys affect the app live.
Deferred: push, native IAP, deep links, offline, redesigns (see parking lot).
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
- *Evidence:* A+B passed; DEC-004/005 confirmed. *Pass:* both platforms viable; estimate confirmed. *Fail:* unresolved auth. *Decides:* Tyler. *If fail:* stay in POC or pivot. *Revise hours?* Yes if scope changed.

**Checkpoint D — Before Apple submission (Phase 15).**
- *Evidence:* TestFlight primary-flow pass; compliance checklist (purchase messaging, account deletion, privacy) green.
- *Pass:* flow works on TestFlight; policy posture defensible. *Fail:* unresolved 3.1.1/4.2/deletion. *Decides:* Tyler. *If fail:* add native feature or adjust posture before submitting. *Revise hours?* Yes if adding push/IAP.

**Checkpoint E — Before Google submission (Phase 16).**
- *Evidence:* closed-track pass; data-safety accurate. *Pass:* flow works; billing posture compliant. *Fail:* billing/data-safety issues. *Decides:* Tyler. *If fail:* fix before submit. *Revise hours?* Possibly.

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
**Capacitor wrapper (iOS + Android) that loads the live `https://summittmindset.com` remotely via `server.url`**, opening to `/dashboard/victory-room`. Capacitor remains the best fit versus alternatives (plain WKWebView / Trusted Web Activity) because it satisfies the "web changes appear automatically" mandate while still giving a clean native plugin path for the few things you may later need (status bar, splash, deep links, push) without building a second product. React Native is explicitly rejected (it would discard the entire server-rendered UI). Confirm Apple's tolerance for a remote-only wrapper (RISK-04) early; mitigate by keeping it members-only and adding a native feature if review demands it.

### VERIFIED CURRENT BASELINE
Next.js **16.0.5** App Router; **84 pages, 78 API routes, ~8 client pages** (overwhelmingly RSC); Clerk `@clerk/nextjs` ^6.35.5 (`layout.tsx`, `middleware.ts`); Victory Room at `/dashboard/victory-room` (`force-dynamic`, `currentUser()` gate → `/sign-in`); canonical post-login router `post-sign-in/page.tsx` → `MEMBER_APP_HOME_PATH` = `/dashboard/victory-room`; entitlement in Clerk `publicMetadata`; Stripe **web checkout** via full-page redirect; Supabase **service-role server-only** (`supabase-server.ts`); Vimeo **iframe**; SMS = Twilio + crons + huge `lib/` brain; `data-deletion` is **email-only**; domain `https://summittmindset.com`; **no PWA, no Capacitor/RN, no app icons**. (Re-verified 2026-07-17 — see "Baseline verification — 2026-07-17".)

### MOST-LIKELY TOTAL HOURS
**~115 focused hours** (best ~70, conservative ~258). Engineering ~65–70h; Tyler setup/testing/store ~45–50h. **Excludes** store-review waiting, push, and native IAP.

### HOURS BY PHASE
P0 ~3 · P1 ~3 · P2 ~6 · P3 ~4 · P4 ~1 · P5 ~10 · P6 ~10 · P7 ~3 · P8 ~6 · P9 ~6 · P10 ~10 · P11 ~9 · P12 ~5 · P13 ~5 · P14 ~5 · P15 ~5 · P16 ~4 · P17 ~7 · P18 ~3 (+~2 ongoing docs). ≈ **115h**.

### CRITICAL PATH
Master plan → policy verify → **iPhone POC (Clerk session persistence)** → go/no-go → shell → auth/session hardening → direct-to-VR routing → purchase-compliance → TestFlight/closed-track → submissions → review responses → launch.

### FIRST GO/NO-GO TEST
**Does the Clerk session persist in an iOS WKWebView after force-close/reopen and land the user in Victory Room without re-login?** (Checkpoint A / APP-011.) Everything depends on this; test it before any production build.

### BIGGEST TECHNICAL RISK
**Clerk session persistence + OAuth inside the WebView** (RISK-01/RISK-02). If it fails, the "stay signed in" value evaporates and hours could roughly double.

### BIGGEST STORE-REVIEW RISK
**Apple** — the combination of **4.2 minimum-functionality** (remote-URL wrapper) and **3.1.1** (in-app path leading to Stripe web checkout). Both **REQUIRE CURRENT APPLE-DOC VERIFICATION** and may force adding push and/or reworking purchase messaging.

### FIRST TEN TASK IDS
APP-000, APP-001, APP-002, APP-003, APP-004, APP-005, APP-006, APP-007, APP-008, APP-009.

### RECOMMENDED MASTER-PLAN FILE STRUCTURE
Two files: `docs/mobile-app-master-plan.md` (spine + task tracker + decision log + risk register + parking lot) and `docs/mobile-app-session-handoff.md` (append-only session log). Split decision log / risk register into their own files only if they outgrow a screen.

### EXACT NEXT CURSOR PROMPT
The next controlled task is **APP-003** (Phase 1 — verify current Apple 4.2 wrapper stance). It is a research/documentation task (REQUIRES APPLE-DOC VERIFICATION) and must be run as its own controlled prompt; it does not begin Capacitor implementation.

---

*End of master plan v1.0. Maintained per §14. Do not let it become aspirational fiction — update statuses and evidence every session.*
