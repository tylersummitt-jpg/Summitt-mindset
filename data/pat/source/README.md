# Pat Source Library (derived)

This folder holds **derived** Pat Summitt book source data for Summitt Mindset — not runtime Ask Pat embeddings.

## What lives here

| File | Purpose |
|------|---------|
| `books.manifest.json` | Ingestion metadata, checksums, chunk counts |
| `reach_for_the_summit.source_chunks.jsonl` | Paragraph-ordered source chunks (no embeddings) |
| `sum_it_up.source_chunks.jsonl` | Same for Sum It Up |
| `source_ingest_report.json` | QA report (warnings, sample excerpts, term search hits) |

## Raw inputs (not in git)

Place Word documents in:

```
private/pat-books/reach_for_the_summit.docx
private/pat-books/sum_it_up.docx
```

That directory is **gitignored**. Do not commit raw `.docx` files.

## Regenerate

From the repo root:

```bash
npm run pat:ingest-source -- --input-dir ./private/pat-books --output-dir ./data/pat/source
```

## What this does **not** do (yet)

- Does **not** change [Ask Pat](../../src/lib/ask-pat/) or `pat_library_with_embeddings.jsonl`
- Does **not** affect daily or inbound SMS
- Does **not** create story capsules, quote candidates, or Coaching Brief `pat_candidates`
- Does **not** include *Raise the Roof* (planned later)

## IP / privacy

This material is Pat Summitt book content. Treat generated files as **private intellectual property**. Only commit to a private repository with explicit approval.

Future approved **story capsules** and **exact quotes** for SMS should reference `chunk_id` and `source_location` from this library.
