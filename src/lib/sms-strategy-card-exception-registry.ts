/**
 * Signed registry of intentional non–Strategy Card SMS surfaces (Phase 4.9a).
 * Phase 4.9b: derived from {@link SMS_SURFACE_AUTHORITY_REGISTRY} for single source of truth.
 * Documentation-oriented — not imported by production routing.
 */

import type { StrategyCardRouteKind } from "@/lib/coaching-strategy-card-v1";
import {
  ACTIVE_STRATEGY_CARD_ROUTE_KINDS,
  nonActiveSurfaceAuthorityEntries,
  type SmsSurfaceAuthorityClassification,
  type SmsSurfaceAuthorityDisposition,
  type SmsSurfaceAuthorityEntry,
} from "@/lib/sms-surface-authority-registry";

export type StrategyCardExceptionClassification =
  | "hard_route_deterministic"
  | "state_machine_transactional"
  | "deferred_env_gated"
  | "app_driven_constrained"
  | "deprecated_no_visible_sms";

export type StrategyCardExceptionDisposition =
  | "never_strategy_card"
  | "document_and_monitor"
  | "monitor_production_volume"
  | "defer_strategy_card"
  | "keep_no_send_retire_when_safe";

export type StrategyCardExceptionEntry = {
  id: string;
  surface_label: string;
  route_identifiers: string[];
  classification: StrategyCardExceptionClassification;
  owner: "sms-platform";
  disposition: StrategyCardExceptionDisposition;
  reason: string;
  action: string;
};

export { ACTIVE_STRATEGY_CARD_ROUTE_KINDS };

function mapAuthorityClassificationToLegacy(
  c: SmsSurfaceAuthorityClassification
): StrategyCardExceptionClassification {
  switch (c) {
    case "hard_route_deterministic_exception":
    case "suppressed_no_visible_sms":
      return "hard_route_deterministic";
    case "state_machine_transactional_exception":
      return "state_machine_transactional";
    case "deferred_env_gated_exception":
      return "deferred_env_gated";
    case "app_driven_constrained_exception":
      return "app_driven_constrained";
    case "deprecated_no_visible_sms":
      return "deprecated_no_visible_sms";
    default:
      throw new Error(`not an exception classification: ${c}`);
  }
}

function mapAuthorityDispositionToLegacy(
  d: SmsSurfaceAuthorityDisposition,
  classification: SmsSurfaceAuthorityClassification
): StrategyCardExceptionDisposition {
  if (d === "never_card") return "never_strategy_card";
  if (d === "deferred_monitor") return "monitor_production_volume";
  if (d === "deprecated") return "keep_no_send_retire_when_safe";
  if (classification === "app_driven_constrained_exception") return "defer_strategy_card";
  return "document_and_monitor";
}

function toLegacyExceptionEntry(entry: SmsSurfaceAuthorityEntry): StrategyCardExceptionEntry {
  return {
    id: entry.id,
    surface_label: entry.surface_label,
    route_identifiers: [...entry.route_identifiers],
    classification: mapAuthorityClassificationToLegacy(entry.classification),
    owner: "sms-platform",
    disposition: mapAuthorityDispositionToLegacy(entry.disposition, entry.classification),
    reason: entry.reason,
    action: entry.action,
  };
}

const LEGACY_EXCEPTION_EXCLUDED_IDS = new Set([
  "deprecated_followup_sms",
  "deprecated_missed_yesterday_sms",
  "deprecated_inactivity_rescue",
  "deprecated_post_churn_winback",
]);

/** Phase 4.9a exception list — excludes active Strategy Card surfaces and deprecated cron metadata-only routes. */
export const SMS_STRATEGY_CARD_EXCEPTIONS: readonly StrategyCardExceptionEntry[] =
  nonActiveSurfaceAuthorityEntries()
    .filter((e) => !LEGACY_EXCEPTION_EXCLUDED_IDS.has(e.id))
    .map(toLegacyExceptionEntry);

export function allStrategyCardExceptionRouteIdentifiers(): string[] {
  return SMS_STRATEGY_CARD_EXCEPTIONS.flatMap((e) => e.route_identifiers);
}

export function isActiveStrategyCardRouteKind(routeKind: string): boolean {
  return (ACTIVE_STRATEGY_CARD_ROUTE_KINDS as readonly string[]).includes(routeKind);
}

export function findStrategyCardExceptionByRouteIdentifier(
  routeId: string
): StrategyCardExceptionEntry | undefined {
  const norm = routeId.trim();
  return SMS_STRATEGY_CARD_EXCEPTIONS.find((e) =>
    e.route_identifiers.some((id) => id === norm)
  );
}
