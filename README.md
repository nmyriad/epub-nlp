# epub-nlp

A CLI (Command Line Interface) tool for deep NLP (Natural Language Processing) analysis of EPUB (Electronic Publication) books.

Extracts and analyzes text across every chapter, producing structured JSON and CSV reports covering parts of speech, phrases, named entities, sentence structure, and frequency statistics. Includes a persistent word database that tracks the first time each word appears across your entire library, with translation and Anki deck export for vocabulary study.

* CLI — Command Line Interface
* NLP — Natural Language Processing
* EPUB — Electronic Publication

---

## Why This Is Useful for Language Learning

If you're reading books in a foreign language, epub-nlp can supercharge your vocabulary study. For example, running it on **Cien años de soledad** by Gabriel García Márquez or **La sombra del viento** by Carlos Ruiz Zafón — two of the most celebrated Spanish-language novels — produces a complete breakdown of every noun, verb, and adjective in the book, ranked by how often they appear.

From that, you can:
- **Translate vocabulary automatically** — words are translated via DeepL or MyMemory and stored permanently in your database
- **Export directly to Anki** — generate flashcard decks organized by part of speech (Nouns, Verbs, Adjectives, Adverbs)
- **Push cards straight into Anki** — no file import needed with AnkiConnect
- **Track new vocabulary across books** — process *La sombra del viento*, then *Don Quijote*, and the database only adds words it hasn't seen before
- **Focus on high-frequency words first** — the top-100 adjectives and verbs report tells you exactly which words are worth learning
- **See where a word first appeared** — every Anki card includes the book it came from

This works for any language your EPUB is written in.

---

## Features

- **EPUB Parsing** — Reads spine order, extracts clean text from each chapter
- **Part-of-Speech Tagging** — Nouns, verbs, adjectives, adverbs, pronouns, prepositions, conjunctions
- **Phrase Extraction** — Noun phrases, verb phrases, prepositional phrases
- **Named Entity Recognition** — People, places, organizations, dates, numeric values
- **Sentence Analysis** — Count, average length, longest/shortest sentences
- **Frequency Statistics** — Top words, nouns, verbs, adjectives across the full book
- **Word Database** — Persistent local database tracking first occurrence of every word across all books
- **Translation** — Batch translate vocabulary via DeepL (recommended) or MyMemory (free, no setup)
- **Anki Export** — Export flashcard decks organized by part of speech, with translations on the back
- **AnkiConnect** — Push cards directly into Anki without any file import
- **Drag & Drop UI** — Local web interface, no technical knowledge required after setup
- **Top-100 Report** — Plain text report of the top 100 adjectives and verbs

---

## Software You'll Need

### Node.js
Node.js is the engine that runs this tool. Download and install **version 18 or higher** from:
👉 https://nodejs.org (choose the LTS version)

To check if you already have it installed, open PowerShell and run:
```powershell
node --version
```
If you see a version number (e.g. `v22.0.0`), you're good to go.

### Git
Git is version control software — it lets you download this project and track changes over time. Download it from:
👉 https://git-scm.com/download/win

To check if you already have it:
```powershell
git --version
```

### PowerShell
PowerShell comes pre-installed on Windows. Search for it in the Start menu. All commands in this guide are written for PowerShell.

### Anki (optional but recommended)
Download Anki from:
👉 https://apps.ankiweb.net

### AnkiConnect plugin (optional, for direct push)
AnkiConnect lets epub-nlp push cards directly into Anki without any file import. To install:
1. Open Anki
2. Go to **Tools → Add-ons → Get Add-ons**
3. Enter code: `2055492159`
4. Restart Anki

Once installed, keep Anki open while using the epub-nlp UI and cards will be pushed directly into your decks.

---

## Translation Setup

epub-nlp supports two translation providers. **DeepL is strongly recommended** for quality, especially for Spanish/English.

### ⭐ DeepL (Strongly Recommended)

DeepL produces significantly better translations than free alternatives, particularly for Spanish, French, German, and Italian. The free tier gives you **500,000 characters per month** — more than enough for a full library of books.

**To get your free DeepL API key:**
1. Go to 👉 https://www.deepl.com/pro-api
2. Click **"Sign up for free"** under the Free plan
3. Create an account (no credit card required for the free tier)
4. Go to your **Account → API Keys**
5. Copy your API key
6. Paste it into the **DeepL API Key** field in the epub-nlp UI

### MyMemory (Free, No Setup)

MyMemory requires no account or API key — it works out of the box. It has a limit of **5,000 words per day** and lower translation quality than DeepL. Use it if you just want to try the tool before setting up DeepL.

---

## Installation

**Step 1 — Clone the repository**

"Cloning" means downloading a copy of the project from GitHub to your computer. Open PowerShell and run:

```powershell
git clone https://github.com/nmyriad/epub-nlp.git
```

**Step 2 — Enter the project folder**

```powershell
cd epub-nlp
```

**Step 3 — Install dependencies**

```powershell
npm install
```

