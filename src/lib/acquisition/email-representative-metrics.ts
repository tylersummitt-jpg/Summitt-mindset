/**
 * Counts the email representative can defend from stored rows.
 * A trial_started event is a recorded subscription event, not proof a reply caused it.
 */

export type EmailRepresentativeReport = {
  readable: boolean;
  knowledgeInstalled: boolean;
  interpretedReplies: number | null;
  aiDrafts: number | null;
  needsHuman: number | null;
  outboundReplies: number | null;
  manualOpen: number | null;
  manualSent: number | null;
  averageHumanHours: number | null;
  resolvedWithoutTylerPercent: number | null;
  activeKnowledge: number | null;
  retiredKnowledge: number | null;
  repeatedTopics: Array<{ topic: string; count: number }>;
  recordedTrialStarts: number | null;
  recordedPaidMembers: number | null;
  leadershipKitAcceptance: null;
  notes: string[];
};

export function averageHours(pairs: readonly { startedAt: string; resolvedAt: string | null }[]): number | null {
  const hours = pairs.flatMap((pair) => {
    if (!pair.resolvedAt) return [];
    const elapsed = Date.parse(pair.resolvedAt) - Date.parse(pair.startedAt);
    if (!Number.isFinite(elapsed) || elapsed < 0) return [];
    return [elapsed / 36e5];
  });
  if (hours.length === 0) return null;
  const mean = hours.reduce((sum, value) => sum + value, 0) / hours.length;
  return Math.round(mean * 10) / 10;
}

export function resolvedWithoutTylerPercent(args: { aiDrafts: number | null; needsHuman: number | null }): number | null {
  if (args.aiDrafts == null || args.needsHuman == null) return null;
  const total = args.aiDrafts + args.needsHuman;
  if (total === 0) return null;
  return Math.round((args.aiDrafts / total) * 100);
}

export function buildEmailRepresentativeReport(args: {
  readable: boolean;
  knowledgeInstalled: boolean;
  interpretedReplies: number | null;
  aiDrafts: number | null;
  needsHuman: number | null;
  outboundReplies: number | null;
  manualOpen: number | null;
  manualSent: number | null;
  humanHours: readonly { startedAt: string; resolvedAt: string | null }[];
  activeKnowledge: number | null;
  retiredKnowledge: number | null;
  repeatedTopics: Array<{ topic: string; count: number }>;
  recordedTrialStarts: number | null;
  recordedPaidMembers: number | null;
}): EmailRepresentativeReport {
  return {
    readable: args.readable,
    knowledgeInstalled: args.knowledgeInstalled,
    interpretedReplies: args.interpretedReplies,
    aiDrafts: args.aiDrafts,
    needsHuman: args.needsHuman,
    outboundReplies: args.outboundReplies,
    manualOpen: args.manualOpen,
    manualSent: args.manualSent,
    averageHumanHours: averageHours(args.humanHours),
    resolvedWithoutTylerPercent: resolvedWithoutTylerPercent({
      aiDrafts: args.aiDrafts,
      needsHuman: args.needsHuman,
    }),
    activeKnowledge: args.activeKnowledge,
    retiredKnowledge: args.retiredKnowledge,
    repeatedTopics: args.repeatedTopics,
    recordedTrialStarts: args.recordedTrialStarts,
    recordedPaidMembers: args.recordedPaidMembers,
    leadershipKitAcceptance: null,
    notes: [
      "A stored AI draft is not proof the reply was sent.",
      "needs_human counts questions held for Tyler. It is not his reply time.",
      "Recorded trial and paid events are not attributed to a message or a campaign.",
      "Leadership Kit acceptance is not an acquisition event, so it is not counted.",
      "Repeated topics count active approved knowledge, not uncategorized escalations.",
    ],
  };
}
