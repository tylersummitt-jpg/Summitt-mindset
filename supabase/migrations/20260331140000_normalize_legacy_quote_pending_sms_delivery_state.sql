-- =============================================================================
-- One-time normalization: legacy mis-encoded Daily "quote SMS next" rows
-- =============================================================================
--
-- Live semantics (see src/lib/sms-daily-delivery-body.ts):
--   - current_content_type = category of the LAST successfully sent outbound SMS.
--   - For Daily, after 3 respond sends we keep (respond, question_attempt_count = 3)
--     until the quote SMS is sent; only after quote does the row become
--     (non_response, question_attempt_count = 0) with question_position and
--     quote_position advanced together.
--
-- Older writes sometimes stored "quote pending" as (non_response, 0) BEFORE the
-- quote was sent. The mapper interprets (non_response, 0) as post-quote, so the
-- next outbound would wrongly be a respond SMS instead of quote.
--
-- We cannot safely fix every (non_response, 0) row in SQL: valid post-quote rows
-- use the same attempt count and content_type. A narrow predicate is safe:
--
--   After the first quote in the new engine, question_position is always >= 2
--   (see applySmsDeliveryStateAfterSuccessfulSend for daily quote branch).
--   Therefore (daily, non_response, 0) at question_position = 1 and
--   quote_position = 0 cannot be a valid post-quote snapshot — only the
--   mis-encoded "quote pending" / default-edge case.
--
-- Wider tuples (e.g. position 2,1) remain ambiguous if legacy data exists;
-- repair those manually if discovered.
-- =============================================================================

UPDATE sms_delivery_state
SET
  current_content_type = 'respond',
  question_attempt_count = 3
WHERE sms_bucket = 'daily'
  AND current_content_type = 'non_response'
  AND question_attempt_count = 0
  AND question_position = 1
  AND quote_position = 0
  AND flex_cadence_index = 0;
