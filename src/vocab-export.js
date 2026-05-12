// src/vocab-export.js
// Exports word database to:
//   - Anki-importable CSV (TSV with front/back fields)
//   - Standard CSV
//   - Top-100 adjectives and verbs text report

import fs from "fs/promises";
import path from "path";
import { markAsExported } from "./worddb.js";

// ── Anki Export ─────────────────────────────────────────────────────────────

/**
 * Export words as an Anki-importable TSV file.
 *
 * Anki's "Import" feature accepts tab-separated files where:
 *   column 1 = Front (the word)
 *   column 2 = Back (definition placeholder / metadata)
 *   column 3 = Tags (optional)
 *
 * The user imports this file into Anki via File > Import.
 * Fields are left intentionally minimal — the user fills in definitions.
 *
 * @param {object[]} words - array of word objects from worddb
 * @param {string} outputDir
 * @param {string} filename
 * @param {boolean} markExported - whether to mark words as exported after writing
 */
export async function exportToAnki(words, outputDir, filename, markExported_ = true) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);

  const lines = [
    "#separator:tab",
    "#html:false",
    "#columns:Front\tBack\tTags",
    "#notetype:Basic",
    "",
  ];

  for (const w of words) {
    const front = w.word;
    const back = `[${w.pos}] — first seen in: ${w.firstSeenBook} (${w.firstSeenChapter})`;
    const tags = `epub-nlp ${w.pos} ${slugify(w.firstSeenBook)}`;
    lines.push(`${front}\t${back}\t${tags}`);
  }

  await fs.writeFile(filePath, lines.join("\n"), "utf-8");

  if (markExported_) {
    await markAsExported(words.map((w) => w.word));
  }

  return filePath;
}

// ── Vocabulary CSV Export ───────────────────────────────────────────────────

/**
 * Export words as a standard CSV with all metadata.
 */
export async function exportToVocabCsv(words, outputDir, filename, markExported_ = true) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);

  const rows = [
    ["Word", "Part of Speech", "First Seen Book", "First Seen Chapter", "First Seen Date", "Exported"],
    ...words.map((w) => [
      w.word,
      w.pos,
      w.firstSeenBook,
      w.firstSeenChapter,
      w.firstSeenDate,
      w.exported ? "yes" : "no",
    ]),
  ];

  const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
  await fs.writeFile(filePath, csv, "utf-8");

  if (markExported_) {
    await markAsExported(words.map((w) => w.word));
  }

  return filePath;
}

// ── Top-100 Report ──────────────────────────────────────────────────────────

/**
 * Write a plain-text report of the top 100 adjectives and top 100 verbs
 * from a book analysis result.
 *
 * @param {object} bookResult - merged analysis from analyze.js
 * @param {string} outputDir
 * @param {string} filename
 */
export async function exportTopWordsReport(bookResult, outputDir, filename) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);

  const topAdj = topN(bookResult.frequency.topAdjectives, 100);
  const topVerbs = topN(bookResult.frequency.topVerbs, 100);

  const lines = [];
  const divider = "─".repeat(50);

  lines.push(`TOP WORDS REPORT — ${bookResult.bookTitle}`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push("");
  lines.push(divider);
  lines.push("TOP 100 ADJECTIVES");
  lines.push(divider);
  lines.push(formatWordList(topAdj));

  lines.push("");
  lines.push(divider);
  lines.push("TOP 100 VERBS");
  lines.push(divider);
  lines.push(formatWordList(topVerbs));

  await fs.writeFile(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function topN(freqObj, n) {
  return Object.entries(freqObj || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

function formatWordList(entries) {
  return entries
    .map(([word, count], i) => `  ${String(i + 1).padStart(3, " ")}. ${word.padEnd(30, " ")} (${count})`)
    .join("\n");
}

function csvEscape(val) {
  if (val === undefined || val === null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function slugify(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
