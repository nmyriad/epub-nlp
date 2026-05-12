// epub-nlp UI JavaScript - all functions in global scope

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
    const opt = document.createElement('option');
    opt.value = b.slug;
    opt.textContent = b.title;
    bookSel.appendChild(opt);
  });
  langSel.innerHTML = '<option value="all">All languages</option>';
  const names = {eng:'English',spa:'Spanish',fra:'French',deu:'German',ita:'Italian',por:'Portuguese',und:'Unknown'};
  Object.entries(stats.byLanguage || {}).forEach(([code, count]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = (names[code] || code) + ' (' + count + ')';
    langSel.appendChild(opt);
  });
}

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
    const el = document.getElementById('booksContent');
    if (books.length === 0) {
      el.innerHTML = '<p style="color:#555;font-size:.9rem">No books yet.</p>';
      return;
    }
    el.innerHTML = '';
    books.forEach(b => {
      const row = document.createElement('div');
      row.className = 'book-row';
      row.id = 'row-' + b.slug;
      const langs = ['eng','spa','fra','deu','ita','por','rus','jpn','zho','ara','nld'];
      const sel = document.createElement('select');
      sel.style.cssText = 'background:#0f1117;color:#aaa;border:1px solid #30363d;border-radius:6px;padding:.2rem .5rem;font-size:.78rem';
      sel.onchange = function() { changeLang(b.slug, this.value); };
      langs.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = langNames[c] || c;
        if (b.language === c) opt.selected = true;
        sel.appendChild(opt);
      });
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = (b.wordCount || 0).toLocaleString() + ' words';
      const btn = document.createElement('button');
      btn.className = 'btn-danger';
      btn.textContent = 'Remove';
      btn.onclick = function() { removeBook(b.slug, b.title); };
      const nameDiv = document.createElement('div');
      nameDiv.className = 'book-name';
      nameDiv.textContent = b.title;
      const infoDiv = document.createElement('div');
      infoDiv.className = 'book-info';
      infoDiv.appendChild(sel);
      infoDiv.appendChild(badge);
      infoDiv.appendChild(btn);
      row.appendChild(nameDiv);
      row.appendChild(infoDiv);
      el.appendChild(row);
    });
  });
}

async function changeLang(slug, code) {
  await fetch('/book/' + slug + '/language', {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({language: code})
  });
  loadStats();
}

async function removeBook(slug, title) {
  if (!confirm('Remove "' + title + '" from the database?')) return;
  await fetch('/book/' + slug + '?removeWords=false', {method: 'DELETE'});
  const row = document.getElementById('row-' + slug);
  if (row) row.remove();
  loadStats();
}

let previewTimeout = null;
function updatePreview() {
  clearTimeout(previewTimeout);
  previewTimeout = setTimeout(async () => {
    const pos = document.getElementById('filterPos').value;
    const book = document.getElementById('filterBook').value;
    const language = document.getElementById('filterLang').value;
    const resp = await fetch('/translate/preview', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({pos, book, language})
    });
    const data = await resp.json();
    const box = document.getElementById('previewBox');
    let html = '<div style="display:flex;gap:2rem;flex-wrap:wrap">'
      + '<div><div class="big">' + data.total.toLocaleString() + '</div><div class="sub">words selected</div></div>'
      + '<div><div class="big" style="color:' + (data.untranslated > 0 ? '#f0a500' : '#4caf50') + '">' + data.untranslated.toLocaleString() + '</div><div class="sub">need translation</div></div>'
      + '<div><div class="big" style="color:#4caf50">' + data.alreadyTranslated.toLocaleString() + '</div><div class="sub">already translated</div></div>'
      + '<div><div class="big" style="color:#58a6ff">' + (data.readyToExport || 0).toLocaleString() + '</div><div class="sub">ready to export</div></div>'
      + '</div>';
    if (data.untranslated > data.dailyLimit) {
      html += '<div class="warn">⚠ ' + data.untranslated.toLocaleString() + ' words exceeds the MyMemory daily limit of ' + data.dailyLimit.toLocaleString() + '. Filter by POS or book to stay within the limit.</div>';
    } else if (data.untranslated > 0) {
      html += '<div style="color:#4caf50;font-size:.8rem;margin-top:.5rem">✓ Within daily limit (' + data.dailyLimit.toLocaleString() + ' words/day)</div>';
    }
    box.innerHTML = html;
  }, 300);
}

