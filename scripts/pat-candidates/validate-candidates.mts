#!/usr/bin/env node
/**
 * Validate Pat candidate catalog against schema rules and source chunk IDs.
 *
 * Usage (from repo root):
 *   npm run pat:validate-candidates
 *   npm run pat:validate-candidates -- --catalog ./data/pat/candidates/pat_candidates.v1.json --source-dir ./data/pat/source
 */

import { readFileSync } from "fs";
import { resolve } from "path";

import { loadPatSourceChunkIndex } from "../../src/lib/pat-candidates/load-source-index.ts";
import {
  parsePatCandidatesCatalogJson,
  validatePatCandidatesCatalog,
} from "../../src/lib/pat-candidates/validate.ts";

function parseArgs(argv: string[]) {
  let catalogPath = "./data/pat/candidates/pat_candidates.v1.json";
  let sourceDir = "./data/pat/source";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--catalog" && argv[i + 1]) {
      catalogPath = argv[++i]!;
    } else if (a === "--source-dir" && argv[i + 1]) {
      sourceDir = argv[++i]!;
    }
  }

  return {
    catalogPath: resolve(process.cwd(), catalogPath),
    sourceDir: resolve(process.cwd(), sourceDir),
  };
}

function main() {
  const { catalogPath, sourceDir } = parseArgs(process.argv.slice(2));

  const raw = readFileSync(catalogPath, "utf8");
  const catalog = parsePatCandidatesCatalogJson(raw);
  const sourceIndex = loadPatSourceChunkIndex(sourceDir);
  const result = validatePatCandidatesCatalog(catalog, sourceIndex);

  const lines: string[] = [];
  lines.push(`Catalog: ${catalogPath}`);
  lines.push(`Source dir: ${sourceDir} (loaded: ${sourceIndex.loaded})`);
  lines.push(`Candidates: ${catalog.candidates.length}`);
  lines.push(`Errors: ${result.errors.length}`);
  lines.push(`Warnings: ${result.warnings.length}`);

  for (const w of result.warnings) {
    const who = w.candidate_id ? `[${w.candidate_id}] ` : "";
    lines.push(`WARN ${who}${w.code}: ${w.message}`);
  }
  for (const e of result.errors) {
    const who = e.candidate_id ? `[${e.candidate_id}] ` : "";
    lines.push(`ERROR ${who}${e.code}: ${e.message}`);
  }

  console.log(lines.join("\n"));

  if (!result.ok) {
    process.exit(1);
  }
}

main();
