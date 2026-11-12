-- Stored Meta ad identity and daily delivery for Subscriber Growth.
-- Read by the admin server after requireTylerAdmin.
-- Written only by ad_lab_import_batch, one transaction per import.
-- This is not the hand-entered ad_spend ledger.
-- No browser policies. service_role may read the tables and execute the import.
-- It may not insert, update, or delete the tables directly.

CREATE TABLE public.ad_lab_ads (
  account_id TEXT NOT NULL,
  meta_ad_id TEXT NOT NULL,
  ad_name TEXT NOT NULL,
  campaign_id TEXT NULL,
  campaign_name TEXT NULL,
  adset_id TEXT NULL,
  adset_name TEXT NULL,
  effective_status TEXT NULL,
  creative_id TEXT NULL,
  first_seen_on DATE NOT NULL,
  last_seen_on DATE NOT NULL,
  metadata_imported_at TIMESTAMPTZ NOT NULL,
  status_checked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ad_lab_ads_pkey PRIMARY KEY (account_id, meta_ad_id),
  CONSTRAINT ad_lab_ads_account_id_chk CHECK (account_id ~ '^[0-9]{5,20}$'),
  CONSTRAINT ad_lab_ads_meta_ad_id_chk CHECK (meta_ad_id ~ '^[0-9]{5,20}$'),
  CONSTRAINT ad_lab_ads_name_chk CHECK (
    char_length(btrim(ad_name)) > 0 AND char_length(ad_name) <= 200
  ),
  CONSTRAINT ad_lab_ads_campaign_id_chk CHECK (
    campaign_id IS NULL OR campaign_id ~ '^[0-9]{5,20}$'
  ),
  CONSTRAINT ad_lab_ads_adset_id_chk CHECK (
    adset_id IS NULL OR adset_id ~ '^[0-9]{5,20}$'
  ),
  CONSTRAINT ad_lab_ads_creative_id_chk CHECK (
    creative_id IS NULL OR creative_id ~ '^[0-9]{5,20}$'
  ),
  CONSTRAINT ad_lab_ads_campaign_name_chk CHECK (
    campaign_name IS NULL OR char_length(campaign_name) <= 200
  ),
  CONSTRAINT ad_lab_ads_adset_name_chk CHECK (
    adset_name IS NULL OR char_length(adset_name) <= 200
  ),
  CONSTRAINT ad_lab_ads_status_chk CHECK (
    effective_status IS NULL OR effective_status ~ '^[A-Z0-9_]{1,40}$'
  ),
  CONSTRAINT ad_lab_ads_seen_chk CHECK (first_seen_on <= last_seen_on)
);

CREATE TABLE public.ad_lab_daily_delivery (
  account_id TEXT NOT NULL,
  meta_ad_id TEXT NOT NULL,
  spend_date DATE NOT NULL,
  spend_cents INTEGER NULL,
  currency TEXT NOT NULL,
  account_timezone TEXT NOT NULL,
  impressions INTEGER NULL,
  outbound_clicks INTEGER NULL,
  landing_page_views INTEGER NULL,
  ad_name TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT ad_lab_daily_delivery_pkey PRIMARY KEY (account_id, meta_ad_id, spend_date),
  CONSTRAINT ad_lab_daily_delivery_ad_fk
    FOREIGN KEY (account_id, meta_ad_id)
    REFERENCES public.ad_lab_ads (account_id, meta_ad_id)
    ON DELETE RESTRICT,
  CONSTRAINT ad_lab_daily_delivery_account_id_chk CHECK (account_id ~ '^[0-9]{5,20}$'),
  CONSTRAINT ad_lab_daily_delivery_meta_ad_id_chk CHECK (meta_ad_id ~ '^[0-9]{5,20}$'),
  CONSTRAINT ad_lab_daily_delivery_spend_chk CHECK (spend_cents IS NULL OR spend_cents >= 0),
  CONSTRAINT ad_lab_daily_delivery_impressions_chk CHECK (
    impressions IS NULL OR impressions >= 0
  ),
  CONSTRAINT ad_lab_daily_delivery_clicks_chk CHECK (
    outbound_clicks IS NULL OR outbound_clicks >= 0
  ),
  CONSTRAINT ad_lab_daily_delivery_landing_chk CHECK (
    landing_page_views IS NULL OR landing_page_views >= 0
  ),
  CONSTRAINT ad_lab_daily_delivery_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  CONSTRAINT ad_lab_daily_delivery_timezone_chk CHECK (
    char_length(account_timezone) BETWEEN 1 AND 64
    AND account_timezone ~ '^[A-Za-z0-9_+-]+(/[A-Za-z0-9_+-]+)*$'
  ),
  CONSTRAINT ad_lab_daily_delivery_name_chk CHECK (
    char_length(btrim(ad_name)) > 0 AND char_length(ad_name) <= 200
  )
);

