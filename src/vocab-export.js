// src/vocab-export.js
// Exports word database to Anki TSV, CSV, and top-100 text report.

import fs from "fs/promises";
import path from "path";
import { markAsExported } from "./worddb.js";

// ── Anki Export ─────────────────────────────────────────────────────────────

/**
 * Export words as an Anki-importable TSV file.
 *
 * Card format:
 *   Front: the word  (e.g. "novia")
 *   Back:  translation • [pos] • Book Title  (e.g. "girlfriend • [noun] • La sombra del viento")
 *   Tags:  epub-nlp  noun  la-sombra-del-viento
 */
export async function exportToAnki(words, outputDir, filename, markExported_ = true) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);

  // Filter to single clean words only
  const clean = words.filter(w => isSingleWord(w.word));

  const lines = [
    "#separator:tab",
    "#html:false",
    "#columns:Front\tBack\tTags",
    "#notetype:Basic",
    "",
  ];

  for (const w of clean) {
    const front = w.word.trim();

    // Back: translation if available, otherwise a placeholder
    const translationPart = w.translation
      ? w.translation
      : "___";
    const back = `${translationPart} • [${w.pos}] • ${w.firstSeenBook}`;
    const tags = `epub-nlp ${w.pos} ${slugify(w.firstSeenBook)}`;

    lines.push(`${front}\t${back}\t${tags}`);
  }

  await fs.writeFile(filePath, lines.join("\n"), "utf-8");

  if (markExported_) {
    await markAsExported(clean.map(w => w.word));
  }

  return filePath;
}

// ── AnkiConnect Export ───────────────────────────────────────────────────────

/**
 * Push cards directly to Anki via AnkiConnect plugin.
 * Cards are organized into sub-decks by part of speech:
 *   epub-nlp::Nouns, epub-nlp::Verbs, epub-nlp::Adjectives, etc.
 *
 * @param {object[]} words
 * @param {string} baseDeckName - base deck name (default: "epub-nlp")
 * @param {boolean} splitByPos - if true, creates sub-decks per POS (default: true)
 * @returns {{ added: number, duplicate: number, failed: number }}
 */
export async function pushToAnkiConnect(words, baseDeckName = "epub-nlp", splitByPos = true) {
  const ANKICONNECT_URL = "http://localhost:8765";

  // Filter to single clean words
  const clean = words.filter(w => isSingleWord(w.word));

  // Determine deck name per word
  const POS_DECK_NAMES = {
    noun: "Nouns",
    verb: "Verbs",
    adjective: "Adjectives",
    adverb: "Adverbs",
    pronoun: "Pronouns",
  };

  // Collect all unique deck names and create them
  const deckNames = splitByPos
    ? [...new Set(clean.map(w => `${baseDeckName}::${POS_DECK_NAMES[w.pos] || "Other"}`))]
    : [baseDeckName];

  for (const deck of deckNames) {
    await ankiRequest(ANKICONNECT_URL, "createDeck", { deck });
  }

  // Build notes
  const notes = clean.map(w => {
    const deck = splitByPos
      ? `${baseDeckName}::${POS_DECK_NAMES[w.pos] || "Other"}`
      : baseDeckName;
    return {
      deckName: deck,
      modelName: "Basic",
      fields: {
        Front: w.word.trim(),
        Back: w.translation
          ? `${w.translation} • [${w.pos}] • ${w.firstSeenBook}`
          : `___ • [${w.pos}] • ${w.firstSeenBook}`,
      },
      tags: ["epub-nlp", w.pos, slugify(w.firstSeenBook)],
      options: { allowDuplicate: false },
    };
  });

  // Check which can be added
  const canAdd = await ankiRequest(ANKICONNECT_URL, "canAddNotes", { notes });
  const toAdd = notes.filter((_, i) => canAdd[i]);
  const duplicateCount = notes.length - toAdd.length;

  if (toAdd.length === 0) {
    return { added: 0, duplicate: duplicateCount, failed: 0 };
  }

  // Add notes
  const results = await ankiRequest(ANKICONNECT_URL, "addNotes", { notes: toAdd });
  const added = results.filter(r => r !== null).length;
  const failed = results.filter(r => r === null).length;

  // Mark as exported
  await markAsExported(clean.map(w => w.word));

  return { added, duplicate: duplicateCount, failed };
}

async function ankiRequest(url, action, params = {}) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version: 6, params }),
    signal: AbortSignal.timeout(5000),
  });
  const data = await resp.json();
  if (data.error) throw new Error(`AnkiConnect: ${data.error}`);
  return data.result;
}

// ── Vocabulary CSV Export ───────────────────────────────────────────────────

export async function exportToVocabCsv(words, outputDir, filename, markExported_ = true) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);

  const rows = [
    ["Word", "Translation", "Part of Speech", "Language", "First Seen Book", "First Seen Chapter", "First Seen Date", "Exported"],
    ...words.map(w => [
      w.word,
      w.translation || "",
      w.pos,
      w.language || "",
      w.firstSeenBook,
      w.firstSeenChapter,
      w.firstSeenDate,
      w.exported ? "yes" : "no",
    ]),
  ];

  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
  await fs.writeFile(filePath, csv, "utf-8");

  if (markExported_) {
    await markAsExported(words.map(w => w.word));
  }

  return filePath;
}

// ── Top-100 Report ──────────────────────────────────────────────────────────

export async function exportTopWordsReport(bookResult, outputDir, filename) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);

  const topAdj = topN(bookResult.frequency.topAdjectives, 100);
  const topVerbs = topN(bookResult.frequency.topVerbs, 100);
  const divider = "─".repeat(50);

  const lines = [
    `TOP WORDS REPORT — ${bookResult.bookTitle}`,
    `Generated: ${new Date().toLocaleString()}`,
    "", divider, "TOP 100 ADJECTIVES", divider,
    formatWordList(topAdj), "",
    divider, "TOP 100 VERBS", divider,
    formatWordList(topVerbs),
  ];

  await fs.writeFile(filePath, lines.join("\n"), "utf-8");
  return filePath;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function isSingleWord(word) {
  if (!word || word.length < 2 || word.length > 30) return false;
  return /^[a-záéíóúüñàâçèêëîïôùûœæ''\-]+$/i.test(word.trim());
}

function topN(freqObj, n) {
  return Object.entries(freqObj || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function formatWordList(entries) {
  return entries.map(([word, count], i) =>
    `  ${String(i + 1).padStart(3, " ")}. ${word.padEnd(30, " ")} (${count})`
  ).join("\n");
}

function csvEscape(val) {
  if (val === undefined || val === null) return "";
  const s = String(val);
  return (s.includes(",") || s.includes('"') || s.includes("\n"))
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function slugify(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
