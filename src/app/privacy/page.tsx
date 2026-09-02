import type { Metadata } from "next";
import Link from "next/link";
import {
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
} from "@/lib/legal/account-deletion-public-availability";
import { PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE } from "@/lib/legal/public-legal-effective-dates";

export const metadata: Metadata = {
  title: "Privacy Policy | Summitt Mindset",
  description:
    "How Summitt Mindset collects, uses, shares, and deletes personal information.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-4 py-10 sm:px-6 sm:py-14">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Effective / last updated:{" "}
          {PRIVACY_AND_DATA_DELETION_PUBLIC_EFFECTIVE_DATE}
        </p>
      </header>

      <section className="space-y-4 text-base leading-7 text-[var(--muted)]">
        <p>
          Summitt Mindset helps members hold one serious commitment with SMS
          accountability, optional in-app depth, and a record of real choices.
          This Privacy Policy explains what information we collect, how we use
          it, how we share it with service providers, and how account deletion
          works. The same product experience may be used in a browser or inside
          the Summitt Mindset iOS and Android apps, which load the live website.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">1. Information we collect</h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>
            <strong className="font-medium text-[var(--text)]">
              Account and authentication information
            </strong>
            — such as email address, name or preferred name, internal account or
            user ID, sign-in identity, and account or subscription status managed
            through our authentication and membership systems.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              Phone number and SMS information
            </strong>
            — phone number, opt-in/consent status, inbound and outbound message
            content, delivery metadata, timestamps, message status, and
            STOP/START (or equivalent) messaging preferences when you use
            Summitt Mindset texting.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              Purchase and subscription information
            </strong>
            — membership and entitlement status, plan information (such as
            monthly or annual), trial or cancellation-related status, related
            Stripe customer or subscription identifiers, and other
            purchase/subscription records needed to provide paid access. Payment
            credentials such as full card or bank-account numbers are processed
            by Stripe and are not stored in Summitt Mindset’s application
            databases.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              Leadership Kit shipping address
            </strong>
            — when an eligible coach member chooses to submit a kit shipping
            address, we may collect recipient name, street address, city,
            state/province, postal or ZIP code, and country for fulfillment. Not
            every member is asked for or required to provide a physical address.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              App, coaching, and product content
            </strong>
            — identity statements, goals and commitments, journals, reflections,
            check-ins, Ask Pat questions and responses, coaching replies,
            feedback, preferences (such as timezone or delivery timing),
            completion and feature-use activity, and other text or choices you
            submit. This may include Money/Finances focus-area selections,
            commitments about budgets, spending, savings, expenses, invoices, or
            business cash position, and cancellation feedback such as indicating
            that membership is a financial stretch. Older profile fields related
            to financial goals may still be present for some accounts and, if
            present, may be read into coaching context; we do not claim that
            those legacy values exist for every user.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              Support communications
            </strong>
            — messages you send to support, and related account details needed to
            respond.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              Technical, security, performance, and approximate location
              information
            </strong>
            — limited operational records created when you use the website or
            native apps, such as IP address, IP-derived country or other
            approximate (coarse) location, browser or WebView user-agent string,
            request host, URL or path, query parameters, HTTP method and status,
            request or session identifiers, hosting-region or deployment
            information, performance timing, latency, resource usage, cache
            results, limited console or error information, and firewall or
            abuse-prevention outcomes. These records help us host, secure,
            debug, and operate the service. They are not used by Summitt Mindset
            for cross-company advertising tracking.
          </li>
          <li>
            <strong className="font-medium text-[var(--text)]">
              Website analytics and marketing measurement
            </strong>
            — on the normal Summitt Mindset website (browser), we may use Meta
            Pixel and related tools to measure page views, selected marketing
            interactions, and advertising performance. See section 5. Meta Pixel
            is not loaded in the Summitt Mindset iOS app or the Summitt Mindset
            Android app.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">2. How we use information</h2>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>Create, secure, and administer your account</li>
          <li>Provide membership, billing, entitlement, and access control</li>
          <li>
            Deliver SMS and related coaching communications you have opted into
          </li>
          <li>
            Personalize coaching, commitment context, and optional in-app depth
            (including goal and affordability-related coaching signals when you
            provide them)
          </li>
          <li>Operate AI-assisted coaching features where enabled</li>
          <li>
            Fulfill optional Leadership Kit shipping when an eligible address is
            submitted
          </li>
          <li>
            Host the service; maintain reliability, availability, performance,
            and scalability; debug issues; and protect against fraud, abuse, or
            security threats
          </li>
          <li>Respond to support requests</li>
          <li>Meet legal, tax, dispute, and compliance obligations</li>
          <li>
            On the website, measure usage and marketing performance and evaluate
            selected marketing funnel actions to improve advertising
            effectiveness (including via Meta Pixel where configured)
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">3. SMS privacy and consent</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          If you opt into SMS coaching, you consent to receive recurring messages
          from Summitt Mindset related to your membership. Message frequency
          varies. Message and data rates may apply. Reply{" "}
          <strong className="text-[var(--text)]">STOP</strong> to cancel. Reply{" "}
          <strong className="text-[var(--text)]">HELP</strong> for help. Reply{" "}
          <strong className="text-[var(--text)]">START</strong> (or follow
          carrier/program instructions) if you wish to resume where supported.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          SMS content and related metadata may be used to deliver coaching, keep
          conversation context, and personalize follow-ups. Account deletion also
          stops Summitt Mindset text messages for that account. Canceling
          membership alone does not delete your account; see our{" "}
          <Link href="/data-deletion" className="underline underline-offset-4">
            Data Deletion
          </Link>{" "}
          page.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">4. Service providers</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          We use trusted service providers to operate Summitt Mindset. Depending
          on the feature, that may include:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>Clerk — authentication and sign-in identity</li>
          <li>Supabase — application data storage</li>
          <li>Stripe — subscription and payment processing</li>
          <li>Twilio — SMS delivery and related messaging infrastructure</li>
          <li>
            Vercel — application hosting, delivery, runtime logs, security and
            firewall tooling, and related operational observability
          </li>
          <li>
            Resend — transactional and operational email (including service,
            fulfillment, and administrative notifications)
          </li>
          <li>
            OpenAI — AI processing used to generate or support coaching-related
            content where those features are enabled
          </li>
          <li>
            Meta Platforms, Inc. (Meta) — website analytics and marketing
            measurement via Meta Pixel on the normal website (browser), where
            configured. Meta Pixel is not loaded in the Summitt Mindset iOS app
            or the Summitt Mindset Android app.
          </li>
          <li>
            Vimeo — embedded video playback for Film Room and related lessons
            (see section 6)
          </li>
        </ul>
        <p className="text-base leading-7 text-[var(--muted)]">
          These providers process information only as needed to provide their
          services to us. Sharing with service providers for product operation is
          not a sale of personal information. We do not sell personal information.
          Text messaging originator opt-in data and consent are not shared with
          third parties for their marketing or promotional purposes.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          We do not claim that OpenAI or other AI providers train their general
          models on your Summitt Mindset content under this policy. AI features
          process relevant context to operate the product. We do not claim that
          every field or every user record is sent to OpenAI.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          5. Website analytics and Meta Pixel
        </h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          On the normal Summitt Mindset website viewed in a browser, we may use
          Meta Pixel (a technology provided by Meta Platforms, Inc.) when it is
          configured for our site. We use it to help measure website usage,
          understand marketing performance, evaluate selected marketing funnel
          actions, and improve advertising effectiveness.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          When Meta Pixel runs, Meta may receive browser, device, and interaction
          information such as IP address, browser or device information,
          cookies or similar identifiers, page URLs, page views, and selected
          interaction or event data. This is not an exhaustive list; Meta’s
          script may also process technical information according to Meta’s own
          practices.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Summitt Mindset does not intentionally provide Meta Pixel with
          journal entries, Ask Pat conversations, goals, SMS message content,
          payment card numbers, or email address, phone number, or name through
          advanced matching. Page-view measurement on our site is limited to
          selected marketing routes; we do not enable Meta Pixel for the
          Summitt Mindset iOS app or Android app experience.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Meta Pixel is not loaded in the Summitt Mindset iOS app or the Summitt
          Mindset Android app. Opening Summitt Mindset in those native apps does
          not initialize Meta Pixel for that in-app experience. The normal
          website in a browser may still use Meta Pixel when configured.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          We may also send limited server-side conversion events to Meta through
          Meta’s Conversions API. Those events are used to measure trial start
          and the first successful paid subscription payment. We do not send
          email address, phone number, or name with those server-side events.
          We do not send SMS content, goals, journal or Victory Room content,
          Ask Pat conversations, or payment-card data. Meta remains a third
          party involved in website analytics and marketing measurement; its
          use of information is also governed by Meta’s own terms and policies.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">6. Embedded video (Vimeo)</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          Summitt Mindset embeds Vimeo videos for Film Room and related lessons.
          When an embedded Vimeo player loads, Vimeo may receive technical and
          device information, page or referrer context, video identifiers,
          cookies or similar identifiers, and playback or interaction
          information. We use this sharing to provide and operate embedded video
          playback.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Summitt Mindset does not place journals, Ask Pat conversations, goals,
          SMS content, payment-card information, email, phone, or Clerk user IDs
          into Vimeo embed URLs. Our embeds use Vimeo’s Do Not Track player
          option where implemented; that does not guarantee zero technical
          logging or zero essential storage by Vimeo.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Vimeo’s handling of information is also governed by Vimeo’s own privacy
          practices. Account deletion at Summitt Mindset does not claim to erase
          technical logs retained independently by Vimeo.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">
          7. Hosting, technical logs, and approximate location
        </h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          Summitt Mindset is hosted on Vercel. When you use the website or the
          iOS or Android apps (which request the live site), Vercel and our
          application may create limited technical and operational records such
          as those described in section 1. That may include IP address and
          IP-derived country or other approximate location information used for
          hosting, security, reliability, debugging, performance, and fraud or
          abuse prevention—not for Summitt Mindset cross-company advertising
          tracking.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Some application console logs may include internal account
          identifiers, processing stages, request identifiers, performance
          timing, outcomes, limited error information, or partial phone-number
          information. We do not claim that those operational logs routinely
          contain full email addresses, full phone numbers, Ask Pat questions or
          answers, journals, goals, identity statements, SMS bodies, or complete
          request/response bodies. Ask Pat operational logging is designed to
          exclude Ask Pat question, answer, profile, goal, journal, and identity
          content.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          We do not use Vercel Web Analytics or Vercel Speed Insights as part of
          the product described here. Runtime and security logging may still
          occur as part of normal hosting and protection of the service.
          Retention of hosting and security logs may vary by provider settings
          and legal need; we do not promise that every infrastructure record is
          erased on the same schedule as your in-app account data.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">8. Account deletion</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          You may request permanent deletion of your Summitt Mindset account.
          Deletion is separate from canceling membership. Canceling a membership
          billed directly by Summitt stops that future billing and paid access
          but keeps your account and app data unless you also delete the
          account. If you purchased through Apple, deleting your Summitt account
          does not cancel the App Store subscription. Manage or cancel that
          subscription through Apple.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          When an account deletion is completed, we stop Summitt Mindset text
          messages for that account, remove Summitt Mindset membership access,
          delete journals, progress, coaching history, preferences, Leadership
          Kit shipping addresses stored in our application database, and related
          app data owned by the account, and delete the sign-in identity used to
          access the service. A membership billed directly by Summitt is
          canceled as part of deletion. An App Store subscription is not
          canceled by deleting your Summitt account and must be managed or
          canceled through Apple.
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          Signed-in members can open Account, select Delete account in the
          Danger zone, confirm by typing DELETE, and re-verify their identity.
          Inactive or new app users without an active membership can start the
          same deletion flow from the Membership required screen. Deletion is
          permanent and may take time to finish processing. Support remains
          available at{" "}
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>
          . See{" "}
          <Link href="/data-deletion" className="underline underline-offset-4">
            Data Deletion
          </Link>{" "}
          for details.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">9. Limited retained records</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          We do not claim that all data is instantly or universally erased. After
          deletion, limited records may be retained when required for:
        </p>
        <ul className="list-disc space-y-2 pl-5 text-base leading-7 text-[var(--muted)]">
          <li>
            Payment, tax, fraud, dispute, accounting, or other legal obligations
            (including records retained by Stripe or other providers)
          </li>
          <li>SMS opt-out and messaging-compliance evidence</li>
          <li>Account-deletion orchestration or audit evidence</li>
          <li>Enforcement of deletion or messaging preferences</li>
          <li>
            Security, abuse-prevention, or operational emails and provider-side
            records subject to provider or legal retention
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">10. Your choices</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          You may update account preferences in the product where available,
          manage SMS consent with STOP/HELP/START as described above, cancel
          membership without deleting your account, or request account deletion
          as described on the{" "}
          <Link href="/data-deletion" className="underline underline-offset-4">
            Data Deletion
          </Link>{" "}
          page. For access or other privacy questions, email{" "}
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>
          .
        </p>
        <p className="text-base leading-7 text-[var(--muted)]">
          For website analytics and advertising technologies such as Meta Pixel,
          you may also use browser controls—for example adjusting cookie
          settings, clearing cookies, or using private browsing—and, where
          available, Meta’s ad-preference or related controls. These steps may
          limit some measurement; they do not guarantee that all third-party
          processing is blocked in every browser or configuration.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold">11. Contact</h2>
        <p className="text-base leading-7 text-[var(--muted)]">
          <a
            href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
            className="font-medium text-[var(--text)] underline underline-offset-4 break-all"
          >
            {ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY}
          </a>
        </p>
      </section>
    </main>
  );
}