function toggleDeepL() {
  document.getElementById('deeplKeyGroup').style.display =
    document.getElementById('provider').value === 'deepl' ? 'flex' : 'none';
}

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
  const fromLang = (language !== 'all') ? language : 'spa';
  const resp = await fetch('/translate', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({pos, book, language, fromLang, toLang, provider, deeplKey})
  });
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === 'start') {
        progressStatus.textContent = 'Translating 0 / ' + event.total + '...';
      } else if (event.type === 'progress') {
        const pct = Math.round((event.done / event.total) * 100);
        progressFill.style.width = pct + '%';
        const arrow = event.translation ? ' → ' + event.translation : ' → (no result)';
        progressStatus.textContent = event.word.startsWith('⚠')
          ? event.word
          : 'Translating ' + event.done + ' / ' + event.total + ': ' + event.word + arrow;
      } else if (event.type === 'done') {
        progressFill.style.width = '100%';
        progressStatus.textContent = '✓ Done — ' + event.translated + ' translated, ' + event.failed + ' failed, ' + event.skipped + ' already done';
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

async function doExport(format) {
  const pos = document.getElementById('filterPos').value;
  const book = document.getElementById('filterBook').value;
  const language = document.getElementById('filterLang').value;
  const resp = await fetch('/export', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({format, pos, book, language})
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
    ? 'anki_vocab_' + new Date().toISOString().slice(0, 10) + '.txt'
    : 'vocab_' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  loadStats();
}

async function checkAnkiStatus() {
  try {
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
  } catch(e) {}
}

function updateDeckPreview() {
  const base = document.getElementById('deckName').value || 'epub-nlp';
  const split = document.getElementById('splitByPos').value === 'true';
  const preview = document.getElementById('deckPreview');
  if (split) {
    preview.innerHTML = 'Cards will be added to: '
      + '<span style="color:#58a6ff">' + base + '::Nouns</span>, '
      + '<span style="color:#58a6ff">' + base + '::Verbs</span>, '
      + '<span style="color:#58a6ff">' + base + '::Adjectives</span>, '
      + '<span style="color:#58a6ff">' + base + '::Adverbs</span>';
  } else {
    preview.innerHTML = 'Cards will be added to: <span style="color:#58a6ff">' + base + '</span>';
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
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({pos, book, language, deckName, splitByPos})
  });
  const data = await resp.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  const decks = splitByPos ? 'into ' + deckName + '::Nouns, ::Verbs, etc.' : 'into ' + deckName;
  alert('✓ Done!\n\n' + data.added + ' cards added ' + decks + '\n' + data.duplicate + ' duplicates skipped\n' + data.failed + ' failed');
  loadStats();
}

function showResults(data) {
  document.getElementById('results').style.display = 'block';
  document.getElementById('bookTitle').textContent = data.title;
  let metaHtml = '<span class="badge lang">🌐 ' + data.language + '</span>';
  metaHtml += '<span class="badge">📖 ' + data.chapterCount + ' chapters</span>';
  if (data.newWords > 0) {
    metaHtml += '<span class="badge new">+' + data.newWords.toLocaleString() + ' new words</span>';
  }
  document.getElementById('bookMeta').innerHTML = metaHtml;
  const stats = [
    {num: data.summary.totalWords.toLocaleString(), lbl: 'Total Words'},
    {num: data.summary.sentenceCount.toLocaleString(), lbl: 'Sentences'},
    {num: data.pos.nouns.toLocaleString(), lbl: 'Unique Nouns'},
    {num: data.pos.verbs.toLocaleString(), lbl: 'Unique Verbs'},
    {num: data.pos.adjectives.toLocaleString(), lbl: 'Unique Adj.'},
    {num: data.pos.adverbs.toLocaleString(), lbl: 'Unique Adverbs'},
  ];
  document.getElementById('statsGrid').innerHTML = stats.map(s =>
    '<div class="stat-card"><div class="num">' + s.num + '</div><div class="lbl">' + s.lbl + '</div></div>'
  ).join('');
  renderWords('topWords', data.frequency.topWords);
  renderWords('topNouns', data.frequency.topNouns);
  renderWords('topVerbs', data.frequency.topVerbs);
  renderWords('topAdjectives', data.frequency.topAdjectives);
  const ent = data.entities;
  const entGroups = [
    {label: 'People', items: ent.people},
    {label: 'Places', items: ent.places},
    {label: 'Organizations', items: ent.organizations},
  ].filter(e => e.items && e.items.length > 0);
  const entEl = document.getElementById('entities');
  if (entGroups.length === 0) {
    entEl.innerHTML = '<p style="color:#555;font-size:.9rem">None detected</p>';
  } else {
    entEl.innerHTML = '';
    entGroups.forEach(e => {
      const group = document.createElement('div');
      group.className = 'entity-group';
      const typeDiv = document.createElement('div');
      typeDiv.className = 'type';
      typeDiv.textContent = e.label;
      const listDiv = document.createElement('div');
      listDiv.className = 'word-list';
      e.items.slice(0, 20).forEach(item => {
        const tag = document.createElement('span');
        tag.className = 'word-tag';
        tag.textContent = item;
        listDiv.appendChild(tag);
      });
      group.appendChild(typeDiv);
      group.appendChild(listDiv);
      entEl.appendChild(group);
    });
  }
  loadStats();
  updatePreview();
  checkAnkiStatus();
}

function renderWords(id, obj) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  Object.entries(obj || {}).slice(0, 20).forEach(([w, c]) => {
    const tag = document.createElement('span');
    tag.className = 'word-tag';
    tag.innerHTML = w + '<span class="cnt">' + c + '</span>';
    el.appendChild(tag);
  });
}

