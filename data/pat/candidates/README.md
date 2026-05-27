# Pat candidate catalog (Slice 1)

Offline, reviewable **Pat candidate** records for future use in daily SMS, inbound SMS, Ask Pat, Film Room, and Victory Room.

## What this is

| File | Purpose |
|------|---------|
| `pat_candidates.v1.json` | Catalog envelope + `candidates[]` (`draft` / `approved` / `retired`) |

Candidate types:

- **story_capsule** — Source-grounded narrative beat; no invented facts; no “Pat said” unless linked to an `exact_quote`.
- **lesson_capsule** — Coaching takeaway from the book; preferred lightweight SMS material later.
- **exact_quote** — Verbatim Pat words; only type that may use “Pat said” when `quote_attribution_allowed` is true.
- **principle_candidate** — Links to a Definite Dozen `principle_id` with book-grounded context.
- **q_and_a_insight** — Staging type for Reach for the Summit Q&A; **not** offered to SMS until promoted to lesson or exact quote.

## What this does **not** do (yet)

- Does **not** change daily or inbound SMS
- Does **not** populate Coaching Brief `pat_candidates`
- Does **not** change Ask Pat or embeddings
- Does **not** auto-generate stories

## Source grounding rules

1. Every candidate must cite `source_chunk_ids` from `data/pat/source/*.source_chunks.jsonl`.
2. `source_excerpt_preview` must be copied from actual chunk `cleaned_text` (for PR review).
3. **exact_quote_text** must appear verbatim in linked chunk text.
4. **story_capsule** / **lesson_capsule** must not contain “Pat said” or “Pat says”.
5. Do **not** use “left foot”, “right foot”, or “left foot, right foot, breathe” as Pat source phrasing (not verified in these books).
6. Q&A answers from assistants/players are **not** Pat voice unless promoted with correct attribution.

## Approval workflow

1. Search source chunks (`pat:search-source`).
2. Draft a candidate with `status: draft`.
3. Validate (`pat:validate-candidates`).
4. Tyler sets `status: approved` and `sms_allowed` only when ready.
5. Commit approved catalog to the **private** repo when IP storage is approved.

## Commands

From repo root:

```bash
npm run pat:search-source -- --query "ACL anterior cruciate" --book sum_it_up --limit 15
npm run pat:search-source -- --query "responsibility discipline" --book reach_for_the_summit --limit 20
npm run pat:search-source -- --query "hard work" --any --limit 10

npm run pat:validate-candidates
```

Optional paths:

```bash
npm run pat:validate-candidates -- --catalog ./data/pat/candidates/pat_candidates.v1.json --source-dir ./data/pat/source
```

## IP / privacy

Book-derived source chunks live in `data/pat/source/`. Candidate text is derived from that library. Treat as private intellectual property; commit only with explicit approval.
