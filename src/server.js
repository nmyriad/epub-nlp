// src/server.js
// Local web server for the epub-nlp drag-and-drop UI
// Runs at http://localhost:3000 when you run: node src/index.js ui

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
import { ingestBookWords, getUnexportedWords, getAllWords, getDbStats } from "./worddb.js";
import { exportToAnki, exportToVocabCsv, exportTopWordsReport } from "./vocab-export.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;
const UPLOAD_DIR = path.join(os.tmpdir(), "epub-nlp-uploads");

export async function startServer() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const app = express();
  const upload = multer({ dest: UPLOAD_DIR });

  app.use(express.json());

  // ── Serve the UI ──────────────────────────────────────────────────────────
  app.get("/", (req, res) => {
    res.send(getHtml());
  });

  // ── API: Analyze EPUB ─────────────────────────────────────────────────────
  app.post("/analyze", upload.single("epub"), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // Rename to add .epub extension so parser recognizes it
    const epubPath = req.file.path + ".epub";
    await fs.rename(req.file.path, epubPath);

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

      // Update word database
      const { added } = await ingestBookWords(bookResult);

      // Save result for later export
      const resultPath = path.join(UPLOAD_DIR, `${Date.now()}_result.json`);
      await fs.writeFile(resultPath, JSON.stringify(bookResult));

      // Clean up epub
      await fs.unlink(epubPath).catch(() => {});

      res.json({
        success: true,
        resultId: path.basename(resultPath),
        title: bookResult.bookTitle,
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

  // ── API: Export Anki ──────────────────────────────────────────────────────
  app.get("/export/anki", async (req, res) => {
    try {
      const words = await getUnexportedWords();
      if (words.length === 0) {
        return res.status(404).json({ error: "No new words to export." });
      }
      const outDir = path.join(UPLOAD_DIR, "exports");
      await fs.mkdir(outDir, { recursive: true });
      const timestamp = new Date().toISOString().slice(0, 10);
      const filePath = await exportToAnki(words, outDir, `anki_vocab_${timestamp}.txt`, true);
      res.download(filePath, `anki_vocab_${timestamp}.txt`);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Export CSV ───────────────────────────────────────────────────────
  app.get("/export/csv", async (req, res) => {
    try {
      const words = await getAllWords();
      if (words.length === 0) {
        return res.status(404).json({ error: "No words in database yet." });
      }
      const outDir = path.join(UPLOAD_DIR, "exports");
      await fs.mkdir(outDir, { recursive: true });
      const timestamp = new Date().toISOString().slice(0, 10);
      const filePath = await exportToVocabCsv(words, outDir, `vocab_${timestamp}.csv`, false);
      res.download(filePath, `vocab_${timestamp}.csv`);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: DB Stats ─────────────────────────────────────────────────────────
  app.get("/db/stats", async (req, res) => {
    try {
      const stats = await getDbStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Start server ──────────────────────────────────────────────────────────
  const server = createServer(app);
  server.listen(PORT, () => {
    console.log(chalk.bold.cyan("\n📖 epub-nlp UI\n"));
    console.log("  " + chalk.green("✔") + " Server running at " + chalk.underline.cyan(`http://localhost:${PORT}`));
    console.log("  " + chalk.dim("Opening in your browser..."));
    console.log("  " + chalk.dim("Press Ctrl+C to stop.\n"));
    open(`http://localhost:${PORT}`);
  });
}

// ── HTML UI ───────────────────────────────────────────────────────────────

function getHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>epub-nlp</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #0f1117;
    color: #e8e8e8;
    min-height: 100vh;
    padding: 2rem;
  }

  header {
    text-align: center;
    margin-bottom: 2.5rem;
  }

  header h1 {
    font-size: 2rem;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.5px;
  }

  header p {
    color: #888;
    margin-top: 0.4rem;
    font-size: 0.95rem;
  }

  .container { max-width: 860px; margin: 0 auto; }

  /* Drop zone */
  #dropzone {
    border: 2px dashed #333;
    border-radius: 16px;
    padding: 3rem 2rem;
    text-align: center;
    cursor: pointer;
    transition: all 0.2s;
    background: #161b22;
    margin-bottom: 2rem;
  }

  #dropzone.dragover {
    border-color: #58a6ff;
    background: #1c2a3a;
  }

  #dropzone .icon { font-size: 3rem; margin-bottom: 1rem; }

  #dropzone h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: #fff;
    margin-bottom: 0.4rem;
  }

  #dropzone p { color: #666; font-size: 0.9rem; }

  #dropzone .browse {
    color: #58a6ff;
    text-decoration: underline;
    cursor: pointer;
  }

  #fileInput { display: none; }

  /* Progress */
  #progress {
    display: none;
    text-align: center;
    padding: 2rem;
    background: #161b22;
    border-radius: 16px;
    margin-bottom: 2rem;
  }

  .spinner {
    width: 40px; height: 40px;
    border: 3px solid #333;
    border-top-color: #58a6ff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 1rem;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  #progress p { color: #888; }

  /* Results */
  #results { display: none; }

  .book-title {
    font-size: 1.4rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 1.5rem;
  }

  .book-title span {
    font-size: 0.85rem;
    font-weight: 400;
    color: #58a6ff;
    margin-left: 0.75rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
    margin-bottom: 2rem;
  }

  .stat-card {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 12px;
    padding: 1.25rem;
    text-align: center;
  }

  .stat-card .num {
    font-size: 1.75rem;
    font-weight: 700;
    color: #58a6ff;
  }

  .stat-card .label {
    font-size: 0.8rem;
    color: #666;
    margin-top: 0.3rem;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .section {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1.5rem;
  }

  .section h3 {
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #888;
    margin-bottom: 1rem;
  }

  .word-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .word-tag {
    background: #21262d;
    border-radius: 6px;
    padding: 0.3rem 0.7rem;
    font-size: 0.85rem;
    color: #e8e8e8;
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .word-tag .count {
    color: #58a6ff;
    font-size: 0.75rem;
  }

  /* Export buttons */
  .export-bar {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
    flex-wrap: wrap;
  }

  .btn {
    padding: 0.7rem 1.4rem;
    border-radius: 8px;
    border: none;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
    text-decoration: none;
    display: inline-block;
  }

  .btn:hover { opacity: 0.85; }
  .btn-primary { background: #238636; color: #fff; }
  .btn-secondary { background: #21262d; color: #e8e8e8; border: 1px solid #333; }
  .btn-outline { background: transparent; color: #58a6ff; border: 1px solid #58a6ff; }

  /* DB stats bar */
  #dbBar {
    background: #161b22;
    border: 1px solid #21262d;
    border-radius: 12px;
    padding: 1rem 1.5rem;
    margin-bottom: 2rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
  }

  #dbBar .db-info { color: #888; font-size: 0.9rem; }
  #dbBar .db-info strong { color: #e8e8e8; }

  .new-words-badge {
    background: #1f6feb33;
    color: #58a6ff;
    border: 1px solid #1f6feb55;
    border-radius: 20px;
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
  }

  #analyzeAnother {
    margin-top: 1rem;
    display: block;
    text-align: center;
    color: #58a6ff;
    cursor: pointer;
    font-size: 0.9rem;
    text-decoration: underline;
  }

  .error-msg {
    background: #2d1515;
    border: 1px solid #6e2020;
    border-radius: 12px;
    padding: 1rem 1.5rem;
    color: #f87171;
    margin-bottom: 1.5rem;
    display: none;
  }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>📖 epub-nlp</h1>
    <p>Drag and drop an EPUB to analyze vocabulary, phrases, and entities</p>
  </header>

  <div id="dbBar">
    <div class="db-info">Word database: <strong id="dbTotal">—</strong> words tracked</div>
    <div style="display:flex;gap:0.75rem;align-items:center;">
      <a href="/export/anki" class="btn btn-primary" style="padding:0.4rem 1rem;font-size:0.8rem;">⬇ Export Anki</a>
      <a href="/export/csv" class="btn btn-secondary" style="padding:0.4rem 1rem;font-size:0.8rem;">⬇ Export CSV</a>
    </div>
  </div>

  <div class="error-msg" id="errorMsg"></div>

  <div id="dropzone">
    <div class="icon">📚</div>
    <h2>Drop your EPUB here</h2>
    <p>or <span class="browse" onclick="document.getElementById('fileInput').click()">browse for a file</span></p>
    <p style="margin-top:0.5rem;font-size:0.8rem;color:#444;">.epub files only</p>
    <input type="file" id="fileInput" accept=".epub">
  </div>

  <div id="progress">
    <div class="spinner"></div>
    <p id="progressMsg">Parsing EPUB...</p>
  </div>

  <div id="results">
    <div class="book-title" id="bookTitle"></div>

    <div class="stats-grid" id="statsGrid"></div>

    <div class="export-bar">
      <a href="/export/anki" class="btn btn-primary">⬇ Export new words to Anki</a>
      <a href="/export/csv" class="btn btn-secondary">⬇ Export all words to CSV</a>
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

    <a id="analyzeAnother" onclick="resetUI()">← Analyze another book</a>
  </div>
</div>

<script>
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const progress = document.getElementById('progress');
  const results = document.getElementById('results');
  const errorMsg = document.getElementById('errorMsg');

  // Load DB stats on page load
  fetch('/db/stats').then(r => r.json()).then(stats => {
    document.getElementById('dbTotal').textContent = stats.totalWords.toLocaleString();
  }).catch(() => {});

  // Drag and drop
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  function handleFile(file) {
    if (!file.name.endsWith('.epub')) {
      showError('Please upload an .epub file.');
      return;
    }
    hideError();
    showProgress('Uploading and parsing EPUB...');

    const formData = new FormData();
    formData.append('epub', file);

    fetch('/analyze', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(data => {
        if (data.error) { showError(data.error); hideProgress(); return; }
        showResults(data);
      })
      .catch(err => { showError('Something went wrong: ' + err.message); hideProgress(); });
  }

  function showResults(data) {
    hideProgress();
    dropzone.style.display = 'none';
    results.style.display = 'block';

    document.getElementById('bookTitle').innerHTML =
      data.title + (data.newWords > 0 ? \`<span>+\${data.newWords} new words added to database</span>\` : '');

    // Stats grid
    const stats = [
      { num: data.chapterCount, label: 'Chapters' },
      { num: data.summary.totalWords.toLocaleString(), label: 'Total Words' },
      { num: data.summary.sentenceCount.toLocaleString(), label: 'Sentences' },
      { num: data.pos.nouns.toLocaleString(), label: 'Unique Nouns' },
      { num: data.pos.verbs.toLocaleString(), label: 'Unique Verbs' },
      { num: data.pos.adjectives.toLocaleString(), label: 'Unique Adjectives' },
    ];
    document.getElementById('statsGrid').innerHTML = stats.map(s =>
      \`<div class="stat-card"><div class="num">\${s.num}</div><div class="label">\${s.label}</div></div>\`
    ).join('');

    // Word lists
    renderWordList('topWords', data.frequency.topWords);
    renderWordList('topNouns', data.frequency.topNouns);
    renderWordList('topVerbs', data.frequency.topVerbs);
    renderWordList('topAdjectives', data.frequency.topAdjectives);

    // Entities
    const ent = data.entities;
    document.getElementById('entities').innerHTML = [
      { label: 'People', items: ent.people },
      { label: 'Places', items: ent.places },
      { label: 'Organizations', items: ent.organizations },
    ].filter(e => e.items?.length > 0).map(e =>
      \`<div style="margin-bottom:0.75rem;">
        <span style="color:#888;font-size:0.8rem;margin-right:0.5rem;">\${e.label}</span>
        \${e.items.slice(0,15).map(i => \`<span class="word-tag">\${i}</span>\`).join('')}
      </div>\`
    ).join('') || '<p style="color:#555;font-size:0.9rem;">None detected</p>';

    // Update DB count
    fetch('/db/stats').then(r => r.json()).then(s => {
      document.getElementById('dbTotal').textContent = s.totalWords.toLocaleString();
    });
  }

  function renderWordList(id, freqObj) {
    const el = document.getElementById(id);
    const entries = Object.entries(freqObj || {}).slice(0, 20);
    el.innerHTML = entries.map(([word, count]) =>
      \`<span class="word-tag">\${word} <span class="count">\${count}</span></span>\`
    ).join('');
  }

  function showProgress(msg) {
    document.getElementById('progressMsg').textContent = msg;
    progress.style.display = 'block';
    dropzone.style.display = 'none';
  }

  function hideProgress() { progress.style.display = 'none'; }

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
    dropzone.style.display = 'block';
  }

  function hideError() { errorMsg.style.display = 'none'; }

  function resetUI() {
    results.style.display = 'none';
    dropzone.style.display = 'block';
    fileInput.value = '';
  }
</script>
</body>
</html>`;
}
