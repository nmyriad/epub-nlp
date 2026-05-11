// src/analyze.js
// Full NLP analysis: POS tagging, phrases, named entities, sentence structure, frequency stats

import nlp from "compromise";

/**
 * Run full NLP analysis on a block of text.
 * @param {string} text
 * @param {string} chapterId
 * @returns {object} Structured analysis result
 */
export function analyzeText(text, chapterId = "unknown") {
  const doc = nlp(text);

  // ── Part-of-Speech breakdown ──────────────────────────────────────────────
  const nouns = doc.nouns().out("array");
  const verbs = doc.verbs().out("array");
  const adjectives = doc.adjectives().out("array");
  const adverbs = doc.adverbs().out("array");
  const pronouns = doc.pronouns ? doc.pronouns().out("array") : [];
  const prepositions = doc.match("#Preposition").out("array");
  const conjunctions = doc.match("#Conjunction").out("array");

  // ── Phrases ───────────────────────────────────────────────────────────────
  const nounPhrases = doc.match("#Adjective? #Noun+ (#Preposition #Noun+)?").out("array");
  const verbPhrases = doc.match("#Adverb? #Verb+ #Adverb?").out("array");
  const prepPhrases = doc.match("#Preposition #Adjective? #Noun+").out("array");

  // ── Named Entities ────────────────────────────────────────────────────────
  const people = doc.people().out("array");
  const places = doc.places().out("array");
  const organizations = doc.organizations().out("array");
  const dates = doc.dates().out("array");
  const values = doc.values ? doc.values().out("array") : [];

  // ── Sentences ─────────────────────────────────────────────────────────────
  const sentences = doc.sentences().out("array");
  const sentenceCount = sentences.length;
  const avgSentenceLength =
    sentenceCount > 0
      ? Math.round(sentences.reduce((sum, s) => sum + s.split(" ").length, 0) / sentenceCount)
      : 0;

  // Longest and shortest sentences
  const sortedBylength = [...sentences].sort((a, b) => b.split(" ").length - a.split(" ").length);
  const longestSentences = sortedBylength.slice(0, 3);
  const shortestSentences = sortedBylength.slice(-3).reverse();

  // ── Frequency Stats ───────────────────────────────────────────────────────
  const wordFrequency = buildFrequencyMap(doc.terms().out("array"));
  const nounFrequency = buildFrequencyMap(nouns);
  const verbFrequency = buildFrequencyMap(verbs);
  const adjectiveFrequency = buildFrequencyMap(adjectives);

  const topWords = topN(wordFrequency, 20);
  const topNouns = topN(nounFrequency, 10);
  const topVerbs = topN(verbFrequency, 10);
  const topAdjectives = topN(adjectiveFrequency, 10);

  // ── Summary Counts ────────────────────────────────────────────────────────
  const totalWords = doc.wordCount();
  const uniqueWords = Object.keys(wordFrequency).length;
  const lexicalDiversity = uniqueWords > 0 ? +(uniqueWords / totalWords).toFixed(4) : 0;

  return {
    chapterId,
    summary: {
      totalWords,
      uniqueWords,
      lexicalDiversity,
      sentenceCount,
      avgSentenceLength,
    },
    pos: {
      nouns: dedupe(nouns),
      verbs: dedupe(verbs),
      adjectives: dedupe(adjectives),
      adverbs: dedupe(adverbs),
      pronouns: dedupe(pronouns),
      prepositions: dedupe(prepositions),
      conjunctions: dedupe(conjunctions),
    },
    phrases: {
      nounPhrases: dedupe(nounPhrases),
      verbPhrases: dedupe(verbPhrases),
      prepositionalPhrases: dedupe(prepPhrases),
    },
    entities: {
      people: dedupe(people),
      places: dedupe(places),
      organizations: dedupe(organizations),
      dates: dedupe(dates),
      values: dedupe(values),
    },
    sentences: {
      total: sentenceCount,
      avgWordLength: avgSentenceLength,
      longestSentences,
      shortestSentences,
    },
    frequency: {
      topWords,
      topNouns,
      topVerbs,
      topAdjectives,
    },
  };
}

/**
 * Merge an array of per-chapter analyses into a single book-level result.
 */
export function mergeAnalyses(chapterResults, bookTitle) {
  const merged = {
    bookTitle,
    chapterCount: chapterResults.length,
    summary: { totalWords: 0, uniqueWords: 0, sentenceCount: 0 },
    pos: { nouns: [], verbs: [], adjectives: [], adverbs: [], pronouns: [], prepositions: [], conjunctions: [] },
    phrases: { nounPhrases: [], verbPhrases: [], prepositionalPhrases: [] },
    entities: { people: [], places: [], organizations: [], dates: [], values: [] },
    frequency: { topWords: {}, topNouns: {}, topVerbs: {}, topAdjectives: {} },
    chapters: chapterResults,
  };

  const allWords = {};
  const allNouns = {};
  const allVerbs = {};
  const allAdjectives = {};

  for (const ch of chapterResults) {
    merged.summary.totalWords += ch.summary.totalWords;
    merged.summary.sentenceCount += ch.summary.sentenceCount;

    // Merge POS
    for (const key of Object.keys(merged.pos)) {
      merged.pos[key] = dedupe([...merged.pos[key], ...(ch.pos[key] || [])]);
    }

    // Merge phrases
    for (const key of Object.keys(merged.phrases)) {
      merged.phrases[key] = dedupe([...merged.phrases[key], ...(ch.phrases[key] || [])]);
    }

    // Merge entities
    for (const key of Object.keys(merged.entities)) {
      merged.entities[key] = dedupe([...merged.entities[key], ...(ch.entities[key] || [])]);
    }

    // Accumulate frequency maps
    for (const [w, c] of Object.entries(ch.frequency.topWords)) allWords[w] = (allWords[w] || 0) + c;
    for (const [w, c] of Object.entries(ch.frequency.topNouns)) allNouns[w] = (allNouns[w] || 0) + c;
    for (const [w, c] of Object.entries(ch.frequency.topVerbs)) allVerbs[w] = (allVerbs[w] || 0) + c;
    for (const [w, c] of Object.entries(ch.frequency.topAdjectives)) allAdjectives[w] = (allAdjectives[w] || 0) + c;
  }

  merged.summary.uniqueWords = merged.pos.nouns.length + merged.pos.verbs.length + merged.pos.adjectives.length;
  merged.frequency.topWords = topN(allWords, 30);
  merged.frequency.topNouns = topN(allNouns, 15);
  merged.frequency.topVerbs = topN(allVerbs, 15);
  merged.frequency.topAdjectives = topN(allAdjectives, 15);

  return merged;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildFrequencyMap(terms) {
  const freq = {};
  for (const term of terms) {
    const t = term.toLowerCase().trim();
    if (t.length > 1) freq[t] = (freq[t] || 0) + 1;
  }
  return freq;
}

function topN(freqMap, n) {
  return Object.fromEntries(
    Object.entries(freqMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
  );
}

function dedupe(arr) {
  return [...new Set(arr.map((s) => s.trim()).filter((s) => s.length > 0))];
}