function showError(msg) {
  const e = document.getElementById('errorMsg');
  e.textContent = msg;
  e.style.display = 'block';
}

function hideError() {
  document.getElementById('errorMsg').style.display = 'none';
}

function resetUI() {
  document.getElementById('results').style.display = 'none';
  document.getElementById('langPicker').style.display = 'block';
  document.getElementById('dropzone').style.display = 'block';
  document.getElementById('fileInput').value = '';
}

function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.epub')) {
    showError('Please upload an .epub file. Got: ' + file.name);
    return;
  }
  hideError();
  document.getElementById('progress').style.display = 'block';
  document.getElementById('langPicker').style.display = 'none';
  document.getElementById('dropzone').style.display = 'none';
  const formData = new FormData();
  formData.append('epub', file);
  const manualLangEl = document.getElementById('manualLang');
  if (manualLangEl && manualLangEl.value) {
    formData.append('language', manualLangEl.value);
  }
  fetch('/analyze', {method: 'POST', body: formData})
    .then(r => r.json())
    .then(data => {
      document.getElementById('progress').style.display = 'none';
      if (data.error) {
        showError('Analysis error: ' + data.error);
        document.getElementById('dropzone').style.display = 'block';
        document.getElementById('langPicker').style.display = 'block';
        return;
      }
      showResults(data);
    })
    .catch(err => {
      document.getElementById('progress').style.display = 'none';
      showError('Network error: ' + err.message);
      document.getElementById('dropzone').style.display = 'block';
      document.getElementById('langPicker').style.display = 'block';
    });
}

// Init on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  loadStats();
  updateDeckPreview();
  checkAnkiStatus();
  setInterval(checkAnkiStatus, 10000);
});
