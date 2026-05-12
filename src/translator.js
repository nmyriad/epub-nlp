// src/translator.js
// Translates words using MyMemory (free, no key) or DeepL (free tier, API key required).
// Stores translations permanently in word-database.json — never re-translates.

import { openDb } from "./worddb.js";

const MYMEMORY_URL = "https://api.mymemory.translated.net/get";
const DEEPL_URL = "https://api-free.deepl.com/v2/translate";

// Delay between API calls to avoid rate limiting (ms)
const DELAY_MS = 150;

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

// ── MyMemory ────────────────────────────────────────────────────────────────

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
    // MyMemory sometimes returns the original word if it can't translate
    if (!translation || translation.toLowerCase() === word.toLowerCase()) return null;
    return translation.toLowerCase();
  } catch {
    return null;
  }
}

// ── DeepL ───────────────────────────────────────────────────────────────────

async function translateDeepL(word, fromLang, toLang = "eng", apiKey) {
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
        text: [word],
        source_lang: from,
        target_lang: to,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.translations?.[0]?.text?.toLowerCase() || null;
  } catch {
    return null;
  }
}

// ── Batch translate ──────────────────────────────────────────────────────────

/**
 * Translate a batch of words and store results in the database.
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

  // Only translate words that don't already have a translation
  const toTranslate = words.filter(w => !w.translation);
  skipped = words.length - toTranslate.length;

  for (let i = 0; i < toTranslate.length; i++) {
    const w = toTranslate[i];

    let result = null;
    if (provider === "deepl" && deeplKey) {
      result = await translateDeepL(w.word, fromLang, toLang, deeplKey);
    } else {
      result = await translateMyMemory(w.word, fromLang, toLang);
    }

    if (result) {
      if (db.data.words[w.word]) {
        db.data.words[w.word].translation = result;
        db.data.words[w.word].translationLang = toLang;
        db.data.words[w.word].translatedAt = new Date().toISOString();
      }
      translated++;
    } else {
      failed++;
    }

    onProgress?.(i + 1, toTranslate.length, w.word, result);

    // Rate limit
    if (i < toTranslate.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }

  await db.write();
  return { translated, failed, skipped };
}

/**
 * Estimate how many words need translation (no existing translation).
 */
export async function countUntranslated(words) {
  return words.filter(w => !w.translation).length;
}

/**
 * Get daily usage estimate for MyMemory (500 chars/request, 5000 word limit/day).
 * Returns how many words can still be translated today.
 */
export function getMyMemoryDailyLimit() {
  return 5000;
}
