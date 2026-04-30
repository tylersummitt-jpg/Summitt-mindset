-- Wave 9.1 — durable non-outcome living-memory signals (not accountability proof; not user_yes/no/partial).
-- Wave 9.2: Deploy before or with app code that calls insertV2SmsMemorySignalEvent; insert is non-blocking if delayed.
ALTER TABLE v2_commitment_event DROP CONSTRAINT IF EXISTS v2_commitment_event_type_chk;

ALTER TABLE v2_commitment_event ADD CONSTRAINT v2_commitment_event_type_chk CHECK (
  event_type IN (
    'created',
    'activated',
    'check_sent',
    'user_yes',
    'user_no',
    'user_partial',
    'user_silent',
    'blocker_captured',
    'contract_overlay_proposed',
    'contract_overlay_activated',
    'contract_overlay_declined',
    'coaching_refresh_prompted',
    'coaching_refresh_resolved',
    'ask_shrunk',
    'timing_shifted',
    'tone_shifted',
    'paused',
    'resumed',
    'completed',
    'abandoned',
    'superseded',
    'sms_memory_signal'
  )
);
