/**
 * Compatibility wrapper: B1-only kick is superseded by the MMS pipeline.
 * Production Twilio inbound uses kickInboundMediaPipeline.
 */

export {
  INBOUND_MEDIA_PIPELINE_B1_LIMIT as INBOUND_MEDIA_B1_BATCH_LIMIT,
  kickInboundMediaPipeline as kickInboundMediaB1Downloads,
} from "@/lib/victory-media/kick-inbound-media-pipeline";
