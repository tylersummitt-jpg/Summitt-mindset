import type { Metadata } from "next";
import Link from "next/link";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import AccountDeletionDangerZone from "@/components/account-deletion-danger-zone";
import ResumeMembershipButton from "@/components/resume-membership-button";
import { shouldShowAccountDeletionDangerZone } from "@/lib/account-deletion/account-deletion-initiation-access.server";
import {
  ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY,
  ACCOUNT_DELETION_SUPPORT_EMAIL_HREF,
} from "@/lib/legal/account-deletion-public-availability";
import IosAppleMembershipPanel from "@/components/ios-apple-membership-panel";
import SignInWithAnotherAccountButton from "@/components/app-sign-in/SignInWithAnotherAccountButton";
import { APP_SIGN_IN_PATH } from "@/lib/app-sign-in/app-sign-in-constants";
import {
  detectSummittMindsetPlatformRequest,
  isNativeSummittMindsetAppRequest,
} from "@/lib/native-app/is-native-summitt-mindset-app-request";
import { MEMBER_APP_HOME_PATH } from "@/lib/member-app-home-path";
import { isPausedFromPublicMetadata } from "@/lib/summitt-subscription-membership";

export const metadata: Metadata = {
  title: "Membership",
  description: "Summitt Mindset membership status",
  robots: { index: false, follow: false },
};

/**
 * force-dynamic: evaluate deletion Danger Zone visibility per request from
 * server initiation access (same dual-gate helper as /user). Does not bake
 * env flags into the client.
 */
export const dynamic = "force-dynamic";

function signedInEmail(
  user: {
    primaryEmailAddressId?: string | null;
    emailAddresses?: Array<{ id?: string; emailAddress?: string | null }>;
  } | null
): string | null {
  const addresses = user?.emailAddresses;
  if (!addresses?.length) return null;
  const primary = addresses.find(
    (address) => address.id && address.id === user?.primaryEmailAddressId
  );
  const raw = (primary ?? addresses[0])?.emailAddress;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isSubscribedFromMetadata(md: Record<string, unknown>): boolean {
  const subscribedRaw = md?.summittSubscribed;
  const plan = md?.summittPlan;
  return (
    subscribedRaw === true ||
    subscribedRaw === "true" ||
    plan === "monthly" ||
    plan === "annual"
  );
}

/**
 * Native membership surface.
 * iOS shell: Apple IAP (StoreKit price, restore, no website checkout).
 * Android / browser: existing non-purchase copy. Stripe checkout stays on /subscribe.
 */
export default async function AppMembershipPage() {
  const { userId } = await auth();
  if (!userId) {
    const isNativeApp = await isNativeSummittMindsetAppRequest();
    redirect(isNativeApp ? APP_SIGN_IN_PATH : "/sign-in");
  }

  const user = await currentUser();
  const md = (user?.publicMetadata || {}) as Record<string, unknown>;

  if (isSubscribedFromMetadata(md)) {
    redirect(MEMBER_APP_HOME_PATH);
  }

  const platform = await detectSummittMindsetPlatformRequest();
  const isPaused = isPausedFromPublicMetadata(md);
  const showIosApplePurchase = platform === "ios" && !isPaused;
  const showDangerZone = shouldShowAccountDeletionDangerZone(userId);
  const email = signedInEmail(user);

  return (
    <main
      className="mx-auto w-full max-w-md overflow-x-hidden px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]"
      data-app-membership={showIosApplePurchase ? "apple-iap" : "neutral"}
    >
      <header className="space-y-3 text-center">
        <p className="text-sm font-medium text-[var(--muted)]">
          Summitt Mindset
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)] sm:text-3xl">
          {isPaused ? "Membership paused" : "Let's find your membership"}
        </h1>
      </header>

      {email ? (
        <p className="mt-6 text-center text-base leading-7 text-[var(--text)]">
          Signed in as:
          <span className="mt-1 block break-all font-semibold">{email}</span>
        </p>
      ) : null}

      {!isPaused ? (
        <section className="mt-8 space-y-3 text-center" aria-labelledby="already-a-member">
          <h2
            id="already-a-member"
            className="text-xl font-semibold text-[var(--text)]"
          >
            Already a member?
          </h2>
          <p className="text-base leading-7 text-[var(--text)]">
            Sign in with the same email you used for Summitt Mindset on the
            website.
          </p>
          <SignInWithAnotherAccountButton />
        </section>
      ) : null}

      <div className="mt-8 space-y-4 text-base leading-7 text-[var(--muted)]">
        {isPaused ? (
          <>
            <p>
              Your Summitt Mindset membership is paused. Resume your existing
              membership to continue.
            </p>
            <div className="pt-2">
              <ResumeMembershipButton variant="subscribe" />
            </div>
            <p>
              You can also manage your account from{" "}
              <Link
                href="/user"
                className="underline underline-offset-4 text-[var(--text)]"
              >
                Account
              </Link>
              .
            </p>
            <SignInWithAnotherAccountButton prominence="quiet" />
          </>
        ) : showIosApplePurchase ? (
          <IosAppleMembershipPanel />
        ) : (
          <>
            <p>
              Your account does not currently have an active Summitt Mindset
              membership.
            </p>
            <p>
              Memberships are managed on the Summitt Mindset website.
            </p>
            <p>
              Sign in on the website to review your membership options.
            </p>
          </>
        )}
      </div>

      {showDangerZone ? (
        <section
          className="mt-10"
          data-testid="account-danger-zone-slot"
          aria-label="Delete account"
        >
          <AccountDeletionDangerZone surface="light" />
        </section>
      ) : null}

      <nav
        className="mt-10 flex flex-col gap-3 text-center text-sm"
        aria-label="Account and legal"
      >
        <Link
          href="/sign-out"
          className="rounded-md border border-[var(--border)] px-4 py-3 text-[var(--text)]"
        >
          Sign out
        </Link>
        <a
          href={ACCOUNT_DELETION_SUPPORT_EMAIL_HREF}
          className="underline underline-offset-4 break-all"
        >
          Contact support ({ACCOUNT_DELETION_SUPPORT_EMAIL_DISPLAY})
        </a>
        <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 underline">
          <Link href="/privacy">Privacy Policy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/data-deletion">Data Deletion</Link>
        </div>
      </nav>
    </main>
  );
}
