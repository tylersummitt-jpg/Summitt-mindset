#!/usr/bin/env node
/**
 * Standalone TSSAA directory scraper (local research / Kit list building).
 * Does not import from summitt-app src/.
 */

import { load } from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, "output");

const USER_AGENT =
  "SummittMindsetResearch/1.0 (contact: tyler@summittmindset.com)";

const DIRECTORY_HIGH = "https://portal.tssaa.org/common/directory/";
const DIRECTORY_MIDDLE =
  "https://portal.tssaa.org/common/directory/?type=middle";

const DELAY_MS_DEFAULT = 1500;
const MAX_RETRIES = 2;

const MAIL_HIDE_RE =
  /mail_hide\s*\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*\d+\s*,\s*"([^"]*)"\s*\)/;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function csvEscape(val) {
  if (val == null) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Extract {id, name} pairs from inline Typeahead source array. */
function extractSchoolsFromDirectoryHtml(html) {
  const startMarker = "source: [";
  const i = html.indexOf(startMarker);
  if (i === -1) return [];

  const rest = html.slice(i);
  const endMatch = rest.match(/\],\s*autoSelect:/);
  const block = endMatch ? rest.slice(0, endMatch.index + 1) : rest.slice(0, 800_000);

  const out = [];
  const entryRe =
    /\{id:\s*'(\d+)',\s*name:\s*'((?:\\'|[^'])*)'\}/g;
  let m;
  while ((m = entryRe.exec(block)) !== null) {
    const id = m[1];
    const rawName = m[2].replace(/\\'/g, "'");
    out.push({ id, directory_name_raw: rawName });
  }
  return out;
}

function decodeMailHideFromHtml(htmlSnippet) {
  const match = MAIL_HIDE_RE.exec(htmlSnippet);
  if (!match) return null;
  const localPart = match[2];
  const reversedDomain = match[3];
  const domain = reversedDomain.split("").reverse().join("");
  return `${localPart}@${domain}`;
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function isMalformedEmail(email) {
  if (!email || typeof email !== "string") return true;
  return !EMAIL_OK.test(email.trim());
}

function splitNameForKit(fullName) {
  const t = fullName.trim().replace(/\s+/g, " ");
  if (!t) return { first_name: "", last_name: "", full_name: "" };
  const parts = t.split(" ");
  if (parts.length === 1) {
    return { first_name: parts[0], last_name: "", full_name: t };
  }
  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
    full_name: t,
  };
}

async function fetchText(url, attempt = 0) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,*/*" },
    redirect: "follow",
  });

  if (res.status === 429 || res.status >= 500) {
    const wait = 5000 * (attempt + 1);
    if (attempt < MAX_RETRIES) {
      await sleep(wait);
      return fetchText(url, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} after retries`);
  }

  if (!res.ok) {
    if (attempt < MAX_RETRIES && (res.status === 408 || res.status === 502)) {
      await sleep(2000 * (attempt + 1));
      return fetchText(url, attempt + 1);
    }
    throw new Error(`HTTP ${res.status}`);
  }

  return res.text();
}

function schoolUrl(id) {
  return `${DIRECTORY_HIGH}?id=${encodeURIComponent(id)}`;
}

/**
 * Parse coach rows from a school HTML page.
 * @returns {Array<{sport_or_section: string, name: string, role: string, email: string}>}
 */
function parseSchoolPage(html) {
  const $ = load(html);
  const rows = [];

  const h2 = $("h2").first().text().trim();
  const displayName = h2 || "";

  $(".card.mb-3").each((_, card) => {
    const $card = $(card);
    const headerEl = $card.find(".card-header").first();
    const section = headerEl.text().replace(/\s+/g, " ").trim();
    if (!section) return;

    $card.find("table.tableDetail tr").each((__, tr) => {
      const $tr = $(tr);
      const tds = $tr.find("> td");
      if (tds.length < 3) return;

      const name = $(tds[0]).text().replace(/\s+/g, " ").trim();
      const role = $(tds[1]).text().replace(/\s+/g, " ").trim();
      const emailCell = $(tds[2]);
      const scriptContent =
        emailCell.find("script").first().html() ||
        emailCell.html() ||
        "";
      const email = decodeMailHideFromHtml(scriptContent);
      if (!email || isMalformedEmail(email)) return;

      rows.push({
        sport_or_section: section,
        name,
        role,
        email: email.trim().toLowerCase(),
      });
    });
  });

  return { displayName, rows };
}

function dedupeKey(r) {
  return [
    r.school_id,
    r.sport_or_section,
    r.email,
    r.role,
    r.name,
  ].join("|");
}

async function main() {
  const argv = process.argv.slice(2);
  const isSample = argv.includes("--sample");
  const isFull = argv.includes("--full");
  const schoolIdx = argv.indexOf("--school");
  const schoolOnly =
    schoolIdx >= 0 && argv[schoolIdx + 1] ? argv[schoolIdx + 1] : null;

  if (!isSample && !isFull && !schoolOnly) {
    console.error(
      "Usage: node tssaa-scrape-coaches.mjs --sample | --full | --school <id>"
    );
    process.exit(1);
  }

  await run({
    mode: schoolOnly ? "school" : isSample ? "sample" : "full",
    schoolIdOnly: schoolOnly,
  });
}

async function run(opts) {
  const runStartedAt = new Date().toISOString();
  const failures = [];

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log("Fetching directory indexes…");
  let highHtml;
  let middleHtml;
  try {
    highHtml = await fetchText(DIRECTORY_HIGH);
    middleHtml = await fetchText(DIRECTORY_MIDDLE);
  } catch (e) {
    console.error("Failed to fetch directory pages:", e);
    process.exit(1);
  }

  const highList = extractSchoolsFromDirectoryHtml(highHtml).map((s) => ({
    school_id: s.id,
    directory_name_raw: s.directory_name_raw,
    school_level: "high",
  }));

  const middleList = extractSchoolsFromDirectoryHtml(middleHtml).map(
    (s) => ({
      school_id: s.id,
      directory_name_raw: s.directory_name_raw,
      school_level: "middle",
    })
  );

  const byId = new Map();
  for (const s of highList) {
    if (!byId.has(s.school_id)) byId.set(s.school_id, { ...s });
  }
  for (const s of middleList) {
    if (!byId.has(s.school_id)) byId.set(s.school_id, { ...s });
  }

  let schools = Array.from(byId.values()).sort(
    (a, b) => Number(a.school_id) - Number(b.school_id)
  );

  const highSchoolCount = highList.length;
  const middleSchoolCount = middleList.length;
  const totalSchoolsFound = schools.length;

  if (opts.mode === "sample") {
    const sampleIds = new Set(["572", "1", "3", "6", "8"]);
    schools = schools.filter((s) => sampleIds.has(s.school_id));
    const need572 = schools.find((s) => s.school_id === "572");
    if (!need572) {
      const fromHigh = highList.find((s) => s.school_id === "572");
      if (fromHigh) schools.unshift({ ...fromHigh });
      else {
        schools.push({
          school_id: "572",
          directory_name_raw: "Webb School of Knoxville (Knoxville, TN)",
          school_level: "high",
        });
      }
    }
    schools.sort((a, b) => {
      const order = ["572", "1", "3", "6", "8"];
      const ia = order.indexOf(a.school_id);
      const ib = order.indexOf(b.school_id);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    schools = schools.slice(0, 5);
  } else if (opts.mode === "school") {
    const id = opts.schoolIdOnly;
    const found = schools.find((s) => s.school_id === id);
    schools = found
      ? [found]
      : [
          {
            school_id: id,
            directory_name_raw: "(unknown)",
            school_level: "unknown",
          },
        ];
  }

  const fullRows = [];
  const seenRow = new Set();
  let totalSchoolsScraped = 0;

  const total = schools.length;
  for (let i = 0; i < schools.length; i++) {
    const sch = schools[i];
    const url = schoolUrl(sch.school_id);
    const label =
      sch.directory_name_raw || `School ${sch.school_id}`;
    console.log(
      `[${i + 1}/${total}] Fetching ${label} (${sch.school_id})`
    );

    let html;
    try {
      html = await fetchText(url);
    } catch (err) {
      failures.push({
        school_id: sch.school_id,
        school_name: label,
        url,
        error: String(err?.message || err),
      });
      console.warn(`  → Failed: ${err}`);
      await sleep(DELAY_MS_DEFAULT);
      continue;
    }

    totalSchoolsScraped++;
    let parsed;
    try {
      parsed = parseSchoolPage(html);
    } catch (err) {
      failures.push({
        school_id: sch.school_id,
        school_name: label,
        url,
        error: `parse: ${err?.message || err}`,
      });
      await sleep(DELAY_MS_DEFAULT);
      continue;
    }

    const schoolName =
      parsed.displayName || sch.directory_name_raw.replace(/\s*\([^)]*\)\s*$/, "").trim() || label;

    if (opts.mode === "school") {
      console.log("\n--- Preview ---");
      console.log(`school_id: ${sch.school_id}`);
      console.log(`display_name (h2): ${parsed.displayName || "(none)"}`);
      console.log(`rows with email: ${parsed.rows.length}`);
      parsed.rows.slice(0, 8).forEach((r, j) => {
        console.log(
          `  ${j + 1}. [${r.sport_or_section}] ${r.name} | ${r.role} | ${r.email}`
        );
      });
      console.log("---\n");
    }

    for (const r of parsed.rows) {
      const row = {
        school_name: schoolName,
        school_id: sch.school_id,
        school_level: sch.school_level,
        sport_or_section: r.sport_or_section,
        name: r.name,
        role: r.role,
        email: r.email,
        source_url: url,
      };
      const k = dedupeKey(row);
      if (seenRow.has(k)) continue;
      seenRow.add(k);
      fullRows.push(row);
    }

    await sleep(DELAY_MS_DEFAULT);
  }

  const runFinishedAt = new Date().toISOString();

  const fullHeader = [
    "school_name",
    "school_id",
    "school_level",
    "sport_or_section",
    "name",
    "role",
    "email",
    "source_url",
  ];

  const fullCsvLines = [
    fullHeader.join(","),
    ...fullRows.map((r) =>
      [
        r.school_name,
        r.school_id,
        r.school_level,
        r.sport_or_section,
        r.name,
        r.role,
        r.email,
        r.source_url,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\n");

  const kitMap = new Map();
  for (const r of fullRows) {
    const em = r.email.toLowerCase();
    if (!kitMap.has(em)) {
      const { first_name, last_name, full_name } = splitNameForKit(r.name);
      kitMap.set(em, {
        email: em,
        first_name,
        last_name,
        full_name,
        school_name: r.school_name,
        role: r.role,
        sport_or_section: r.sport_or_section,
        source_url: r.source_url,
      });
    }
  }

  const kitHeader = [
    "email",
    "first_name",
    "last_name",
    "full_name",
    "school_name",
    "role",
    "sport_or_section",
    "source_url",
  ];

  const kitCsvLines = [
    kitHeader.join(","),
    ...Array.from(kitMap.values()).map((r) =>
      [
        r.email,
        r.first_name,
        r.last_name,
        r.full_name,
        r.school_name,
        r.role,
        r.sport_or_section,
        r.source_url,
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\n");

  const uniqueEmails = new Set(fullRows.map((r) => r.email.toLowerCase()));

  const summary = {
    run_started_at: runStartedAt,
    run_finished_at: runFinishedAt,
    total_schools_found: totalSchoolsFound,
    total_schools_scraped: totalSchoolsScraped,
    total_rows_with_emails: fullRows.length,
    total_unique_emails: uniqueEmails.size,
    failures,
    high_school_count: highSchoolCount,
    middle_school_count: middleSchoolCount,
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, "tssaa-coach-emails-full.csv"),
    fullCsvLines + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "tssaa-kit-import-deduped.csv"),
    kitCsvLines + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, "tssaa-scrape-summary.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );

  console.log("\nDone.");
  console.log(`Rows (full): ${fullRows.length}`);
  console.log(`Unique emails: ${uniqueEmails.size}`);
  console.log(`Output: ${OUTPUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
