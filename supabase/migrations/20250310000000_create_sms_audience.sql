CREATE TABLE sms_audience (
  clerk_user_id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  sms_enabled BOOLEAN NOT NULL DEFAULT true,
  stopped_at TIMESTAMPTZ NULL,
  timezone TEXT NULL,
  sms_time_preference TEXT NULL,
  summitt_subscribed BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sms_audience_summitt_subscribed ON sms_audience(summitt_subscribed);
CREATE INDEX idx_sms_audience_sms_enabled ON sms_audience(sms_enabled);
CREATE INDEX idx_sms_audience_summitt_subscribed_sms_enabled ON sms_audience(summitt_subscribed, sms_enabled);

CREATE OR REPLACE FUNCTION update_sms_audience_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_sms_audience_updated_at
  BEFORE UPDATE ON sms_audience
  FOR EACH ROW
  EXECUTE PROCEDURE update_sms_audience_updated_at();
