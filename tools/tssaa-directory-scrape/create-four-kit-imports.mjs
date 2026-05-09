#!/usr/bin/env node
/**
 * Split tssaa-kit-import-deduped.csv into four mutually exclusive Kit imports.
 * Standalone utility — writes only tools/tssaa-directory-scrape/output/kit-four-imports/
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const INPUT = path.join(__dirname, "output", "tssaa-kit-import-deduped.csv");
const OUT_DIR = path.join(__dirname, "output", "kit-four-imports");

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const TAGS = {
  athletic_directors:
    "Audience: Sports Coach; State: Tennessee; Source: TSSAA Directory; Role: Athletic Director",
  head_coaches:
    "Audience: Sports Coach; State: Tennessee; Source: TSSAA Directory; Role: Head Coach",
  assistant_coaches:
    "Audience: Sports Coach; State: Tennessee; Source: TSSAA Directory; Role: Assistant Coach",
  other_school_staff:
    "Audience: Sports Coach; State: Tennessee; Source: TSSAA Directory; Role: Other School Staff",
};

const HEADERS_OUT = [
  "email",
  "first_name",
  "last_name",
  "full_name",
  "school_name",
  "school_level",
  "role",
  "sport_or_section",
  "source_url",
  "state",
  "recommended_kit_tags",
];

/** Minimal CSV parser (RFC-style quoted fields). */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(cell);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);

  return rows;
}

