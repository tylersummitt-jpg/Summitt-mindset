This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment variables

### Meta Pixel (Phase 1 — marketing routes only)

- **`NEXT_PUBLIC_META_PIXEL_ID`** — optional. When set to a **numeric** Meta Pixel ID, the [Meta Pixel](https://developers.facebook.com/docs/meta-pixel) loads via `MetaPixelRoot`. If unset or non-numeric, all Meta tracking is a no-op.

- **`NEXT_PUBLIC_META_PIXEL_ENABLED`** — optional. Set to **`false`** to disable the pixel even when an ID is present (useful for local/preview). Defaults to enabled when a valid ID exists.

**Behavior:**

- **PageView** fires only on public marketing routes (home, subscribe, coach kit, SEO pages, auth pages, policies). Authenticated product surfaces (`/dashboard`, `/onboarding`, Victory Room, Ask Pat, Film Room, etc.) are **blocked**.
- **Native app (iOS or Android UA markers):** when the request User-Agent contains exact `SummittMindsetiOS` or `SummittMindsetAndroid`, `MetaPixelRoot` is **not rendered** (no `fbevents.js` / `fbq`). Website/browser Pixel unchanged. Detection is via the canonical `detectSummittMindsetPlatform` helper (`none` | `ios` | `android`).
- Sensitive URLs (`/subscribe/success`, `/pulse`, `/winback`, `/internal`, …) and denylisted query keys (`session_id`, `t`, `token`, …) never receive PageView.
- Custom/coach events use an allowlisted payload only — never identity, goal, journal, SMS, proof, email, phone, tokens, or Stripe/session IDs.
- **Not included yet:** Purchase, Subscribe, StartTrial, or Conversions API (server-side).

**Local / preview / production:** Prefer leaving `NEXT_PUBLIC_META_PIXEL_ID` unset locally; use a test pixel or `NEXT_PUBLIC_META_PIXEL_ENABLED=false` on preview. Production: set the live pixel ID in Vercel.

**Limitation:** The browser may still attach the full document URL to some Meta events unless `event_source_url` override is honored by `fbevents.js`; sensitive routes are blocked entirely so tokenized query strings are not tracked via PageView.

- **`COACH_ATTRIBUTION_COOKIE_ENABLED`** — set to **`true`** in production so coach landing-page visits can set the attribution cookie before auth (used with `/post-sign-in` sync).

### Coach Leadership Kit notifications (shipping)

Uses [Resend](https://resend.com) when configured. **`notifyCoachKitSubmitted`** runs after a coach saves their kit address (`/api/coach/shipping`). **`notifyCoachSubscribedInternal`** runs from the Stripe webhook when a coach completes Checkout (`summittAcquisition === coach`). If env is missing, the flow still succeeds; email is skipped with a warning in logs.

- **`RESEND_API_KEY`** — required to send notifications.
- **`COACH_KIT_NOTIFY_EMAIL`** — recipient for internal alerts (recommended: **`tyler@summittmindset.com`**).
- **`COACH_KIT_NOTIFY_FROM`** — optional sender; defaults to **`challenge@summittmindset.com`**.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
