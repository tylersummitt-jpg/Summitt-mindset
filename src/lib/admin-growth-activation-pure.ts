/**
 * Pure 24h activation evaluator. No I/O. SMS bodies are classified, never stored.
 */

export function evaluateTrialActivatedWithin24h(args: {
  trialStartUnix: number;
  identityIntakeCompletedAtMs: number | null;
  goalStartedAtMs: number[];
  checkSentAtMs: number[];
  inbounds: Array<{ receivedAtMs: number; rawBody: string }>;
  isComplianceOrOptOut: (raw: string) => boolean;
}): boolean {
  if (!Number.isFinite(args.trialStartUnix)) return false;
  const windowStart = args.trialStartUnix * 1000;
  const windowEnd = windowStart + 24 * 60 * 60 * 1000;

  const onboarded = args.identityIntakeCompletedAtMs;
  if (onboarded == null || onboarded < windowStart || onboarded >= windowEnd) {
    return false;
  }

  const hasGoal = args.goalStartedAtMs.some(
    (at) => at >= windowStart && at < windowEnd
  );
  if (!hasGoal) return false;

  const checks = args.checkSentAtMs.filter(
    (at) => at >= windowStart && at < windowEnd
  );
  if (checks.length === 0) return false;

  return args.inbounds.some((msg) => {
    if (msg.receivedAtMs < windowStart || msg.receivedAtMs >= windowEnd) {
      return false;
    }
    if (args.isComplianceOrOptOut(msg.rawBody)) return false;
    return checks.some((checkAt) => msg.receivedAtMs > checkAt);
  });
}
