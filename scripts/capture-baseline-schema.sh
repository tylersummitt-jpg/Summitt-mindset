#!/usr/bin/env bash
# Generate schema-only DDL from a live Postgres (e.g. Supabase) for review.
# Does NOT add or modify supabase/migrations/ — copy the output there only after review.
# Usage: export DATABASE_URL="postgresql://..." && bash scripts/capture-baseline-schema.sh [optional-output-path]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_OUT="${REPO_ROOT}/.tmp/baseline_schema_dump.sql"
OUT="${1:-$DEFAULT_OUT}"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "error: pg_dump not found. Install PostgreSQL client tools (e.g. brew install libpq)." >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: set DATABASE_URL to the source-of-truth database (read-only role recommended)." >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

pg_dump "$DATABASE_URL" \
  -n public \
  --schema-only \
  --no-owner \
  --no-privileges \
  -f "$OUT"

echo "Wrote review artifact: $OUT"
echo "After review + destructive scan, copy to supabase/migrations/ with a new timestamp if adding a baseline migration."
echo "Scan e.g.: rg -n '^(DROP|TRUNCATE)\\b|ALTER TABLE .* DROP|DELETE\\b|REVOKE\\b' '$OUT' || true"
