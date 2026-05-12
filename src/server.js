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
import { ingestBookWords, getWords, getBooks, getDbStats, markAsExported } from "./worddb.js";
import { exportToAnki, exportToVocabCsv } from "./vocab-export.js";

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
      const { added, language } = await ingestBookWords(bookResult);
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
  .book-row{display:flex;align-items:center;justify-content:space-between;padding:.6rem 0;border-bottom:1px solid #21262d}
  .book-row:last-child{border-bottom:none}
  .book-row .book-name{font-size:.9rem;color:#e8e8e8}
  .book-row .book-info{display:flex;gap:.5rem;align-items:center}

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

    <div class="export-panel">
      <h3>Export Vocabulary</h3>
      <div class="filter-row">
        <div class="filter-group">
          <label>Part of Speech</label>
          <select id="filterPos">
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
          <select id="filterBook">
            <option value="all">All books</option>
          </select>
        </div>
        <div class="filter-group">
          <label>Language</label>
          <select id="filterLang">
            <option value="all">All languages</option>
          </select>
        </div>
      </div>
      <div class="export-btns">
        <button class="btn btn-anki" onclick="doExport('anki')">⬇ Export to Anki</button>
        <button class="btn btn-csv" onclick="doExport('csv')">⬇ Export to CSV</button>
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

    // Books
    bookSel.innerHTML = '<option value="all">All books</option>';
    (stats.books || []).forEach(b => {
      bookSel.innerHTML += \`<option value="\${b.slug}">\${b.title}</option>\`;
    });

    // Languages
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
    if (booksVisible) {
      fetch('/db/stats').then(r => r.json()).then(s => {
        const langNames = {eng:'English',spa:'Spanish',fra:'French',deu:'German',ita:'Italian',por:'Portuguese',und:'Unknown'};
        document.getElementById('booksContent').innerHTML = (s.books || []).length === 0
          ? '<p style="color:#555;font-size:.9rem">No books yet — analyze an EPUB to get started.</p>'
          : (s.books || []).map(b => \`
            <div class="book-row">
              <div class="book-name">\${b.title}</div>
              <div class="book-info">
                <span class="badge lang">\${langNames[b.language] || b.language}</span>
                <span class="badge">\${b.wordCount.toLocaleString()} words</span>
              </div>
            </div>\`).join('');
      });
    }
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
    dropzone.style.display = 'none';

    const formData = new FormData();
    formData.append('epub', file);

    fetch('/analyze', { method: 'POST', body: formData })
      .then(r => r.json())
      .then(data => {
        document.getElementById('progress').style.display = 'none';
        if (data.error) { showError(data.error); dropzone.style.display = 'block'; return; }
        showResults(data);
      })
      .catch(err => {
        document.getElementById('progress').style.display = 'none';
        showError('Something went wrong: ' + err.message);
        dropzone.style.display = 'block';
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

  function showError(msg) { const e = document.getElementById('errorMsg'); e.textContent = msg; e.style.display = 'block'; }
  function hideError() { document.getElementById('errorMsg').style.display = 'none'; }

  function resetUI() {
    document.getElementById('results').style.display = 'none';
    dropzone.style.display = 'block';
    fileInput.value = '';
  }
</script>
</body>
</html>`;
}
