/**
 * SMS Review Place — rebuild Strategy Card from inbound facts (Review Place only).
 */

import {
  buildStrategyCardContextFromSnapshot,
  buildStrategyCardV1ForFacts,
  isStrategyCardEligible,
  validateAndRepairStrategyCardV1,
  type StrategyCardV1,
} from "@/lib/coaching-strategy-card-v1";
import { buildRelationshipPacketForOpenAI } from "@/lib/sms-relationship-packet-v1";
import type { InboundV3RelationshipFacts } from "@/lib/v3-inbound-relationship-lane";

export function rebuildInboundStrategyCardForReview(
  facts: InboundV3RelationshipFacts
): StrategyCardV1 | null {
  if (!isStrategyCardEligible(facts)) return null;
  const relationshipPacket = buildRelationshipPacketForOpenAI({
    lane: "inbound",
    sourceFacts: facts,
    commitmentRow: null,
  });
  const strategyCtx = buildStrategyCardContextFromSnapshot({
    facts,
    snapshot: relationshipPacket.snapshotV2,
  });
  const draftCard = buildStrategyCardV1ForFacts({ ctx: strategyCtx });
  return validateAndRepairStrategyCardV1(draftCard, strategyCtx).card;
}
