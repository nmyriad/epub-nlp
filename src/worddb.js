// src/worddb.js
// Persistent word database — tracks words, books, and language across all analyses.

import { JSONFilePreset } from "lowdb/node";
import { franc } from "franc-min";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "..", "word-database.json");

const LANGUAGE_NAMES = {
  eng: "English", spa: "Spanish", fra: "French", deu: "German",
  ita: "Italian", por: "Portuguese", rus: "Russian", zho: "Chinese",
  jpn: "Japanese", kor: "Korean", ara: "Arabic", nld: "Dutch",
  und: "Unknown",
};

const DEFAULT_DB = {
  meta: {
    created: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalWords: 0,
    totalBooks: 0,
  },
  books: {},
  // books schema:
  // {
  //   "book-slug": {
  //     title: "La sombra del viento",
  //     slug: "book-slug",
  //     language: "spa",
  //     languageName: "Spanish",
  //     addedDate: "2026-05-12T...",
  //     wordCount: 1234,
  //   }
  // }
  words: {},
  // words schema:
  // {
  //   "novia": {
  //     word: "novia",
  //     pos: "noun",
  //     language: "spa",
  //     firstSeenBook: "La sombra del viento",
  //     firstSeenBookSlug: "book-slug",
  //     firstSeenChapter: "Chapter 3",
  //     firstSeenDate: "2026-05-12T...",
  //     exported: false,
  //   }
  // }
};

let _db = null;

export async function openDb() {
  if (_db) return _db;
  _db = await JSONFilePreset(DB_PATH, DEFAULT_DB);
  // Migrate old databases that don't have a books field
  if (!_db.data.books) {
    _db.data.books = {};
    _db.data.meta.totalBooks = 0;
    await _db.write();
  }
  return _db;
}

/**
 * Detect the dominant language of a book from its chapter text samples.
 */
function detectLanguage(bookResult) {
  // Sample text from up to 3 chapters for accuracy
  const sample = bookResult.chapters
    .slice(0, 3)
    .map((ch) => ch.text?.slice(0, 500) || "")
    .join(" ");
  const code = franc(sample) || "und";
  return { code, name: LANGUAGE_NAMES[code] || code };
}

/**
 * Build a URL-safe slug from a book title.
 */
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/**
 * Ingest words from a book result into the database.
 * @param {object} bookResult
 * @param {string|null} manualLanguageCode - optional override (e.g. "spa", "eng")
 */
export async function ingestBookWords(bookResult, manualLanguageCode = null) {
  const db = await openDb();
  const now = new Date().toISOString();
  const added = [];

  // Use manual language if provided, otherwise auto-detect
  let lang;
  if (manualLanguageCode) {
    lang = { code: manualLanguageCode, name: LANGUAGE_NAMES[manualLanguageCode] || manualLanguageCode };
  } else {
    lang = detectLanguage(bookResult);
  }

  // Register the book
  const slug = slugify(bookResult.bookTitle);
  if (!db.data.books[slug]) {
    db.data.books[slug] = {
      title: bookResult.bookTitle,
      slug,
      language: lang.code,
      languageName: lang.name,
      addedDate: now,
      wordCount: 0,
    };
  }

  // Ingest words chapter by chapter
  for (const chapter of bookResult.chapters) {
    const chapterLabel = chapter.chapterTitle || chapter.chapterId || `Chapter ${chapter.chapterIndex}`;
    const wordPos = buildWordPosMap(chapter);

    for (const [word, pos] of Object.entries(wordPos)) {
      const key = word.toLowerCase().trim();
      if (!key || key.length < 2) continue;

      if (!db.data.words[key]) {
        db.data.words[key] = {
          word: key,
          pos,
          language: lang.code,
          firstSeenBook: bookResult.bookTitle,
          firstSeenBookSlug: slug,
          firstSeenChapter: chapterLabel,
          firstSeenDate: now,
          exported: false,
        };
        added.push(key);
      }
    }
  }

  // Update book word count and meta
  db.data.books[slug].wordCount = added.length + (db.data.books[slug].wordCount || 0);
  db.data.meta.lastUpdated = now;
  db.data.meta.totalWords = Object.keys(db.data.words).length;
  db.data.meta.totalBooks = Object.keys(db.data.books).length;
  await db.write();

  return { added, skipped: Object.keys(db.data.words).length - added.length, language: lang };
}

/**
 * Get all books in the database.
 */
export async function getBooks() {
  const db = await openDb();
  return Object.values(db.data.books);
}

