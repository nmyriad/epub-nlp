// src/worddb.js
// Persistent word database — tracks first occurrence of every word across all books.
// Stored as a local JSON file (word-database.json) in the project root.

import { JSONFilePreset } from "lowdb/node";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "word-database.json");

const DEFAULT_DB = {
  meta: {
    created: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalWords: 0,
  },
  words: {},
  // words schema:
  // {
  //   "novia": {
  //     word: "novia",
  //     pos: "noun",
  //     firstSeenBook: "Cien años de soledad",
  //     firstSeenChapter: "Chapter 3",
  //     firstSeenDate: "2026-05-11T...",
  //     exported: false,
  //   }
  // }
};

let _db = null;

export async function openDb() {
  if (_db) return _db;
  _db = await JSONFilePreset(DB_PATH, DEFAULT_DB);
  return _db;
}

/**
 * Given the analysis result for a book, find all words not yet in the database
 * and add them as new entries. Returns a summary of what was added.
 *
 * @param {object} bookResult - merged book analysis from analyze.js
 * @returns {{ added: string[], skipped: number }}
 */
export async function ingestBookWords(bookResult) {
  const db = await openDb();
  const now = new Date().toISOString();
  const added = [];

  // We iterate chapter by chapter so we can record first-seen chapter accurately
  for (const chapter of bookResult.chapters) {
    const chapterLabel = chapter.chapterTitle || chapter.chapterId || `Chapter ${chapter.chapterIndex}`;

    // Build a map of word -> POS for this chapter
    const wordPos = buildWordPosMap(chapter);

    for (const [word, pos] of Object.entries(wordPos)) {
      const key = word.toLowerCase().trim();
      if (!key || key.length < 2) continue;

      // Only add if not already in the database
      if (!db.data.words[key]) {
        db.data.words[key] = {
          word: key,
          pos,
          firstSeenBook: bookResult.bookTitle,
          firstSeenChapter: chapterLabel,
          firstSeenDate: now,
          exported: false,
        };
        added.push(key);
      }
    }
  }

  const skipped = Object.keys(db.data.words).length - added.length;
  db.data.meta.lastUpdated = now;
  db.data.meta.totalWords = Object.keys(db.data.words).length;
  await db.write();

  return { added, skipped };
}

/**
 * Get all words that haven't been exported yet.
 */
export async function getUnexportedWords() {
  const db = await openDb();
  return Object.values(db.data.words).filter((w) => !w.exported);
}

/**
 * Get all words, optionally filtered by POS.
 */
export async function getAllWords(pos = null) {
  const db = await openDb();
  const all = Object.values(db.data.words);
  if (pos) return all.filter((w) => w.pos === pos);
  return all;
}

/**
 * Mark a list of words as exported.
 */
export async function markAsExported(words) {
  const db = await openDb();
  for (const word of words) {
    if (db.data.words[word]) {
      db.data.words[word].exported = true;
    }
  }
  db.data.meta.lastUpdated = new Date().toISOString();
  await db.write();
}

/**
 * Get database stats.
 */
export async function getDbStats() {
  const db = await openDb();
  const all = Object.values(db.data.words);
  const unexported = all.filter((w) => !w.exported);
  const byPos = {};
  for (const w of all) {
    byPos[w.pos] = (byPos[w.pos] || 0) + 1;
  }
  return {
    totalWords: all.length,
    unexportedWords: unexported.length,
    exportedWords: all.length - unexported.length,
    byPos,
    lastUpdated: db.data.meta.lastUpdated,
  };
}

/**
 * Reset exported flag on all words (so they can be re-exported).
 */
export async function resetExportedFlags() {
  const db = await openDb();
  for (const key of Object.keys(db.data.words)) {
    db.data.words[key].exported = false;
  }
  await db.write();
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a flat word → POS map from a chapter analysis result.
 * Priority: nouns > verbs > adjectives > adverbs > other
 */
function buildWordPosMap(chapter) {
  const map = {};

  const posGroups = [
    { pos: "noun", words: chapter.pos?.nouns || [] },
    { pos: "verb", words: chapter.pos?.verbs || [] },
    { pos: "adjective", words: chapter.pos?.adjectives || [] },
    { pos: "adverb", words: chapter.pos?.adverbs || [] },
    { pos: "pronoun", words: chapter.pos?.pronouns || [] },
  ];

  for (const { pos, words } of posGroups) {
    for (const word of words) {
      const key = word.toLowerCase().trim();
      if (key && key.length >= 2 && !map[key]) {
        map[key] = pos;
      }
    }
  }

  return map;
}