CREATE INDEX ad_lab_daily_delivery_account_date_idx
  ON public.ad_lab_daily_delivery (account_id, spend_date);

CREATE INDEX ad_lab_ads_account_status_idx
  ON public.ad_lab_ads (account_id, effective_status);

COMMENT ON TABLE public.ad_lab_ads IS
  'One durable Meta ad identity per account and ad id. '
  'Service role only. Not the manual ad_spend ledger.';

COMMENT ON TABLE public.ad_lab_daily_delivery IS
  'One Meta insights row per ad per reporting date. '
  'Null metrics were omitted by Meta. Zero means Meta reported zero. '
  'Re-import updates the same primary key. Service role only.';

ALTER TABLE public.ad_lab_ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_lab_daily_delivery ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ad_lab_ads FROM anon;
REVOKE ALL ON TABLE public.ad_lab_ads FROM authenticated;
REVOKE ALL ON TABLE public.ad_lab_ads FROM PUBLIC;
REVOKE ALL ON TABLE public.ad_lab_ads FROM service_role;

REVOKE ALL ON TABLE public.ad_lab_daily_delivery FROM anon;
REVOKE ALL ON TABLE public.ad_lab_daily_delivery FROM authenticated;
REVOKE ALL ON TABLE public.ad_lab_daily_delivery FROM PUBLIC;
REVOKE ALL ON TABLE public.ad_lab_daily_delivery FROM service_role;

GRANT SELECT ON TABLE public.ad_lab_ads TO service_role;
GRANT SELECT ON TABLE public.ad_lab_daily_delivery TO service_role;

-- One logical import is one transaction. service_role cannot write the
-- tables directly. It can only execute this function, which upserts both
-- sets and rolls back entirely if either statement fails.
-- The token never enters the database. No dynamic SQL.
-- search_path is pg_catalog only. Tables and JSON functions are schema-qualified
-- so an object in public or pg_temp cannot shadow them.
-- Seen dates only expand. Current metadata is replaced only when the incoming
-- metadata timestamp is at least as new as the stored one.

