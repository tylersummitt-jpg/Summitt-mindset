-- Local only. Git push does not run this file. Do not execute until reviewed.
-- Applying this file does not send email, call Instantly, or change a campaign.
-- Import state is one row of settings plus domain blocks. Removal from Instantly does not delete either.

ALTER TABLE public.acquisition_settings
  ADD COLUMN instantly_block_import_cursor TEXT NULL,
  ADD COLUMN instantly_block_import_cycle INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN instantly_block_import_completed_cycle INTEGER NULL,
  ADD COLUMN instantly_block_import_completed_at TIMESTAMPTZ NULL,
  ADD COLUMN instantly_block_import_error TEXT NULL,
  ADD COLUMN instantly_block_import_pages INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN instantly_block_import_claim_until TIMESTAMPTZ NULL,
  ADD COLUMN instantly_block_import_generation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.acquisition_settings
  ADD CONSTRAINT acquisition_settings_block_import_cursor_chk CHECK (
    instantly_block_import_cursor IS NULL
    OR (
      char_length(instantly_block_import_cursor) BETWEEN 1 AND 200
      AND instantly_block_import_cursor !~ '\s'
    )
  ),
  ADD CONSTRAINT acquisition_settings_block_import_cycle_chk CHECK (
    instantly_block_import_cycle >= 0
  ),
  ADD CONSTRAINT acquisition_settings_block_import_completed_cycle_chk CHECK (
    instantly_block_import_completed_cycle IS NULL
    OR instantly_block_import_completed_cycle >= 0
  ),
  ADD CONSTRAINT acquisition_settings_block_import_error_chk CHECK (
    instantly_block_import_error IS NULL
    OR char_length(instantly_block_import_error) BETWEEN 1 AND 80
  ),
  ADD CONSTRAINT acquisition_settings_block_import_pages_chk CHECK (
    instantly_block_import_pages >= 0
  ),
  ADD CONSTRAINT acquisition_settings_block_import_generation_chk CHECK (
    instantly_block_import_generation >= 0
  );

COMMENT ON COLUMN public.acquisition_settings.instantly_block_import_cursor IS
  'Last Instantly block-list cursor committed after a fully applied page. Null starts at the first page.';

COMMENT ON COLUMN public.acquisition_settings.instantly_block_import_completed_at IS
  'When a full block-list walk last finished. A past value is not permission to send on a later run.';

COMMENT ON COLUMN public.acquisition_settings.instantly_block_import_error IS
  'Short import error. invalid_entry means a block-list row could not be interpreted, the cursor stayed put, and automatic sends stay held.';

COMMENT ON COLUMN public.acquisition_settings.instantly_block_import_claim_until IS
  'Lease deadline for the invocation that owns the import. Progress renews it. An expired lease cannot commit.';

CREATE TABLE public.acquisition_blocked_domains (
  domain TEXT PRIMARY KEY,
  provider_entry_id TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT acquisition_blocked_domains_domain_chk CHECK (
    char_length(domain) BETWEEN 4 AND 253
    AND domain = lower(domain)
    AND position('@' in domain) = 0
    AND domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  CONSTRAINT acquisition_blocked_domains_entry_chk CHECK (
    char_length(provider_entry_id) BETWEEN 1 AND 80
  )
);

ALTER TABLE public.acquisition_blocked_domains ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.acquisition_blocked_domains FROM anon, authenticated, PUBLIC, service_role;

GRANT SELECT, INSERT, UPDATE ON TABLE public.acquisition_blocked_domains TO service_role;

COMMENT ON TABLE public.acquisition_blocked_domains IS
  'Domains seen on the Instantly block list. Rows are not deleted when Instantly removes the entry. This table does not send email.';

CREATE INDEX acquisition_people_email_domain_idx
  ON public.acquisition_people ((split_part(email_normalized, '@', 2)));

-- One statement cancels scheduled and expired claimed actions for an exact domain.
-- It does not load people into the application, and it does not change accepted or delivered rows.
CREATE FUNCTION public.acquisition_cancel_domain_outbound(p_domain text, p_now timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_domain IS NULL
     OR char_length(p_domain) < 4
     OR char_length(p_domain) > 253
     OR p_domain <> lower(p_domain)
     OR position('@' in p_domain) > 0
     OR p_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'invalid_domain';
  END IF;

  UPDATE public.acquisition_people AS person
  SET next_action_type = NULL,
      next_action_at = NULL,
      updated_at = p_now
  WHERE split_part(person.email_normalized, '@', 2) = p_domain
    AND EXISTS (
      SELECT 1
      FROM public.acquisition_actions AS action
      WHERE action.person_id = person.id
        AND (
          action.status = 'scheduled'
          OR (
            action.status = 'claimed'
            AND (action.claim_until IS NULL OR action.claim_until <= p_now)
          )
        )
    );

  UPDATE public.acquisition_actions AS action
  SET status = 'canceled',
      claim_until = NULL,
      updated_at = p_now
  FROM public.acquisition_people AS person
  WHERE action.person_id = person.id
    AND action.status = 'scheduled'
    AND split_part(person.email_normalized, '@', 2) = p_domain;

  UPDATE public.acquisition_actions AS action
  SET status = 'canceled',
      claim_until = NULL,
      updated_at = p_now
  FROM public.acquisition_people AS person
  WHERE action.person_id = person.id
    AND action.status = 'claimed'
    AND (action.claim_until IS NULL OR action.claim_until <= p_now)
    AND split_part(person.email_normalized, '@', 2) = p_domain;
END;
$$;

REVOKE ALL ON FUNCTION public.acquisition_cancel_domain_outbound(text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquisition_cancel_domain_outbound(text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.acquisition_cancel_domain_outbound(text, timestamptz) IS
  'Cancels scheduled and expired claimed acquisition actions for one exact email domain. Does not send email and does not change accepted or delivered actions.';

-- Rollback, only after this import code is no longer deployed:
-- DROP FUNCTION public.acquisition_cancel_domain_outbound(text, timestamptz);
-- DROP INDEX public.acquisition_people_email_domain_idx;
-- DROP TABLE public.acquisition_blocked_domains;
-- then DROP the eight instantly_block_import settings columns above.
