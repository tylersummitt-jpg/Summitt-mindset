-- Two follow-ups after the personal video email is accepted.
-- Does not send email. Does not update existing actions, journeys, or settings values.
-- Git push does not run this file.

ALTER TABLE public.acquisition_actions
  DROP CONSTRAINT acquisition_actions_type_chk;

ALTER TABLE public.acquisition_actions
  ADD CONSTRAINT acquisition_actions_type_chk CHECK (
    action_type IN (
      'send_asset',
      'send_video',
      'send_video_reminder',
      'send_video_reminder_final',
      'send_trial_followup'
    )
  );

ALTER TABLE public.acquisition_people
  DROP CONSTRAINT acquisition_people_next_chk;

ALTER TABLE public.acquisition_people
  ADD CONSTRAINT acquisition_people_next_chk CHECK (
    next_action_type IS NULL OR next_action_type IN (
      'send_asset',
      'send_video',
      'send_video_reminder',
      'send_video_reminder_final',
      'send_trial_followup'
    )
  );

ALTER TABLE public.acquisition_settings
  ADD COLUMN video_reminder_hours INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN video_final_reminder_hours INTEGER NOT NULL DEFAULT 96;

ALTER TABLE public.acquisition_settings
  ADD CONSTRAINT acquisition_settings_video_reminder_hours_chk
    CHECK (video_reminder_hours BETWEEN 1 AND 336),
  ADD CONSTRAINT acquisition_settings_video_final_reminder_hours_chk
    CHECK (
      video_final_reminder_hours > video_reminder_hours
      AND video_final_reminder_hours <= 720
    );
