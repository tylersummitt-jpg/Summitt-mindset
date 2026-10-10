import type { NonmemberRecovery } from "@/lib/nonmember-recovery";

export function NonmemberRecoveryPanel({ recovery }: { recovery: NonmemberRecovery }) {
  return (
    <section className="space-y-3 text-sm text-gray-700">
      <h2 className="text-lg font-semibold text-gray-900">Nonmember recovery</h2>
      <details className="rounded border border-gray-200 bg-white px-4 py-3">
        <summary className="cursor-pointer font-medium text-gray-900">How this works</summary>
        <div className="mt-3 space-y-2">
          <p>
            A nonmember is a Clerk account this scan could verify as not a current Stripe or
            Apple member, and not someone whose membership check failed.
          </p>
          <p>
            Unknown membership is not a nonmember. A partial Stripe or Apple read stays unknown.
          </p>
          <p>
            For eligible U.S. prospects, commercial email does not require advance marketing
            opt-in. We still have to honor opt-outs, complaints, bounces, and any stricter
            rule that applies.
          </p>
          <p>
            Creating an account does not override an unsubscribe. Email and coaching texts use
            different rules. Marketing-email suppression data is not connected yet, so a missing
            list is not zero unsubscribes.
          </p>
          <p>
            The stopping points are checkout records already stored for that account. They do
            not show a pricing view or a click unless that event was stored for the account.
          </p>
          <p>
            The census reads the newest Clerk accounts, at most 200. If more accounts exist, the
            scan is partial.
          </p>
          <p>This page does not send emails, and it does not schedule a send.</p>
          <p>
            A future test would keep a group with no new message and compare one
            follow-up that honors opt-out. The outcome would be a verified trial, then paid
            membership and mature retention. That test is only a plan. It is not assigned.
          </p>
          <p>
            The page calculates these counts when it loads. Tyler reviews them. A future sending
            build must check suppression and membership status immediately before sending. That
            sender is not built.
          </p>
        </div>
      </details>
      <p>{recovery.coverage}</p>
      <p>{recovery.sending}</p>
      <p>Verified nonmembers: {recovery.verifiedNonmembers}.</p>
      <p>No verified trial, from recorded checkout stages: {recovery.noVerifiedTrial}.</p>
      <p>Membership status unknown: {recovery.uncertainMembership}.</p>
      <p>Current members excluded: {recovery.currentMembersExcluded}.</p>
      <p>Former members excluded from the prospect group: {recovery.formerMembersExcluded}.</p>
      <p>Accounts outside this scan: {recovery.outsideCoverage}.</p>
      <p>Potential recovery prospects: {recovery.potentialProspects}</p>
      <p>Do not email: {recovery.doNotEmail}</p>
      <p>Suppression status not verified: {recovery.suppressionUnverified}</p>
      <p>Not eligible: {recovery.notEligible}</p>
      <p>{recovery.smsPermission}</p>
      <ul className="list-disc space-y-1 pl-5">
        {recovery.stages.map((row) => (
          <li key={row.label}>
            {row.label}: {row.value}
          </li>
        ))}
      </ul>
      <p>{recovery.journeyNote}</p>
      <p>Send-ready: {recovery.sendReady}</p>
      {recovery.experiment.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </section>
  );
}
