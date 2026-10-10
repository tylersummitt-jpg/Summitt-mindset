import { markRecoveryHandled, pauseRecoveryAutomation, sendRecoveryInboxTestAction } from "@/app/admin/recovery-actions";
import type { NonmemberRecovery } from "@/lib/nonmember-recovery";
import type { RecoveryAttention } from "@/lib/recovery-report";

export function NonmemberRecoveryPanel({
  recovery,
  attention,
}: {
  recovery: NonmemberRecovery;
  attention: RecoveryAttention;
}) {
  return (
    <section className="space-y-3 text-sm text-gray-700">
      <h2 className="text-lg font-semibold text-gray-900">Nonmember recovery</h2>
      <p>Status: {statusLabel(attention.status)}.</p>
      <p>Readiness: {attention.blockers.length > 0 ? "Not ready" : "Checks are open. Missing country is not labeled United States."}.</p>
      <form action={pauseRecoveryAutomation}>
        <button type="submit" className="rounded border border-gray-300 bg-white px-3 py-1">
          Emergency Pause
        </button>
      </form>
      <form action={sendRecoveryInboxTestAction}>
        <button type="submit" className="rounded border border-gray-300 bg-white px-3 py-1">
          Send inbox test
        </button>
      </form>
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
          <p>
            Sending is off until it is separately authorized. Deploying this page does not send.
            A verified nonmember is not send-ready. The sequence is at most three emails:
            about 24 hours after the account, then three days, then four days. It stops for a
            trial, a reply, an unsubscribe, or any failed check.
          </p>
          <p>
            Eligible people are split once into recovery email or a no-email holdout. The
            holdout never receives a recovery email. Original first-touch attribution stays
            in place. No winner is declared here.
          </p>
          <p>
            Tyler personally answers a real reply. There is no automatic reply. Marking it
            handled does not restart the emails. Reply monitoring is not connected until a
            reply to a recovery message is matched and listed here. A test email sent only
            to the inbound address does not confirm that match. The reply path uses one
            address, then forwards a copy to the Tyler mailbox.
          </p>
          <p>
            The hourly job does not send while the switch is off. Send inbox test goes
            only to the approved Tyler mailbox and does not start the pilot. Emergency Pause sets the
            server status to paused. A later send must recheck suppression and membership
            immediately before sending. Missing country stays unknown. It is not labeled
            United States, and it does not block the whole program. A known restricted
            country is excluded. Country is not inferred.
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
      <h3 className="text-base font-semibold text-gray-900">Eligible prospects</h3>
      <p>{attention.countryRule}</p>
      <p>Send-ready: {recovery.sendReady}</p>
      {recovery.experiment.map((line) => (
        <p key={line}>{line}</p>
      ))}
      <h3 className="text-base font-semibold text-gray-900">Remaining setup</h3>
      <p>{attention.sending}</p>
      <ul className="list-disc space-y-1 pl-5">
        {attention.blockers.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <h3 className="text-base font-semibold text-gray-900">Email activity</h3>
      <p>
        Control {attention.control}. Recovery {attention.recovery}. Attempted {attention.attempted}.
        Accepted {attention.accepted}. Delivered {attention.delivered}. Failed {attention.failed}.
        Suppressed {attention.suppressed}.
      </p>
      <p>Unsubscribes {attention.unsubscribes}. Complaints {attention.complaints}.</p>
      <h3 className="text-base font-semibold text-gray-900">Experiment results</h3>
      <p>{attention.trialConversion}</p>
      <p>{attention.payments}</p>
      <p>{attention.retention}</p>
      <h3 id="needs-your-reply" className="text-base font-semibold text-gray-900">
        Needs your reply
      </h3>
      <p>
        Stored inbound messages: {attention.inboundReceived}. A message that was not matched
        to a recovery email does not confirm reply handling.
      </p>
      <p>Recovery replies needing your attention: {attention.repliesLabel}.</p>
      <p>{attention.mailboxNote}</p>
      {attention.replies.length === 0 ? (
        <p>No imported replies are waiting. That is not a count of the mailbox.</p>
      ) : (
        attention.replies.map((reply) => (
          <article key={reply.id} className="rounded border border-gray-200 bg-white px-4 py-3">
            <p>{reply.firstName}</p>
            <p>{reply.receivedLabel}</p>
            <p>{reply.stepLabel}</p>
            <p>{reply.preview}</p>
            <p>{reply.status === "handled" ? "Handled" : "Needs reply"}</p>
            {reply.status === "needs_reply" ? (
              <form action={markRecoveryHandled}>
                <input type="hidden" name="replyId" value={reply.id} />
                <button type="submit" className="rounded border border-gray-300 bg-white px-3 py-1">
                  Mark handled
                </button>
              </form>
            ) : null}
          </article>
        ))
      )}
    </section>
  );
}

function statusLabel(status: RecoveryAttention["status"]): string {
  if (status === "pilot") return "Pilot";
  if (status === "active") return "Active";
  if (status === "paused") return "Paused";
  if (status === "off") return "Off";
  return "Unavailable";
}
