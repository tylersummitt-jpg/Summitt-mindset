# TSSAA directory coach email scraper

Standalone **local** utility. It is **not** part of the Summitt Mindset application and does not use app `src/`, env, or deployment config.

## What it does

- Downloads the TSSAA public high school and middle school directory index pages.
- Parses the embedded Bootstrap Typeahead `source` arrays to obtain school IDs and names.
- Fetches each school’s public directory page and extracts coach/staff rows that include emails.
- Emails are decoded from inline `mail_hide(...)` calls (the site does not expose plain `@` addresses in raw HTML).
- Writes CSV files and a JSON summary under `output/`.

## What it does not do

- It does **not** send email, sync to Kit automatically, or touch Supabase, Stripe, SMS, or auth.
- It does **not** collect phone numbers (they may appear on the site; this script does not put them in the CSV).
- It does not bypass paywalls or log in; it only requests the same public URLs you can open in a browser.

Respect TSSAA’s servers: the script waits **1.5 seconds** between school page requests and retries gently on errors.

## Requirements

- Node.js 18+ (global `fetch`)
- One-time install in this folder:

```bash
cd tools/tssaa-directory-scrape
npm install
```

## How to run

From the **repository root**:

```bash
node tools/tssaa-directory-scrape/tssaa-scrape-coaches.mjs --sample
```

**Sample mode** — a handful of schools (includes ID `572`) for testing.

```bash
node tools/tssaa-directory-scrape/tssaa-scrape-coaches.mjs --full
```

**Full mode** — all high and middle schools listed in both directory pages. **Only run after you intentionally approve** a statewide crawl.

**Single-school debug:**

```bash
node tools/tssaa-directory-scrape/tssaa-scrape-coaches.mjs --school 572
```

## Outputs

| File | Description |
|------|-------------|
| `output/tssaa-coach-emails-full.csv` | One row per staff line with email (deduped by school + section + name + role + email). |
| `output/tssaa-kit-import-deduped.csv` | One row per **email** (first occurrence wins), with `first_name` / `last_name` split from the name field. |
| `output/tssaa-scrape-summary.json` | Counts, timestamps, and any fetch/parse failures. |

## Importing the deduped CSV into Kit (ConvertKit)

1. In Kit: **Subscribers → Import subscribers** (or your list’s import flow).
2. Upload `tssaa-kit-import-deduped.csv`.
3. Map columns: email, name fields, and custom fields if you add them later.
4. Apply the tag: **Audience: Coach Prospect** (or your agreed tag name).
5. Send in **small batches** over time to protect deliverability and engagement; avoid one massive blast.

## Ethics and use

Data comes from **publicly listed** school directory pages (professional contact context). Use only for legitimate outreach that complies with anti-spam law and Kit’s policies.
