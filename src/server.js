// src/server.js
// Local web server for the epub-nlp drag-and-drop UI

import express from "express";
import multer from "multer";
import { createServer } from "http";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs/promises";
import os from "os";
import open from "open";
import chalk from "chalk";
import { parseEpub } from "./parser.js";
import { analyzeText, mergeAnalyses } from "./analyze.js";
import { ingestBookWords, getWords, getBooks, getDbStats, markAsExported, removeBook, updateBookLanguage } from "./worddb.js";
import { exportToAnki, exportToVocabCsv, pushToAnkiConnect } from "./vocab-export.js";
import { translateWords, countUntranslated, getMyMemoryDailyLimit } from "./translator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const UPLOAD_DIR = path.join(os.tmpdir(), "epub-nlp-uploads");
const PUBLIC_DIR = path.join(__dirname, "public");

export async function startServer() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const app = express();
  const upload = multer({ dest: UPLOAD_DIR });
  app.use(express.json());

  // ── UI ────────────────────────────────────────────────────────────────────
  app.use(express.static(PUBLIC_DIR));
  app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

  // ── Analyze ───────────────────────────────────────────────────────────────
  app.post("/analyze", upload.single("epub"), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const epubPath = req.file.path + ".epub";
    await fs.rename(req.file.path, epubPath);
    const manualLanguage = req.body?.language || null;
    try {
      const parsed = await parseEpub(epubPath);
      const chapterResults = [];
      for (let i = 0; i < parsed.chapters.length; i++) {
        const ch = parsed.chapters[i];
        try {
          const result = analyzeText(ch.text, ch.id);
          result.chapterTitle = ch.title;
          result.chapterIndex = i + 1;
          chapterResults.push(result);
        } catch {}
      }
      const bookResult = mergeAnalyses(chapterResults, parsed.title);
      const { added, language } = await ingestBookWords(bookResult, manualLanguage);
      await fs.unlink(epubPath).catch(() => {});
      res.json({
        success: true,
        title: bookResult.bookTitle,
        language: language.name,
        languageCode: language.code,
        chapterCount: bookResult.chapterCount,
        summary: bookResult.summary,
        frequency: bookResult.frequency,
        entities: bookResult.entities,
        pos: {
          nouns: bookResult.pos.nouns.length,
          verbs: bookResult.pos.verbs.length,
          adjectives: bookResult.pos.adjectives.length,
          adverbs: bookResult.pos.adverbs.length,
        },
        newWords: added.length,
      });
    } catch (err) {
      await fs.unlink(epubPath).catch(() => {});
      res.status(500).json({ error: err.message });
    }
  });

  // ── Remove book ───────────────────────────────────────────────────────────
  app.delete("/book/:slug", async (req, res) => {
    try {
      const { slug } = req.params;
      const { removeWords } = req.query;
      await removeBook(slug, removeWords === "true");
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Update book language ──────────────────────────────────────────────────
  app.patch("/book/:slug/language", async (req, res) => {
    try {
      const { slug } = req.params;
      const { language } = req.body;
      await updateBookLanguage(slug, language);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── DB Stats ──────────────────────────────────────────────────────────────
  app.get("/db/stats", async (req, res) => {
    try { res.json(await getDbStats()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Export ────────────────────────────────────────────────────────────────
  app.post("/export", async (req, res) => {
    const { format, pos, book, language } = req.body;
    try {
      const filters = { unexportedOnly: false };
      if (pos && pos !== "all")           filters.pos = pos;
      if (book && book !== "all")         filters.book = book;
      if (language && language !== "all") filters.language = language;

      const words = await getWords(filters);
      if (words.length === 0) return res.status(404).json({ error: "No words match those filters." });

      const outDir = path.join(UPLOAD_DIR, "exports");
      await fs.mkdir(outDir, { recursive: true });
      const timestamp = new Date().toISOString().slice(0, 10);

      let filePath, filename;
      if (format === "anki") {
        filename = `anki_vocab_${timestamp}.txt`;
        filePath = await exportToAnki(words, outDir, filename, true);
      } else {
        filename = `vocab_${timestamp}.csv`;
        filePath = await exportToVocabCsv(words, outDir, filename, false);
      }
      res.download(filePath, filename);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Translation preview ───────────────────────────────────────────────────
  app.post("/translate/preview", async (req, res) => {
    const { pos, book, language } = req.body;
    try {
      const filters = {};
      if (pos && pos !== "all")           filters.pos = pos;
      if (book && book !== "all")         filters.book = book;
      if (language && language !== "all") filters.language = language;
      const words = await getWords(filters);
      const untranslated = await countUntranslated(words);
      res.json({
        total: words.length,
        untranslated,
        alreadyTranslated: words.length - untranslated,
        dailyLimit: getMyMemoryDailyLimit(),
        withinLimit: untranslated <= getMyMemoryDailyLimit(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Translate words ───────────────────────────────────────────────────────
  // Uses Server-Sent Events to stream progress back to the browser
  app.post("/translate", async (req, res) => {
    const { pos, book, language, fromLang, toLang, provider, deeplKey } = req.body;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
      const filters = {};
      if (pos && pos !== "all")           filters.pos = pos;
      if (book && book !== "all")         filters.book = book;
      if (language && language !== "all") filters.language = language;

      const words = await getWords(filters);
      const toTranslate = words.filter(w => !w.translation);

      if (toTranslate.length === 0) {
        send({ type: "done", translated: 0, failed: 0, skipped: words.length });
        return res.end();
      }

      send({ type: "start", total: toTranslate.length });

      const result = await translateWords(toTranslate, fromLang || language || "spa", toLang || "eng", {
        provider: provider || "mymemory",
        deeplKey,
        onProgress: (done, total, word, translation) => {
          send({ type: "progress", done, total, word, translation });
        },
      });

      send({ type: "done", ...result });
      res.end();
    } catch (err) {
      send({ type: "error", message: err.message });
      res.end();
    }
  });

  // ── AnkiConnect push ──────────────────────────────────────────────────────
  app.post("/anki/push", async (req, res) => {
    const { pos, book, language, deckName, splitByPos } = req.body;
    try {
      const filters = {};
      if (pos && pos !== "all")           filters.pos = pos;
      if (book && book !== "all")         filters.book = book;
      if (language && language !== "all") filters.language = language;

      const words = await getWords(filters);
      if (words.length === 0) return res.status(404).json({ error: "No words match those filters." });

      const result = await pushToAnkiConnect(words, deckName || "epub-nlp", splitByPos !== false);
      res.json(result);
    } catch (err) {
      // Friendly message if Anki isn't open
      if (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED")) {
        return res.status(503).json({
          error: "Anki is not open, or AnkiConnect is not installed. Please open Anki and try again."
        });
      }
      res.status(500).json({ error: err.message });
    }
  });

  // ── AnkiConnect status check ──────────────────────────────────────────────
  app.get("/anki/status", async (req, res) => {
    try {
      const resp = await fetch("http://localhost:8765", {
        method: "POST",
        body: JSON.stringify({ action: "version", version: 6 }),
        signal: AbortSignal.timeout(2000),
      });
      const data = await resp.json();
      res.json({ connected: true, version: data.result });
    } catch {
      res.json({ connected: false });
    }
  });

  const server = createServer(app);
  server.listen(PORT, () => {
    console.log(chalk.bold.cyan("\n📖 epub-nlp UI\n"));
    console.log("  " + chalk.green("✔") + " Running at " + chalk.underline.cyan(`http://localhost:${PORT}`));
    console.log("  " + chalk.dim("Press Ctrl+C to stop.\n"));
    open(`http://localhost:${PORT}`);
  });
}