/**
 * Get all words, with optional filters.
 * @param {{ pos, book, language, unexportedOnly }} filters
 */
export async function getWords(filters = {}) {
  const db = await openDb();
  let words = Object.values(db.data.words);

  if (filters.pos)           words = words.filter((w) => w.pos === filters.pos);
  if (filters.book)          words = words.filter((w) => w.firstSeenBookSlug === filters.book);
  if (filters.language)      words = words.filter((w) => w.language === filters.language);
  if (filters.unexportedOnly) words = words.filter((w) => !w.exported);

  return words;
}

// Keep these as convenience wrappers for backwards compatibility
export async function getUnexportedWords() {
  return getWords({ unexportedOnly: true });
}

export async function getAllWords(pos = null) {
  return getWords({ pos: pos || undefined });
}

/**
 * Mark a list of words as exported.
 */
export async function markAsExported(words) {
  const db = await openDb();
  for (const word of words) {
    if (db.data.words[word]) db.data.words[word].exported = true;
  }
  db.data.meta.lastUpdated = new Date().toISOString();
  await db.write();
}

/**
 * Get database stats including per-book and per-language breakdowns.
 */
export async function getDbStats() {
  const db = await openDb();
  const all = Object.values(db.data.words);
  const books = Object.values(db.data.books);

  const byPos = {};
  const byLanguage = {};
  const byBook = {};

  for (const w of all) {
    byPos[w.pos] = (byPos[w.pos] || 0) + 1;
    byLanguage[w.language] = (byLanguage[w.language] || 0) + 1;
    byBook[w.firstSeenBook] = (byBook[w.firstSeenBook] || 0) + 1;
  }

  return {
    totalWords: all.length,
    totalBooks: books.length,
    unexportedWords: all.filter((w) => !w.exported).length,
    exportedWords: all.filter((w) => w.exported).length,
    byPos,
    byLanguage,
    byBook,
    books,
    lastUpdated: db.data.meta.lastUpdated,
  };
}

/**
 * Reset exported flags on matching words.
 */
export async function resetExportedFlags(filters = {}) {
  const db = await openDb();
  const toReset = await getWords(filters);
  for (const w of toReset) {
    if (db.data.words[w.word]) db.data.words[w.word].exported = false;
  }
  await db.write();
}

/**
 * Remove a book from the database.
 * @param {string} slug - book slug
 * @param {boolean} removeWords - if true, also delete all words first seen in this book
 */
export async function removeBook(slug, removeWords = false) {
  const db = await openDb();
  if (!db.data.books[slug]) throw new Error(`Book not found: ${slug}`);

  if (removeWords) {
    for (const key of Object.keys(db.data.words)) {
      if (db.data.words[key].firstSeenBookSlug === slug) {
        delete db.data.words[key];
      }
    }
  }

  delete db.data.books[slug];
  db.data.meta.totalBooks = Object.keys(db.data.books).length;
  db.data.meta.totalWords = Object.keys(db.data.words).length;
  db.data.meta.lastUpdated = new Date().toISOString();
  await db.write();
}

/**
 * Update the language of a book and all its words.
 */
export async function updateBookLanguage(slug, languageCode) {
  const db = await openDb();
  if (!db.data.books[slug]) throw new Error(`Book not found: ${slug}`);

  const langName = LANGUAGE_NAMES[languageCode] || languageCode;
  db.data.books[slug].language = languageCode;
  db.data.books[slug].languageName = langName;

  // Update all words from this book
  for (const key of Object.keys(db.data.words)) {
    if (db.data.words[key].firstSeenBookSlug === slug) {
      db.data.words[key].language = languageCode;
    }
  }

  db.data.meta.lastUpdated = new Date().toISOString();
  await db.write();
  return { languageCode, languageName: langName };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildWordPosMap(chapter) {
  const map = {};
  const posGroups = [
    { pos: "noun",      words: chapter.pos?.nouns       || [] },
    { pos: "verb",      words: chapter.pos?.verbs       || [] },
    { pos: "adjective", words: chapter.pos?.adjectives  || [] },
    { pos: "adverb",    words: chapter.pos?.adverbs     || [] },
    { pos: "pronoun",   words: chapter.pos?.pronouns    || [] },
  ];
  for (const { pos, words } of posGroups) {
    for (const word of words) {
      const key = word.toLowerCase().trim();
      if (key && key.length >= 2 && !map[key]) map[key] = pos;
    }
  }
  return map;
}
