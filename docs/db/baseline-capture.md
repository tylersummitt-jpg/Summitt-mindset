# Baseline schema capture (prep)

## What this repo contains today

- **Runbook (this file)** and **`scripts/capture-baseline-schema.sh`** so an operator can generate **real** schema-only SQL from a live database.
- **No baseline migration file** is committed until someone runs capture and adds one **on purpose** under `supabase/migrations/`.

**Baseline capture is not complete** until a machine-generated dump is produced with a real `DATABASE_URL` and reviewed.

## Source of truth

- **Preferred:** **Production** (or a **read replica** with the same schema), using a **direct / session** Postgres URL if your pooler cannot run `pg_dump`.
- **Staging** is acceptable only if the team **explicitly** accepts **prod/staging drift** and plans a prod capture when ready.

Record which database you used in the PR that adds the migration file.

## Operator workflow (next step)

1. Install PostgreSQL client tools (`pg_dump` on your `PATH`).
2. **Do not commit secrets.** In your shell only: `export DATABASE_URL="postgresql://…"`.
3. From the repo root run:
   - `npm run db:capture-baseline`, or
   - `bash scripts/capture-baseline-schema.sh`  
   Optional: `bash scripts/capture-baseline-schema.sh /path/to/review.sql` to choose another output file.
4. The script writes a **review artifact** to **`.tmp/baseline_schema_dump.sql`** (directory is **gitignored** so dumps are not committed by accident). Inspect it; run a **destructive scan** before any copy into migrations:
   - e.g. `rg -n '^(DROP|TRUNCATE)\b|ALTER TABLE .* DROP|DELETE\b|REVOKE\b' .tmp/baseline_schema_dump.sql`
5. When satisfied, **copy** the file to a **new** migration filename in `supabase/migrations/` (e.g. `YYYYMMDDHHMMSS_baseline_production_schema.sql`) in a **separate PR** that only adds real, generated SQL.
6. **Before merging that PR:** think through **fresh `supabase db reset` / apply order** (a full dump may duplicate `CREATE`s from older migrations) and whether **`supabase migration repair`** (or your org’s process) is needed. Coordinate with whoever owns production apply order.

## Alternative: Supabase CLI

If the project is **linked** and your CLI version supports it, you may use **`supabase db dump`** (or equivalent) to emit the same kind of **schema-only** output—still **not** hand-written DDL.

## Deferred (not baseline prep)

Adding **new** constraints or indexes on hot tables—separate PR after real DDL is in the repo.
