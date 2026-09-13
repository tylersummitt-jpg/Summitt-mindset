# Coach Relationship Memory — Production DB / Migration Ops

## Current live state

- F V1 is item-row architecture
- live table: `public.v2_coach_relationship_memory`
- live mutation RPC: `public.v2_apply_coach_relationship_memory_mutations`
- app V1 model contract: NULL / ADD / DELETE
- app always sends: `p_updates: []`

## Applied migrations

- `supabase/migrations/20260912120000_v2_coach_relationship_memory.sql`
- `supabase/migrations/20260912130000_v2_coach_relationship_memory_items.sql`

Both were manually applied live in Supabase SQL Editor on 2026-09-12.

They are repository history, not a pending apply queue.

## NEVER REPLAY

Do not paste either migration into production again.

Especially do not replay migration 2 (`20260912130000_v2_coach_relationship_memory_items.sql`).

Migration 2's empty-table guard checks **row count**, not table shape. It does not distinguish the original blob table from the current item-row table. An empty current item table can pass the guard and reach `DROP TABLE public.v2_coach_relationship_memory`. Later `CREATE FUNCTION` can collide with the already-existing RPC.

Do not run from `DROP TABLE` downward. Do not treat "0 rows" as replay-safe.

## Deployment behavior

- git push / Vercel do not apply Supabase DDL
- app deploy is separate from DB apply
- current repo has no automatic migration runner

## Future Supabase CLI warning

If a future developer introduces `supabase db push`, `supabase db reset`, migration repair, or migration ledger reconciliation, they must explicitly reconcile these already-applied versions first.

SQL Editor application did not populate a CLI migration ledger. Do not assume these files are pending.

## Purge / account deletion

Do NOT re-run migrations 1 or 2 to modify purge behavior.

The live purge function was separately patched to delete from `public.v2_coach_relationship_memory`.

If purge behavior ever needs verification, inspect the live function directly. Do not replace it from stale historical repo copies.

## Rollback

App rollback to pre-F code is safe in the sense that old app code ignores the item table.

Do not roll the DB back by replaying migration 1.

## Weekly issue boundary

The human/TTO soak found a separate Weekly `coaching_summary` authority issue. That is NOT a CRM DB/migration issue and is intentionally out of scope here.

## Operator checklist

Before touching CRM DB in future:

1. Read this file.
2. Do NOT replay either migration.
3. Inspect live schema/function state directly.
4. Determine whether requested work needs a NEW migration or direct verified function patch.
5. If introducing Supabase CLI migration tooling, reconcile migration history first.
6. Never infer "safe to replay" from an empty table.
