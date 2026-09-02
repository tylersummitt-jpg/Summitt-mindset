This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Environment variables

### Meta Pixel and Conversions API

- **`NEXT_PUBLIC_META_PIXEL_ID`** — optional. When set to a **numeric** Meta Pixel ID, the [Meta Pixel](https://developers.facebook.com/docs/meta-pixel) loads via `MetaPixelRoot`. The same ID is the Conversions API dataset. If unset or non-numeric, browser Pixel and CAPI are a no-op.

- **`NEXT_PUBLIC_META_PIXEL_ENABLED`** — optional. Set to **`false`** to disable the pixel (and CAPI) even when an ID is present (useful for local/preview). Defaults to enabled when a valid ID exists.

- **`META_CAPI_ACCESS_TOKEN`** — server-only. Required for Meta Conversions API StartTrial / Subscribe. Never `NEXT_PUBLIC_`. If missing, CAPI skips; Stripe membership is unchanged.

**Behavior:**

- **PageView (browser only)** fires on selected public marketing routes (home, about, daily-practice, previews, subscribe, sign-in/sign-up, coach kit, Pat Summitt SEO pages, challenge). Legal/support pages, member product, admin, and `/subscribe/success` are **blocked**.
- **StartTrial (server CAPI only)** fires from the Stripe webhook after `checkout.session.completed` membership projection succeeds and the subscription is actually trialing. Not on CTA, signup, subscribe view, or Checkout session creation. Apple IAP is excluded.
- **Subscribe (server CAPI only)** fires from the Stripe webhook after `invoice.paid` membership projection succeeds, only for the **first** paid invoice (`amount_paid > 0`, USD) on that subscription. Trial $0 invoices, renewals, manual invoices, and Apple IAP do not fire Subscribe.
- **Native app (iOS or Android UA markers):** when the request User-Agent contains exact `SummittMindsetiOS` or `SummittMindsetAndroid`, `MetaPixelRoot` is **not rendered** (no `fbevents.js` / `fbq`). Website/browser Pixel unchanged. Detection is via the canonical `detectSummittMindsetPlatform` helper (`none` | `ios` | `android`).
- Sensitive URLs (`/subscribe/success`, `/pulse`, `/winback`, `/internal`, …) and denylisted query keys (`session_id`, `t`, `token`, …) never receive PageView.
- Custom/coach events use an allowlisted payload only — never identity, goal, journal, SMS, proof, email, phone, tokens, or Stripe/session IDs. Coach browser events (`coach_cta_clicked`, `coach_how_it_works_nav`, `coach_shipping_submitted`, coach `InitiateCheckout`) stay on the same Pixel.

**Local / preview / production:** Prefer leaving `NEXT_PUBLIC_META_PIXEL_ID` unset locally; use a test pixel or `NEXT_PUBLIC_META_PIXEL_ENABLED=false` on preview. Production: set the live pixel ID and CAPI token in Vercel. Do not put tokens in this repo.

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
