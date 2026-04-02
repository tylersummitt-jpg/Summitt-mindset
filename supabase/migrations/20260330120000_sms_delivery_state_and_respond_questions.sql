-- New SMS delivery engine: per-user state + ordered question bank.

CREATE TABLE respond_day_questions (
  id BIGSERIAL PRIMARY KEY,
  position INTEGER NOT NULL UNIQUE,
  prompt_morning TEXT NOT NULL,
  prompt_evening TEXT NOT NULL,
  response_type TEXT NOT NULL DEFAULT 'multiple_choice',
  retry_intro_1 TEXT NULL,
  retry_intro_2 TEXT NULL,
  option_a TEXT NULL,
  option_b TEXT NULL,
  option_c TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_respond_day_questions_position ON respond_day_questions (position) WHERE active = true;

CREATE TABLE sms_delivery_state (
  clerk_user_id TEXT PRIMARY KEY,
  question_position INTEGER NOT NULL DEFAULT 1,
  quote_position INTEGER NOT NULL DEFAULT 0,
  current_content_type TEXT NOT NULL DEFAULT 'respond',
  question_attempt_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sms_delivery_state_content_type_chk
    CHECK (current_content_type IN ('respond', 'non_response')),
  CONSTRAINT sms_delivery_state_question_attempt_chk
    CHECK (question_attempt_count >= 0)
);

CREATE INDEX idx_sms_delivery_state_updated ON sms_delivery_state (updated_at);

CREATE OR REPLACE FUNCTION update_sms_delivery_state_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_sms_delivery_state_updated_at
  BEFORE UPDATE ON sms_delivery_state
  FOR EACH ROW
  EXECUTE PROCEDURE update_sms_delivery_state_updated_at();

-- Minimal seed so cron does not skip users before real content is loaded.
INSERT INTO respond_day_questions (
  position,
  prompt_morning,
  prompt_evening,
  response_type,
  retry_intro_1,
  retry_intro_2,
  option_a,
  option_b,
  option_c
) VALUES (
  1,
  'Good morning. What do you want to strengthen today?',
  'What do you want to strengthen today?',
  'multiple_choice',
  'Still with this one —',
  'Quick check —',
  'Focus',
  'Discipline',
  'Confidence'
) ON CONFLICT (position) DO NOTHING;