CREATE OR REPLACE FUNCTION public.ad_lab_import_batch(
  p_account_id text,
  p_ads jsonb,
  p_days jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF p_account_id IS NULL OR p_account_id !~ '^[0-9]{5,20}$' THEN
    RAISE EXCEPTION 'ad_lab_import_invalid_account'
      USING ERRCODE = '22023';
  END IF;
  IF p_ads IS NULL OR pg_catalog.jsonb_typeof(p_ads) <> 'array' OR pg_catalog.jsonb_array_length(p_ads) > 2000 THEN
    RAISE EXCEPTION 'ad_lab_import_invalid_ads'
      USING ERRCODE = '22023';
  END IF;
  IF p_days IS NULL OR pg_catalog.jsonb_typeof(p_days) <> 'array' OR pg_catalog.jsonb_array_length(p_days) > 2000 THEN
    RAISE EXCEPTION 'ad_lab_import_invalid_days'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.ad_lab_ads (
    account_id,
    meta_ad_id,
    ad_name,
    campaign_id,
    campaign_name,
    adset_id,
    adset_name,
    effective_status,
    creative_id,
    first_seen_on,
    last_seen_on,
    metadata_imported_at,
    status_checked_at,
    updated_at
  )
  SELECT
    p_account_id,
    a.meta_ad_id,
    a.ad_name,
    a.campaign_id,
    a.campaign_name,
    a.adset_id,
    a.adset_name,
    a.effective_status,
    a.creative_id,
    a.first_seen_on,
    a.last_seen_on,
    a.metadata_imported_at,
    a.status_checked_at,
    a.updated_at
  FROM (
    SELECT DISTINCT ON (meta_ad_id)
      meta_ad_id,
      ad_name,
      campaign_id,
      campaign_name,
      adset_id,
      adset_name,
      effective_status,
      creative_id,
      first_seen_on,
      last_seen_on,
      metadata_imported_at,
      status_checked_at,
      updated_at
    FROM pg_catalog.jsonb_to_recordset(p_ads) AS raw(
      meta_ad_id text,
      ad_name text,
      campaign_id text,
      campaign_name text,
      adset_id text,
      adset_name text,
      effective_status text,
      creative_id text,
      first_seen_on date,
      last_seen_on date,
      metadata_imported_at timestamptz,
      status_checked_at timestamptz,
      updated_at timestamptz
    )
    ORDER BY meta_ad_id
  ) AS a
  ON CONFLICT (account_id, meta_ad_id) DO UPDATE SET
    -- LEAST and GREATEST are conditional expressions, not pg_catalog functions.
    first_seen_on = LEAST(public.ad_lab_ads.first_seen_on, EXCLUDED.first_seen_on),
    last_seen_on = GREATEST(public.ad_lab_ads.last_seen_on, EXCLUDED.last_seen_on),
    ad_name = CASE
      WHEN EXCLUDED.metadata_imported_at >= public.ad_lab_ads.metadata_imported_at THEN EXCLUDED.ad_name
      ELSE public.ad_lab_ads.ad_name
    END,
    campaign_id = CASE
      WHEN EXCLUDED.metadata_imported_at >= public.ad_lab_ads.metadata_imported_at THEN EXCLUDED.campaign_id
      ELSE public.ad_lab_ads.campaign_id
    END,
    campaign_name = CASE
      WHEN EXCLUDED.metadata_imported_at >= public.ad_lab_ads.metadata_imported_at THEN EXCLUDED.campaign_name
      ELSE public.ad_lab_ads.campaign_name
    END,
    adset_id = CASE
      WHEN EXCLUDED.metadata_imported_at >= public.ad_lab_ads.metadata_imported_at THEN EXCLUDED.adset_id
      ELSE public.ad_lab_ads.adset_id
    END,
    adset_name = CASE
      WHEN EXCLUDED.metadata_imported_at >= public.ad_lab_ads.metadata_imported_at THEN EXCLUDED.adset_name
      ELSE public.ad_lab_ads.adset_name
    END,
    effective_status = CASE
      WHEN EXCLUDED.metadata_imported_at >= public.ad_lab_ads.metadata_imported_at THEN EXCLUDED.effective_status
      ELSE public.ad_lab_ads.effective_status
    END,
    creative_id = CASE
      WHEN EXCLUDED.metadata_imported_at >= public.ad_lab_ads.metadata_imported_at THEN EXCLUDED.creative_id
      ELSE public.ad_lab_ads.creative_id
    END,
    status_checked_at = CASE
      WHEN EXCLUDED.metadata_imported_at >= public.ad_lab_ads.metadata_imported_at THEN EXCLUDED.status_checked_at
      ELSE public.ad_lab_ads.status_checked_at
    END,
    metadata_imported_at = GREATEST(
      public.ad_lab_ads.metadata_imported_at,
      EXCLUDED.metadata_imported_at
    ),
    updated_at = GREATEST(public.ad_lab_ads.updated_at, EXCLUDED.updated_at);

  INSERT INTO public.ad_lab_daily_delivery (
    account_id,
    meta_ad_id,
    spend_date,
    spend_cents,
    currency,
    account_timezone,
    impressions,
    outbound_clicks,
    landing_page_views,
    ad_name,
    imported_at
  )
  SELECT
    p_account_id,
    d.meta_ad_id,
    d.spend_date,
    d.spend_cents,
    d.currency,
    d.account_timezone,
    d.impressions,
    d.outbound_clicks,
    d.landing_page_views,
    d.ad_name,
    d.imported_at
  FROM (
    SELECT DISTINCT ON (meta_ad_id, spend_date)
      meta_ad_id,
      spend_date,
      spend_cents,
      currency,
      account_timezone,
      impressions,
      outbound_clicks,
      landing_page_views,
      ad_name,
      imported_at
    FROM pg_catalog.jsonb_to_recordset(p_days) AS raw(
      meta_ad_id text,
      spend_date date,
      spend_cents integer,
      currency text,
      account_timezone text,
      impressions integer,
      outbound_clicks integer,
      landing_page_views integer,
      ad_name text,
      imported_at timestamptz
    )
    ORDER BY meta_ad_id, spend_date
  ) AS d
  ON CONFLICT (account_id, meta_ad_id, spend_date) DO UPDATE SET
    spend_cents = EXCLUDED.spend_cents,
    currency = EXCLUDED.currency,
    account_timezone = EXCLUDED.account_timezone,
    impressions = EXCLUDED.impressions,
    outbound_clicks = EXCLUDED.outbound_clicks,
    landing_page_views = EXCLUDED.landing_page_views,
    ad_name = EXCLUDED.ad_name,
    imported_at = EXCLUDED.imported_at;
END;
$$;

REVOKE ALL ON FUNCTION public.ad_lab_import_batch(text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ad_lab_import_batch(text, jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.ad_lab_import_batch(text, jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ad_lab_import_batch(text, jsonb, jsonb) TO service_role;
