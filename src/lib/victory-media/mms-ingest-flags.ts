/**
 * Victory Media MMS ingest feature flag (Slice A2).
 * Default off — dark rollout: transport OK, no media job rows.
 */

export function isVictoryMediaMmsIngestEnabled(): boolean {
  return process.env.VICTORY_MEDIA_MMS_INGEST_ENABLED === "true";
}