function csvEscape(val) {
  if (val == null) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function combinedContext(row) {
  return normalizeSpace(
    [row.role, row.sport_or_section, row.full_name, row.school_name].join(" ")
  );
}

function isAthleticDirector(roleRaw, sportRaw, context) {
  const role = normalizeSpace(roleRaw);
  const sport = normalizeSpace(sportRaw);
  const ctx = normalizeSpace(context);
  const hay = `${role} ${sport} ${ctx}`.toLowerCase();

  const phrases = [
    "athletic director",
    "athletics director",
    "director of athletics",
    "athletic administrator",
    "athletics administrator",
    "athletic coordinator",
    "director of athletic",
  ];
  for (const p of phrases) {
    if (hay.includes(p)) return true;
  }

  const r = role;
  if (!r) return false;
  if (/^ad$/i.test(r) || /^a\.d\.?$/i.test(r)) return true;
  if (/(^|[\s(/,])ad([\s).,/]|$)/i.test(r)) return true;
  if (/(^|[\s(/,])a\.d\.([\s).,/]|$)/i.test(r)) return true;

  return false;
}

function isHeadCoach(roleRaw) {
  const role = normalizeSpace(roleRaw);
  if (!role) return false;

  const explicitHead =
    /\bhead\s+(?:varsity\s+)?(?:boys|girls|football|basketball|softball|baseball|soccer|volleyball|tennis|golf|wrestling|track|lacrosse|cross\s+country|swimming|cheer(?:leading)?|dance|bowling|rifle)?\s*coach\b/i.test(
      role
    ) ||
    /\bvarsity\s+head\s+coach\b/i.test(role) ||
    /\bco-head\s+coach\b/i.test(role);

  if (explicitHead) return true;

  if (/\bhead\b/i.test(role) && /\bcoach\b/i.test(role)) return true;

  return false;
}

function isAssistantCoach(roleRaw) {
  const role = normalizeSpace(roleRaw);
  if (!role) return false;
  if (/\bassistant\s+principal\b/i.test(role)) return false;

  const associateNonHead =
    /\bassociate\s+coach\b/i.test(role) &&
    !/\bassociate\s+head\s+coach\b/i.test(role);

  if (
    /\bassistant\s+coach\b/i.test(role) ||
    /\basst\.?\s*coach\b/i.test(role) ||
    associateNonHead ||
    /\bvolunteer\s+assistant\b/i.test(role)
  ) {
    return true;
  }

  if (/\bassistant\b/i.test(role) && /\bcoach\b/i.test(role)) return true;

  return false;
}

function classify(row) {
  const ctx = combinedContext(row);
  if (isAthleticDirector(row.role, row.sport_or_section, ctx))
    return "athletic_directors";
  if (isHeadCoach(row.role)) return "head_coaches";
  if (isAssistantCoach(row.role)) return "assistant_coaches";
  return "other_school_staff";
}

function rowToLine(obj) {
  return HEADERS_OUT.map((h) => csvEscape(obj[h] ?? "")).join(",");
}

// --- main

if (!fs.existsSync(INPUT)) {
  console.error("Missing input:", INPUT);
  process.exit(1);
}

const rawText = fs.readFileSync(INPUT, "utf8");
const table = parseCsv(rawText.replace(/^\ufeff/, ""));
if (!table.length) {
  console.error("Empty CSV");
  process.exit(1);
}

const header = table[0].map((h) => normalizeSpace(h).toLowerCase());

const emailCol = "email";

const malformedSkipped = [];

const normalizedRows = [];
for (let r = 1; r < table.length; r++) {
  const cells = table[r];
  const obj = {};
  for (let c = 0; c < header.length; c++) {
    obj[header[c]] = cells[c] ?? "";
  }

  const em = normalizeSpace(obj[emailCol] || "").toLowerCase();
  if (!em || !EMAIL_OK.test(em)) {
    malformedSkipped.push({
      row_index: r + 1,
      reason: "missing_or_bad_email",
      raw_email: obj[emailCol] ?? "",
    });
    continue;
  }
  obj._email_canonical = em;
  normalizedRows.push(obj);
}

const totalInputRows = table.length - 1;

/** Dedupe by email; first row wins */
const seen = new Map();
let duplicateDropped = 0;
for (const obj of normalizedRows) {
  const em = obj._email_canonical;
  if (seen.has(em)) {
    duplicateDropped++;
    continue;
  }
  seen.set(em, obj);
}

const uniqueList = Array.from(seen.values());
const totalUniqueEmails = uniqueList.length;

const buckets = {
  athletic_directors: [],
  head_coaches: [],
  assistant_coaches: [],
  other_school_staff: [],
};

for (const obj of uniqueList) {
  const bucket = classify(obj);

  const stateVal =
    normalizeSpace(obj.state ?? "") || "Tennessee";

  const schoolLevel = normalizeSpace(obj.school_level ?? "");

  buckets[bucket].push({
    email: obj._email_canonical,
    first_name: normalizeSpace(obj.first_name ?? ""),
    last_name: normalizeSpace(obj.last_name ?? ""),
    full_name: normalizeSpace(obj.full_name ?? ""),
    school_name: normalizeSpace(obj.school_name ?? ""),
    school_level: schoolLevel,
    role: normalizeSpace(obj.role ?? ""),
    sport_or_section: normalizeSpace(obj.sport_or_section ?? ""),
    source_url: normalizeSpace(obj.source_url ?? ""),
    state: stateVal,
    recommended_kit_tags: TAGS[bucket],
  });
}

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const files = {
  athletic_directors: path.join(OUT_DIR, "01-athletic-directors.csv"),
  head_coaches: path.join(OUT_DIR, "02-head-coaches.csv"),
  assistant_coaches: path.join(OUT_DIR, "03-assistant-coaches.csv"),
  other_school_staff: path.join(OUT_DIR, "04-other-school-staff.csv"),
};

function writeBucket(key, filepath) {
  const lines = [HEADERS_OUT.join(",")];
  for (const row of buckets[key]) lines.push(rowToLine(row));
  fs.writeFileSync(filepath, lines.join("\n") + "\n", "utf8");
}

for (const k of Object.keys(files)) writeBucket(k, files[k]);

const summaryPath = path.join(OUT_DIR, "four-import-summary.json");

const cAd = buckets.athletic_directors.length;
const cHc = buckets.head_coaches.length;
const cAc = buckets.assistant_coaches.length;
const cOt = buckets.other_school_staff.length;
const totalOut = cAd + cHc + cAc + cOt;

function firstNObjects(arr, n) {
  return arr.slice(0, n).map((o) => ({ ...o }));
}

const summary = {
  total_input_rows: totalInputRows,
  total_unique_emails: totalUniqueEmails,
  duplicate_emails_removed_count: duplicateDropped,
  malformed_or_missing_emails_skipped: malformedSkipped.length,
  malformed_skipped_details:
    malformedSkipped.length <= 50
      ? malformedSkipped
      : malformedSkipped.slice(0, 50),
  count_athletic_directors: cAd,
  count_head_coaches: cHc,
  count_assistant_coaches: cAc,
  count_other_school_staff: cOt,
  total_output_contacts: totalOut,
  total_output_equals_unique_emails: totalOut === totalUniqueEmails,
  mutual_exclusion_note:
    "Each email classified into exactly one bucket by priority AD > Head > Assistant > Other",
  preview_01_athletic_directors: firstNObjects(
    buckets.athletic_directors,
    10
  ),
  preview_02_head_coaches: firstNObjects(buckets.head_coaches, 10),
  preview_03_assistant_coaches: firstNObjects(
    buckets.assistant_coaches,
    10
  ),
  preview_04_other_school_staff: firstNObjects(
    buckets.other_school_staff,
    10
  ),
  output_files: [...Object.values(files), summaryPath],
};

fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf8");

console.log("Wrote:");
for (const p of [...Object.values(files), summaryPath]) console.log(p);
console.log(
  JSON.stringify({
    athletic_directors: cAd,
    head_coaches: cHc,
    assistant_coaches: cAc,
    other_school_staff: cOt,
    total_output_contacts: totalOut,
    total_unique_emails: totalUniqueEmails,
    match:
      totalOut === totalUniqueEmails
        ? "OK total_output equals unique_emails"
        : "MISMATCH",
  })
);
