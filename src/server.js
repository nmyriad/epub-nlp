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

export async function startServer() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const app = express();
  const upload = multer({ dest: UPLOAD_DIR });
  app.use(express.json());

  // ── UI ────────────────────────────────────────────────────────────────────
  app.get("/", (req, res) => res.send(getHtml()));

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

function getHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>epub-nlp</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e8e8e8;min-height:100vh;padding:2rem}
  header{text-align:center;margin-bottom:2rem}
  header h1{font-size:2rem;font-weight:700;color:#fff}
  header p{color:#888;margin-top:.4rem;font-size:.95rem}
  .container{max-width:900px;margin:0 auto}

  /* DB Bar */
  #dbBar{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:1rem 1.5rem;margin-bottom:1.5rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem}
  .db-stats{display:flex;gap:2rem;flex-wrap:wrap}
  .db-stat{text-align:center}
  .db-stat .n{font-size:1.4rem;font-weight:700;color:#58a6ff}
  .db-stat .l{font-size:.72rem;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-top:.1rem}

  /* Drop zone */
  #dropzone{border:2px dashed #333;border-radius:16px;padding:3rem 2rem;text-align:center;cursor:pointer;transition:all .2s;background:#161b22;margin-bottom:1.5rem}
  #dropzone.dragover{border-color:#58a6ff;background:#1c2a3a}
  #dropzone .icon{font-size:3rem;margin-bottom:1rem}
  #dropzone h2{font-size:1.1rem;font-weight:600;color:#fff;margin-bottom:.4rem}
  #dropzone p{color:#666;font-size:.9rem}
  .browse{color:#58a6ff;text-decoration:underline;cursor:pointer}
  #fileInput{display:none}

  /* Progress */
  #progress{display:none;text-align:center;padding:2rem;background:#161b22;border-radius:16px;margin-bottom:1.5rem}
  .spinner{width:40px;height:40px;border:3px solid #333;border-top-color:#58a6ff;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1rem}
  @keyframes spin{to{transform:rotate(360deg)}}

  /* Results */
  #results{display:none}
  .book-header{margin-bottom:1.5rem}
  .book-title{font-size:1.4rem;font-weight:700;color:#fff}
  .book-meta{display:flex;gap:.75rem;margin-top:.4rem;flex-wrap:wrap}
  .badge{background:#21262d;border-radius:20px;padding:.2rem .75rem;font-size:.78rem;color:#aaa}
  .badge.lang{background:#1f3a1f;color:#4caf50}
  .badge.new{background:#1f3a5f;color:#58a6ff}

  .stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1rem;margin-bottom:1.5rem}
  .stat-card{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:1.25rem;text-align:center}
  .stat-card .num{font-size:1.6rem;font-weight:700;color:#58a6ff}
  .stat-card .lbl{font-size:.75rem;color:#666;margin-top:.3rem;text-transform:uppercase;letter-spacing:.5px}

  /* Export panel */
  .export-panel{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem}
  .export-panel h3{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:1rem}
  .filter-row{display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;align-items:flex-end}
  .filter-group{display:flex;flex-direction:column;gap:.35rem;min-width:150px}
  .filter-group label{font-size:.78rem;color:#666;text-transform:uppercase;letter-spacing:.5px}
  select{background:#0f1117;color:#e8e8e8;border:1px solid #30363d;border-radius:8px;padding:.5rem .75rem;font-size:.875rem;cursor:pointer;width:100%}
  select:focus{outline:none;border-color:#58a6ff}
  .export-btns{display:flex;gap:.75rem;flex-wrap:wrap}
  .btn{padding:.6rem 1.2rem;border-radius:8px;border:none;font-size:.875rem;font-weight:600;cursor:pointer;transition:opacity .15s;text-decoration:none;display:inline-flex;align-items:center;gap:.4rem}
  .btn:hover{opacity:.85}
  .btn-anki{background:#238636;color:#fff}
  .btn-csv{background:#21262d;color:#e8e8e8;border:1px solid #30363d}
  .btn-outline{background:transparent;color:#58a6ff;border:1px solid #58a6ff;padding:.35rem .9rem;font-size:.8rem}
  .btn-translate{background:#6e40c9;color:#fff}
  .btn-ankiconnect{background:#1a6b9a;color:#fff}

  /* Word sections */
  .section{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:1.5rem;margin-bottom:1rem}
  .section h3{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:1rem}
  .word-list{display:flex;flex-wrap:wrap;gap:.5rem}
  .word-tag{background:#21262d;border-radius:6px;padding:.3rem .7rem;font-size:.85rem;color:#e8e8e8}
  .word-tag .cnt{color:#58a6ff;font-size:.75rem;margin-left:.3rem}

  /* Entities */
  .entity-group{margin-bottom:.75rem}
  .entity-group .type{color:#888;font-size:.78rem;margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.5px}

  /* Error */
  .error-msg{background:#2d1515;border:1px solid #6e2020;border-radius:12px;padding:1rem 1.5rem;color:#f87171;margin-bottom:1.5rem;display:none}

  /* Books list */
  #booksList{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem;display:none}
  #booksList h3{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:1rem}
  .book-row{display:flex;align-items:center;justify-content:space-between;padding:.75rem 0;border-bottom:1px solid #21262d;gap:1rem;flex-wrap:wrap}
  .book-row:last-child{border-bottom:none}
  .book-row .book-name{font-size:.9rem;color:#e8e8e8;flex:1}
  .book-row .book-info{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
  .btn-danger{background:transparent;color:#f87171;border:1px solid #6e2020;padding:.25rem .7rem;font-size:.78rem;border-radius:6px;cursor:pointer}
  .btn-danger:hover{background:#2d1515}
  .btn-edit{background:transparent;color:#888;border:1px solid #30363d;padding:.25rem .7rem;font-size:.78rem;border-radius:6px;cursor:pointer}
  .btn-edit:hover{color:#e8e8e8;border-color:#888}

  /* Language picker on drop */
  #langPicker{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1rem;display:none}
  #langPicker label{font-size:.8rem;color:#888;text-transform:uppercase;letter-spacing:.5px;display:block;margin-bottom:.5rem}
  #langPicker .lang-row{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap}
  #langPicker select{flex:1;min-width:180px}
  #langPicker p{font-size:.78rem;color:#555;margin-top:.4rem}

  /* Translation panel */
  .translate-panel{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:1.5rem;margin-bottom:1.5rem}
  .translate-panel h3{font-size:.8rem;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:1rem}
  .preview-box{background:#0f1117;border:1px solid #21262d;border-radius:8px;padding:1rem;margin-bottom:1rem;font-size:.875rem}
  .preview-box .big{font-size:1.4rem;font-weight:700;color:#58a6ff}
  .preview-box .sub{color:#666;font-size:.8rem;margin-top:.25rem}
  .preview-box .warn{color:#f0a500;font-size:.8rem;margin-top:.5rem}
  .progress-bar{background:#21262d;border-radius:4px;height:6px;margin:1rem 0;overflow:hidden;display:none}
  .progress-bar-fill{background:#6e40c9;height:100%;width:0%;transition:width .3s}
  .progress-status{font-size:.8rem;color:#888;margin-bottom:.5rem;display:none}
  .anki-status{font-size:.78rem;padding:.3rem .75rem;border-radius:20px;display:inline-flex;align-items:center;gap:.4rem}
  .anki-connected{background:#1a3a1a;color:#4caf50;border:1px solid #2a5a2a}
  .anki-disconnected{background:#2d1515;color:#f87171;border:1px solid #6e2020}
  .provider-row{display:flex;gap:1rem;margin-bottom:1rem;flex-wrap:wrap;align-items:flex-end}
  .deepl-key{display:none;flex:1}
  .deepl-key input{width:100%;background:#0f1117;color:#e8e8e8;border:1px solid #30363d;border-radius:8px;padding:.5rem .75rem;font-size:.875rem}

  a.reset-link{display:block;text-align:center;color:#58a6ff;cursor:pointer;font-size:.875rem;text-decoration:underline;margin-top:1.5rem}
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>📖 epub-nlp</h1>
    <p>Drag and drop an EPUB to analyze vocabulary, phrases, and entities</p>
  </header>

  <div id="dbBar">
    <div class="db-stats">
      <div class="db-stat"><div class="n" id="dbTotal">—</div><div class="l">Words</div></div>
      <div class="db-stat"><div class="n" id="dbBooks">—</div><div class="l">Books</div></div>
      <div class="db-stat"><div class="n" id="dbUnexported">—</div><div class="l">New (unexported)</div></div>
    </div>
    <button class="btn-outline btn" onclick="toggleBooks()">📚 My Library</button>
  </div>

  <div id="booksList">
    <h3>Books in Database</h3>
    <div id="booksContent"></div>
  </div>

  <div class="error-msg" id="errorMsg"></div>

  <div id="langPicker">
    <label>Book Language</label>
    <div class="lang-row">
      <select id="manualLang">
        <option value="">Auto-detect</option>
        <option value="spa">Spanish</option>
        <option value="eng">English</option>
        <option value="fra">French</option>
        <option value="deu">German</option>
        <option value="ita">Italian</option>
        <option value="por">Portuguese</option>
        <option value="rus">Russian</option>
        <option value="jpn">Japanese</option>
        <option value="zho">Chinese</option>
        <option value="ara">Arabic</option>
        <option value="nld">Dutch</option>
      </select>
    </div>
    <p>Select a language if auto-detection is wrong, or leave as Auto-detect.</p>
  </div>

  <div id="dropzone">
    <div class="icon">📚</div>
    <h2>Drop your EPUB here</h2>
    <p>or <span class="browse" onclick="document.getElementById('fileInput').click()">browse for a file</span></p>
    <p style="margin-top:.5rem;font-size:.8rem;color:#444">.epub files only</p>
    <input type="file" id="fileInput" accept=".epub">
  </div>

  <div id="progress">
    <div class="spinner"></div>
    <p>Analyzing your book — this may take a minute...</p>
  </div>

  <div id="results">
    <div class="book-header">
      <div class="book-title" id="bookTitle"></div>
      <div class="book-meta" id="bookMeta"></div>
    </div>

    <div class="stats-grid" id="statsGrid"></div>

    <!-- Translation Panel -->
    <div class="translate-panel">
      <h3>🌐 Translate & Export</h3>

      <div class="filter-row">
        <div class="filter-group">
          <label>Part of Speech</label>
          <select id="filterPos" onchange="updatePreview()">
            <option value="all">All types</option>
            <option value="noun">Nouns only</option>
            <option value="verb">Verbs only</option>
            <option value="adjective">Adjectives only</option>
            <option value="adverb">Adverbs only</option>
            <option value="pronoun">Pronouns only</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Book</label>
          <select id="filterBook" onchange="updatePreview()">
            <option value="all">All books</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Language</label>
          <select id="filterLang" onchange="updatePreview()">
            <option value="all">All languages</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Translate to</label>
          <select id="toLang">
            <option value="eng">English</option>
            <option value="spa">Spanish</option>
            <option value="fra">French</option>
            <option value="deu">German</option>
          </select>
        </div>
      </div>

      <div class="provider-row">
        <div class="filter-group" style="min-width:160px">
          <label>Translation Provider</label>
          <select id="provider" onchange="toggleDeepL()">
            <option value="mymemory">MyMemory (free)</option>
            <option value="deepl">DeepL (better quality)</option>
          </select>
        </div>
        <div class="deepl-key filter-group" id="deeplKeyGroup">
          <label>DeepL API Key</label>
          <input type="password" id="deeplKey" placeholder="Paste your free DeepL API key">
        </div>
      </div>

      <div class="preview-box" id="previewBox">
        <div style="color:#555;font-size:.9rem">Select filters to see a preview...</div>
      </div>

      <div class="progress-status" id="progressStatus"></div>
      <div class="progress-bar" id="progressBar"><div class="progress-bar-fill" id="progressFill"></div></div>

      <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem">
        <button class="btn btn-translate" id="translateBtn" onclick="doTranslate()">🌐 Translate Selected</button>
        <button class="btn btn-anki" onclick="doExport('anki')">⬇ Export to Anki</button>
        <button class="btn btn-csv" onclick="doExport('csv')">⬇ Export to CSV</button>
      </div>

      <div style="border-top:1px solid #21262d;padding-top:1rem;margin-top:.5rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:1rem">
          <div>
            <div style="font-size:.8rem;color:#888;margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.5px">AnkiConnect</div>
            <span class="anki-status anki-disconnected" id="ankiStatus">⚡ Checking...</span>
          </div>
          <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
            <div class="filter-group" style="min-width:160px">
              <label>Base deck name</label>
              <input type="text" id="deckName" value="epub-nlp" oninput="updateDeckPreview()" style="background:#0f1117;color:#e8e8e8;border:1px solid #30363d;border-radius:8px;padding:.4rem .75rem;font-size:.875rem;width:100%">
            </div>
            <div class="filter-group" style="min-width:160px">
              <label>Deck structure</label>
              <select id="splitByPos" onchange="updateDeckPreview()">
                <option value="true">Split by part of speech</option>
                <option value="false">Single deck</option>
              </select>
            </div>
            <button class="btn btn-ankiconnect" style="margin-top:1.2rem" onclick="doPushAnki()">⚡ Push to Anki</button>
          </div>
        </div>
        <div id="deckPreview" style="font-size:.78rem;color:#555;margin-top:.75rem;font-family:monospace"></div>
        </div>
        <p style="font-size:.75rem;color:#444;margin-top:.75rem">
          AnkiConnect pushes cards directly into Anki without any file import.
          Requires <a href="https://ankiweb.net/shared/info/2055492159" target="_blank" style="color:#58a6ff">AnkiConnect plugin</a> installed and Anki open.
        </p>
      </div>
    </div>

    <div class="section">
      <h3>🔤 Top Words</h3>
      <div class="word-list" id="topWords"></div>
    </div>
    <div class="section">
      <h3>📦 Top Nouns</h3>
      <div class="word-list" id="topNouns"></div>
    </div>
    <div class="section">
      <h3>⚡ Top Verbs</h3>
      <div class="word-list" id="topVerbs"></div>
    </div>
    <div class="section">
      <h3>🎨 Top Adjectives</h3>
      <div class="word-list" id="topAdjectives"></div>
    </div>
    <div class="section">
      <h3>🏷️ Named Entities</h3>
      <div id="entities"></div>
    </div>

    <a class="reset-link" onclick="resetUI()">← Analyze another book</a>
  </div>
</div>

<script>
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  // Load stats on start
  loadStats();

  // Show language picker when page loads
  document.getElementById('langPicker').style.display = 'block';

  function loadStats() {
    fetch('/db/stats').then(r => r.json()).then(s => {
      document.getElementById('dbTotal').textContent = s.totalWords.toLocaleString();
      document.getElementById('dbBooks').textContent = s.totalBooks || 0;
      document.getElementById('dbUnexported').textContent = s.unexportedWords.toLocaleString();
      populateFilters(s);
    }).catch(() => {});
  }

  function populateFilters(stats) {
    const bookSel = document.getElementById('filterBook');
    const langSel = document.getElementById('filterLang');

    bookSel.innerHTML = '<option value="all">All books</option>';
    (stats.books || []).forEach(b => {
      bookSel.innerHTML += \`<option value="\${b.slug}">\${b.title}</option>\`;
    });

    langSel.innerHTML = '<option value="all">All languages</option>';
    Object.entries(stats.byLanguage || {}).forEach(([code, count]) => {
      const names = {eng:'English',spa:'Spanish',fra:'French',deu:'German',ita:'Italian',por:'Portuguese',und:'Unknown'};
      langSel.innerHTML += \`<option value="\${code}">\${names[code] || code} (\${count})</option>\`;
    });
  }

  // Library panel
  let booksVisible = false;
  function toggleBooks() {
    booksVisible = !booksVisible;
    const panel = document.getElementById('booksList');
    panel.style.display = booksVisible ? 'block' : 'none';
    if (booksVisible) renderLibrary();
  }

  const langNames = {eng:'English',spa:'Spanish',fra:'French',deu:'German',ita:'Italian',por:'Portuguese',und:'Unknown'};

  function renderLibrary() {
    fetch('/db/stats').then(r => r.json()).then(s => {
      const books = s.books || [];
      document.getElementById('booksContent').innerHTML = books.length === 0
        ? '<p style="color:#555;font-size:.9rem">No books yet.</p>'
        : books.map(b => \`
          <div class="book-row" id="row-\${b.slug}">
            <div class="book-name">\${b.title}</div>
            <div class="book-info">
              <select onchange="changeLang('\${b.slug}', this.value)" style="background:#0f1117;color:#aaa;border:1px solid #30363d;border-radius:6px;padding:.2rem .5rem;font-size:.78rem">
                \${['eng','spa','fra','deu','ita','por','rus','jpn','zho','ara','nld'].map(c =>
                  \`<option value="\${c}" \${b.language===c?'selected':''}>\${langNames[c]||c}</option>\`
                ).join('')}
              </select>
              <span class="badge">\${(b.wordCount||0).toLocaleString()} words</span>
              <button class="btn-danger" onclick="removeBook('\${b.slug}', '\${b.title.replace(/'/g,"\\\\'")}')">Remove</button>
            </div>
          </div>\`).join('');
    });
  }

  async function changeLang(slug, code) {
    await fetch(\`/book/\${slug}/language\`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: code })
    });
    loadStats();
  }

  async function removeBook(slug, title) {
    const withWords = confirm(\`Remove "\${title}" from the database?\\n\\nClick OK to remove the book entry only.\\nThe words it added will remain in the database.\\n\\nTo also delete its words, hold Shift and click OK.\`);
    if (!withWords && !confirm(\`Remove "\${title}"?\`)) return;
    const removeWords = window.event?.shiftKey || false;
    await fetch(\`/book/\${slug}?removeWords=\${removeWords}\`, { method: 'DELETE' });
    document.getElementById(\`row-\${slug}\`)?.remove();
    loadStats();
  }

  // Drag and drop
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });

  function handleFile(file) {
    if (!file.name.endsWith('.epub')) { showError('Please upload an .epub file.'); return; }
    hideError();
    document.getElementById('progress').style.display = 'block';
    document.getElementById('langPicker').style.display = 'none';
    dropzone.style.display = 'none';

    const formData = new FormData();
    formData.append('epub', file);
    const manualLang = document.getElementById('manualLang').value;
    if (manualLang) formData.append('language', manualLang);

    fetch('/analyze', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(data => {
        document.getElementById('progress').style.display = 'none';
        if (data.error) { showError(data.error); dropzone.style.display = 'block'; document.getElementById('langPicker').style.display = 'block'; return; }
        showResults(data);
      })
      .catch(err => {
        document.getElementById('progress').style.display = 'none';
        showError('Something went wrong: ' + err.message);
        dropzone.style.display = 'block';
        document.getElementById('langPicker').style.display = 'block';
      });
  }

  function showResults(data) {
    document.getElementById('results').style.display = 'block';
    document.getElementById('bookTitle').textContent = data.title;
    document.getElementById('bookMeta').innerHTML = \`
      <span class="badge lang">🌐 \${data.language}</span>
      <span class="badge">📖 \${data.chapterCount} chapters</span>
      \${data.newWords > 0 ? \`<span class="badge new">+\${data.newWords.toLocaleString()} new words</span>\` : ''}
    \`;

    const stats = [
      { num: data.summary.totalWords.toLocaleString(), lbl: 'Total Words' },
      { num: data.summary.sentenceCount.toLocaleString(), lbl: 'Sentences' },
      { num: data.pos.nouns.toLocaleString(), lbl: 'Unique Nouns' },
      { num: data.pos.verbs.toLocaleString(), lbl: 'Unique Verbs' },
      { num: data.pos.adjectives.toLocaleString(), lbl: 'Unique Adj.' },
      { num: data.pos.adverbs.toLocaleString(), lbl: 'Unique Adverbs' },
    ];
    document.getElementById('statsGrid').innerHTML = stats.map(s =>
      \`<div class="stat-card"><div class="num">\${s.num}</div><div class="lbl">\${s.lbl}</div></div>\`
    ).join('');

    renderWords('topWords', data.frequency.topWords);
    renderWords('topNouns', data.frequency.topNouns);
    renderWords('topVerbs', data.frequency.topVerbs);
    renderWords('topAdjectives', data.frequency.topAdjectives);

    const ent = data.entities;
    document.getElementById('entities').innerHTML = [
      { label: 'People', items: ent.people },
      { label: 'Places', items: ent.places },
      { label: 'Organizations', items: ent.organizations },
    ].filter(e => e.items?.length).map(e =>
      \`<div class="entity-group">
        <div class="type">\${e.label}</div>
        <div class="word-list">\${e.items.slice(0,20).map(i => \`<span class="word-tag">\${i}</span>\`).join('')}</div>
      </div>\`
    ).join('') || '<p style="color:#555;font-size:.9rem">None detected</p>';

    loadStats();
    updatePreview();
  }

  function renderWords(id, obj) {
    document.getElementById(id).innerHTML = Object.entries(obj || {}).slice(0, 20)
      .map(([w, c]) => \`<span class="word-tag">\${w}<span class="cnt">\${c}</span></span>\`).join('');
  }

  async function doExport(format) {
    const pos = document.getElementById('filterPos').value;
    const book = document.getElementById('filterBook').value;
    const language = document.getElementById('filterLang').value;

    const resp = await fetch('/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, pos, book, language })
    });

    if (!resp.ok) {
      const err = await resp.json();
      alert(err.error || 'Export failed');
      return;
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format === 'anki'
      ? 'anki_vocab_' + new Date().toISOString().slice(0,10) + '.txt'
      : 'vocab_' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    loadStats();
  }

  // Translation preview
  let previewTimeout = null;
  function updatePreview() {
    clearTimeout(previewTimeout);
    previewTimeout = setTimeout(async () => {
      const pos = document.getElementById('filterPos').value;
      const book = document.getElementById('filterBook').value;
      const language = document.getElementById('filterLang').value;

      const resp = await fetch('/translate/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pos, book, language })
      });
      const data = await resp.json();

      const box = document.getElementById('previewBox');
      box.innerHTML = \`
        <div style="display:flex;gap:2rem;flex-wrap:wrap">
          <div><div class="big">\${data.total.toLocaleString()}</div><div class="sub">words selected</div></div>
          <div><div class="big" style="color:\${data.untranslated>0?'#f0a500':'#4caf50'}">\${data.untranslated.toLocaleString()}</div><div class="sub">need translation</div></div>
          <div><div class="big" style="color:#4caf50">\${data.alreadyTranslated.toLocaleString()}</div><div class="sub">already translated</div></div>
        </div>
        \${data.untranslated > data.dailyLimit
          ? \`<div class="warn">⚠ \${data.untranslated.toLocaleString()} words exceeds the MyMemory daily limit of \${data.dailyLimit.toLocaleString()}. Filter by POS or book to stay within the limit.</div>\`
          : data.untranslated > 0
            ? \`<div style="color:#4caf50;font-size:.8rem;margin-top:.5rem">✓ Within daily limit (\${data.dailyLimit.toLocaleString()} words/day)</div>\`
            : ''
        }
      \`;
    }, 300);
  }

  function toggleDeepL() {
    const provider = document.getElementById('provider').value;
    document.getElementById('deeplKeyGroup').style.display = provider === 'deepl' ? 'flex' : 'none';
  }

  // Translate
  async function doTranslate() {
    const pos = document.getElementById('filterPos').value;
    const book = document.getElementById('filterBook').value;
    const language = document.getElementById('filterLang').value;
    const toLang = document.getElementById('toLang').value;
    const provider = document.getElementById('provider').value;
    const deeplKey = document.getElementById('deeplKey').value;

    const btn = document.getElementById('translateBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Translating...';

    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const progressStatus = document.getElementById('progressStatus');
    progressBar.style.display = 'block';
    progressStatus.style.display = 'block';

    const fromLang = language !== 'all' ? language : 'spa';

    const resp = await fetch('/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pos, book, language, fromLang, toLang, provider, deeplKey })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice(6));

        if (event.type === 'start') {
          progressStatus.textContent = \`Translating 0 / \${event.total}...\`;
        } else if (event.type === 'progress') {
          const pct = Math.round((event.done / event.total) * 100);
          progressFill.style.width = pct + '%';
          progressStatus.textContent = \`Translating \${event.done} / \${event.total}: \${event.word} → \${event.translation || '(no result)'}\`;
        } else if (event.type === 'done') {
          progressFill.style.width = '100%';
          progressStatus.textContent = \`✓ Done — \${event.translated} translated, \${event.failed} failed, \${event.skipped} already done\`;
          btn.disabled = false;
          btn.textContent = '🌐 Translate Selected';
          updatePreview();
          loadStats();
        } else if (event.type === 'error') {
          progressStatus.textContent = '✗ Error: ' + event.message;
          progressStatus.style.color = '#f87171';
          btn.disabled = false;
          btn.textContent = '🌐 Translate Selected';
        }
      }
    }
  }

  // AnkiConnect
  async function checkAnkiStatus() {
    const resp = await fetch('/anki/status');
    const data = await resp.json();
    const el = document.getElementById('ankiStatus');
    if (data.connected) {
      el.className = 'anki-status anki-connected';
      el.textContent = '⚡ Anki connected (v' + data.version + ')';
    } else {
      el.className = 'anki-status anki-disconnected';
      el.textContent = '⚡ Anki not detected';
    }
  }

  function updateDeckPreview() {
    const base = document.getElementById('deckName').value || 'epub-nlp';
    const split = document.getElementById('splitByPos').value === 'true';
    const preview = document.getElementById('deckPreview');
    if (split) {
      preview.innerHTML = \`Cards will be added to: <span style="color:#58a6ff">\${base}::Nouns</span>, <span style="color:#58a6ff">\${base}::Verbs</span>, <span style="color:#58a6ff">\${base}::Adjectives</span>, <span style="color:#58a6ff">\${base}::Adverbs</span>\`;
    } else {
      preview.innerHTML = \`Cards will be added to: <span style="color:#58a6ff">\${base}</span>\`;
    }
  }

  async function doPushAnki() {
    const pos = document.getElementById('filterPos').value;
    const book = document.getElementById('filterBook').value;
    const language = document.getElementById('filterLang').value;
    const deckName = document.getElementById('deckName').value || 'epub-nlp';
    const splitByPos = document.getElementById('splitByPos').value === 'true';

    const resp = await fetch('/anki/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pos, book, language, deckName, splitByPos })
    });
    const data = await resp.json();

    if (data.error) {
      alert(data.error);
    } else {
      const decks = splitByPos
        ? \`into \${deckName}::Nouns, ::Verbs, ::Adjectives, etc.\`
        : \`into \${deckName}\`;
      alert(\`✓ Done!\\n\\n\${data.added} cards added \${decks}\\n\${data.duplicate} duplicates skipped\\n\${data.failed} failed\`);
      loadStats();
    }
  }

  // Init deck preview
  updateDeckPreview();

  // Check AnkiConnect status on load and after results
  checkAnkiStatus();
  setInterval(checkAnkiStatus, 10000);

  function showError(msg) { const e = document.getElementById('errorMsg'); e.textContent = msg; e.style.display = 'block'; }
  function hideError() { document.getElementById('errorMsg').style.display = 'none'; }

  function resetUI() {
    document.getElementById('results').style.display = 'none';
    document.getElementById('langPicker').style.display = 'block';
    dropzone.style.display = 'block';
    fileInput.value = '';
  }
</script>
</body>
</html>`;
}
