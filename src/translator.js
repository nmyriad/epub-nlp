// src/translator.js
// Translates words using MyMemory (free, no key) or DeepL (free tier, API key required).
// DeepL uses batch requests — 50 words per API call for speed and rate limit efficiency.
// Stores translations permanently in word-database.json — never re-translates.

import { openDb } from "./worddb.js";

const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const DEEPL_URL = "https://api-free.deepl.com/v2/translate";

// DeepL batch size — max words per API call
const DEEPL_BATCH_SIZE = 50;

// Delay between batches (ms) — prevents rate limiting
const BATCH_DELAY_MS = 500;

// Delay between MyMemory calls (ms)
const MYMEMORY_DELAY_MS = 150;

const LANGUAGE_PAIRS = {
  spa: { mymemory: "es", deepl: "ES" },
  eng: { mymemory: "en", deepl: "EN" },
  fra: { mymemory: "fr", deepl: "FR" },
  deu: { mymemory: "de", deepl: "DE" },
  ita: { mymemory: "it", deepl: "IT" },
  por: { mymemory: "pt", deepl: "PT" },
  rus: { mymemory: "ru", deepl: "RU" },
  jpn: { mymemory: "ja", deepl: "JA" },
  zho: { mymemory: "zh", deepl: "ZH" },
  nld: { mymemory: "nl", deepl: "NL" },
};

// ── MyMemory (one word at a time) ────────────────────────────────────────────

async function translateMyMemory(word, fromLang, toLang = "eng") {
  const from = LANGUAGE_PAIRS[fromLang]?.mymemory || fromLang;
  const to = LANGUAGE_PAIRS[toLang]?.mymemory || toLang;
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(word)}&langpair=${from}|${to}`;

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.responseStatus !== 200) return null;
    const translation = data.responseData?.translatedText;
    if (!translation) return null;
    if (translation.toLowerCase() === word.toLowerCase()) return `${word} (cognate)`;
    return translation.toLowerCase();
  } catch {
    return null;
  }
}

// ── DeepL batch (50 words per request) ──────────────────────────────────────

/**
 * Translate a batch of up to 50 words in a single DeepL API call.
 * Returns an array of translations in the same order as the input words.
 * null means the translation failed or was identical to the source.
 */
async function translateDeepLBatch(words, fromLang, toLang = "eng", apiKey) {
  const from = LANGUAGE_PAIRS[fromLang]?.deepl || fromLang.toUpperCase();
  const to = LANGUAGE_PAIRS[toLang]?.deepl || toLang.toUpperCase();

  try {
    const resp = await fetch(DEEPL_URL, {
      method: "POST",
      headers: {
        "Authorization": `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: words,           // Array of words — DeepL handles up to 50
        source_lang: from,
        target_lang: to,
        split_sentences: "0",  // Treat each item as a single unit
        preserve_formatting: false,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const err = await resp.text();
      // Check for quota exceeded
      if (resp.status === 456) throw new Error("DeepL quota exceeded for this month.");
      if (resp.status === 429) throw new Error("DeepL rate limit hit — please wait a moment.");
      if (resp.status === 403) throw new Error("Invalid DeepL API key.");
      return words.map(() => null);
    }

    const data = await resp.json();
    const translations = data.translations || [];

    return words.map((word, i) => {
      const result = translations[i]?.text?.toLowerCase()?.trim();
      // If identical to source — it's a cognate, label it as such
      if (!result) return null;
      if (result === word.toLowerCase()) return `${word} (cognate)`;
      return result;
    });
  } catch (err) {
    // Re-throw quota/auth errors so the UI can show them
    if (err.message.includes("quota") || err.message.includes("rate limit") || err.message.includes("API key")) {
      throw err;
    }
    return words.map(() => null);
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Translate a list of word objects and store results in the database.
 *
 * DeepL: sends words in batches of 50 — dramatically fewer API calls.
 * MyMemory: sends one word at a time (API doesn't support batching).
 *
 * @param {object[]} words        - array of word objects from worddb
 * @param {string}   fromLang     - source language code (e.g. "spa")
 * @param {string}   toLang       - target language code (e.g. "eng")
 * @param {object}   options
 * @param {string}   options.provider   - "mymemory" | "deepl"
 * @param {string}   options.deeplKey   - DeepL API key (required if provider=deepl)
 * @param {Function} options.onProgress - callback(done, total, word, translation)
 * @returns {{ translated: number, failed: number, skipped: number }}
 */
export async function translateWords(words, fromLang, toLang = "eng", options = {}) {
  const { provider = "mymemory", deeplKey, onProgress } = options;

  const db = await openDb();
  let translated = 0, failed = 0, skipped = 0;

  const toTranslate = words.filter(w => !w.translation);
  skipped = words.length - toTranslate.length;

  if (provider === "deepl" && deeplKey) {
    // ── DeepL: batch mode ──────────────────────────────────────────────────
    for (let i = 0; i < toTranslate.length; i += DEEPL_BATCH_SIZE) {
      const batch = toTranslate.slice(i, i + DEEPL_BATCH_SIZE);
      const wordStrings = batch.map(w => w.word);

      let results;
      try {
        results = await translateDeepLBatch(wordStrings, fromLang, toLang, deeplKey);
      } catch (err) {
        // Fatal error (quota, auth) — stop and report
        onProgress?.(i + batch.length, toTranslate.length, "⚠ " + err.message, null);
        failed += toTranslate.length - i;
        break;
      }

      for (let j = 0; j < batch.length; j++) {
        const w = batch[j];
        const result = results[j];

        if (result && db.data.words[w.word]) {
          db.data.words[w.word].translation = result;
          db.data.words[w.word].translationLang = toLang;
          db.data.words[w.word].translatedAt = new Date().toISOString();
          translated++;
        } else {
          failed++;
        }

        onProgress?.(i + j + 1, toTranslate.length, w.word, result);
      }

      // Write after each batch so progress is saved even if interrupted
      await db.write();

      // Pause between batches
      if (i + DEEPL_BATCH_SIZE < toTranslate.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    }

  } else {
    // ── MyMemory: one at a time ────────────────────────────────────────────
    for (let i = 0; i < toTranslate.length; i++) {
      const w = toTranslate[i];
      const result = await translateMyMemory(w.word, fromLang, toLang);

      if (result && db.data.words[w.word]) {
        db.data.words[w.word].translation = result;
        db.data.words[w.word].translationLang = toLang;
        db.data.words[w.word].translatedAt = new Date().toISOString();
        translated++;
      } else {
        failed++;
      }

      onProgress?.(i + 1, toTranslate.length, w.word, result);

      if (i < toTranslate.length - 1) {
        await new Promise(r => setTimeout(r, MYMEMORY_DELAY_MS));
      }
    }

    await db.write();
  }

  return { translated, failed, skipped };
}

/**
 * Count words that haven't been translated yet.
 */
export async function countUntranslated(words) {
  return words.filter(w => !w.translation).length;
}

/**
 * MyMemory daily word limit.
 */
export function getMyMemoryDailyLimit() {
  return 5000;
}