You only need to do steps 1–3 once.

---

## Quick Start — One Line Installer

Alternatively, paste this single command into PowerShell (run as Administrator) to install everything automatically:

```powershell
irm https://raw.githubusercontent.com/nmyriad/epub-nlp/main/install.ps1 | iex
```

---

## Usage

### Launch the UI (recommended)

```powershell
cd C:\Users\YourName\epub-nlp
node src/index.js ui
```

Your browser opens automatically at `http://localhost:3000`. From there:
1. Select the book's language (or leave as Auto-detect)
2. Drag and drop an EPUB onto the page
3. Wait for analysis to complete
4. Use the **Translate & Export** panel to translate and export vocabulary

### Command line analysis

```powershell
node src/index.js analyze "C:\path\to\your-book.epub"
```

### Common options

```powershell
# Analyze specific chapters only
node src/index.js analyze "Books\my-book.epub" --chapters 1,2,5

# Generate a top-100 adjectives and verbs report
node src/index.js analyze "Books\my-book.epub" --top-words

# Skip updating the word database
node src/index.js analyze "Books\my-book.epub" --no-update-db
```

---

## Word Database & Translation

Every time you analyze a book, new words are automatically added to a local database (`word-database.json`). Words already seen in a previous book are skipped — so your database only grows with genuinely new vocabulary.

### Translating vocabulary

In the UI, use the **Translate & Export** panel:
1. Set your filters (language, book, part of speech)
2. The preview box shows how many words need translation
3. Select your provider (DeepL recommended) and paste your API key if using DeepL
4. Click **Translate Selected**
5. A live progress bar shows each word being translated
6. Translations are saved permanently — they are never re-fetched

### Anki card format

- **Front:** the word (e.g. `novia`)
- **Back:** translation • part of speech • book (e.g. `girlfriend • [noun] • La sombra del viento`)
- **Tags:** `epub-nlp`, `noun`, `la-sombra-del-viento`

### Anki deck organization

Cards are organized into sub-decks by part of speech:
- `epub-nlp::Nouns`
- `epub-nlp::Verbs`
- `epub-nlp::Adjectives`
- `epub-nlp::Adverbs`

This lets you study all vocabulary together, or drill specific word types.

---

## CLI — Word Database Commands

```powershell
# Check database stats
node src/index.js db stats

# Export new words to an Anki-importable file
node src/index.js db export-anki

# Export new words to CSV
node src/index.js db export-csv

# Export only nouns
node src/index.js db export-anki --pos noun

# Export only verbs
node src/index.js db export-anki --pos verb

# Export from a specific language
node src/index.js db export-anki --language spa

# Export everything (including already exported words)
node src/index.js db export-anki --all

# Reset exported flags so everything can be re-exported
node src/index.js db reset-exports
```

---

## Output Files

All files are saved to `./output/` by default.

| File | Contents |
|------|----------|
| `<title>.json` | Full analysis — all POS, phrases, entities, per-chapter breakdowns |
| `<title>_summary.csv` | Flat summary for Excel or Google Sheets |
| `<title>_top_words.txt` | Top 100 adjectives and top 100 verbs |
| `anki_vocab_<date>.txt` | Anki-importable flashcard file |
| `vocab_export_<date>.csv` | Full word database export with translations |

---

## Project Structure

```
epub-nlp/
├── src/
│   ├── index.js        # CLI entry point
│   ├── parser.js       # EPUB unzip + text extraction
│   ├── analyze.js      # NLP analysis (compromise.js)
│   ├── output.js       # Terminal display and file export
│   ├── worddb.js       # Persistent word database
│   ├── vocab-export.js # Anki and CSV export
│   ├── translator.js   # Translation engine (MyMemory + DeepL)
│   ├── server.js       # Drag & drop web UI
│   └── updater.js      # Auto-update checker
├── output/             # Generated results (gitignored)
├── word-database.json  # Your word database (gitignored)
├── install.ps1         # One-line Windows installer
├── .gitignore
├── package.json
└── README.md
```

---

## Tech Stack

| Library | Purpose |
|---------|---------|
| [compromise](https://github.com/spencermountain/compromise) | NLP — POS tagging, entities, phrases |
| [jszip](https://stuk.github.io/jszip/) | EPUB unzipping |
| [node-html-parser](https://github.com/taoqf/node-html-parser) | HTML extraction from EPUB chapters |
| [franc-min](https://github.com/wooorm/franc) | Language detection |
| [lowdb](https://github.com/typicode/lowdb) | Persistent local word database |
| [express](https://expressjs.com) | Local web server for UI |
| [commander](https://github.com/tj/commander.js/) | CLI argument parsing |
| [ora](https://github.com/sindresorhus/ora) | Terminal spinners |
| [chalk](https://github.com/chalk/chalk) | Terminal colors |
| [cli-table3](https://github.com/cli-table/cli-table3) | Terminal tables |
| [open](https://github.com/sindresorhus/open) | Auto-opens browser |

---

## License

MIT
