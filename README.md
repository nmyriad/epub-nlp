# epub-nlp

A CLI (Command Line Interface) tool for deep NLP (Natural Language Processing) analysis of EPUB (Electronic Publication) books.

Extracts and analyzes text across every chapter, producing structured JSON and CSV reports covering parts of speech, phrases, named entities, sentence structure, and frequency statistics. Includes a persistent word database that tracks the first time each word appears across your entire library, with Anki deck export for vocabulary study.

\---

## Why This Is Useful for Language Learning

If you're reading books in a foreign language, epub-nlp can supercharge your vocabulary study. For example, running it on **Cien años de soledad** by Gabriel García Márquez — one of the most celebrated Spanish-language novels — produces a complete breakdown of every noun, verb, and adjective in the book, ranked by how often they appear.

From that, you can:

* **Export directly to Anki** — generate flashcard decks of the most common words
* **Track new vocabulary across books** — process *Cien años de soledad*, then *Don Quijote*, and the database will only add words it hasn't seen before
* **Focus on high-frequency words first** — the top-100 adjectives and verbs report tells you exactly which words are worth learning for that author's style
* **See where a word first appeared** — every Anki card includes the book and chapter where the word showed up for the first time

This works for any language your EPUB is written in.

\---

## Features

* **EPUB Parsing** — Reads spine order, extracts clean text from each chapter
* **Part-of-Speech Tagging** — Nouns, verbs, adjectives, adverbs, pronouns, prepositions, conjunctions
* **Phrase Extraction** — Noun phrases, verb phrases, prepositional phrases
* **Named Entity Recognition** — People, places, organizations, dates, numeric values
* **Sentence Analysis** — Count, average length, longest/shortest sentences
* **Frequency Statistics** — Top words, nouns, verbs, adjectives across the full book
* **Word Database** — Persistent local database tracking first occurrence of every word across all books
* **Anki Export** — Export new vocabulary as Anki-importable flashcard decks
* **Top-100 Report** — Plain text report of the top 100 adjectives and verbs

\---

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

### Anki (optional)

If you want to use the vocabulary flashcard export, download Anki from:
👉 https://apps.ankiweb.net

\---

## Installation

**Step 1 — Clone the repository**

"Cloning" means downloading a copy of the project from GitHub to your computer. Open PowerShell and run:

```powershell
git clone https://github.com/nmyriad/epub-nlp.git
```

This creates a folder called `epub-nlp` wherever PowerShell is currently pointed.

**Step 2 — Enter the project folder**

```powershell
cd epub-nlp
```

**Step 3 — Install dependencies**

This downloads all the libraries the tool needs to run:

```powershell
npm install
```

You only need to do steps 1–3 once.

\---

## Usage

Always make sure you're in the `epub-nlp` folder first:

```powershell
cd C:\\Users\\YourName\\epub-nlp
```

### Analyze a book

```powershell
node src/index.js analyze "C:\\path\\to\\your-book.epub"
```

Results are saved to the `output/` folder automatically.

### Common options

```powershell
# Analyze specific chapters only
node src/index.js analyze "Books\\my-book.epub" --chapters 1,2,5

# Generate a top-100 adjectives and verbs report
node src/index.js analyze "Books\\my-book.epub" --top-words

# Export JSON only (no CSV)
node src/index.js analyze "Books\\my-book.epub" --no-csv

# Save output to a custom folder
node src/index.js analyze "Books\\my-book.epub" -o ./results
```

\---

## Word Database \& Anki Export

Every time you analyze a book, new words are automatically added to a local database (`word-database.json`). Words already seen in a previous book are skipped — so your database only grows with genuinely new vocabulary.

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

# Export everything (including already exported words)
node src/index.js db export-anki --all

# Reset so everything can be exported again
node src/index.js db reset-exports
```

### Importing into Anki

1. Run `node src/index.js db export-anki`
2. Open Anki → **File → Import**
3. Select the `.txt` file from your `output/` folder
4. Each card has the word on the front, and the book + chapter it first appeared in on the back
5. Fill in your own definitions and translations

\---

## Output Files

All files are saved to `./output/` by default.

|File|Contents|
|-|-|
|`<title>.json`|Full analysis — all POS, phrases, entities, per-chapter breakdowns|
|`<title>\_summary.csv`|Flat summary for Excel or Google Sheets|
|`<title>\_top\_words.txt`|Top 100 adjectives and top 100 verbs|
|`anki\_vocab\_<date>.txt`|Anki-importable flashcard file|
|`vocab\_export\_<date>.csv`|Full word database export|

\---

## Project Structure

```
epub-nlp/
├── src/
│   ├── index.js        # CLI entry point
│   ├── parser.js       # EPUB unzip + text extraction
│   ├── analyze.js      # NLP analysis (compromise.js)
│   ├── output.js       # JSON/CSV export + terminal display
│   ├── worddb.js       # Persistent word database
│   └── vocab-export.js # Anki + vocabulary export
├── output/             # Generated results (gitignored)
├── word-database.json  # Your word database (gitignored)
├── .gitignore
├── package.json
└── README.md
```

\---

## Tech Stack

|Library|Purpose|
|-|-|
|[compromise](https://github.com/spencermountain/compromise)|NLP — POS tagging, entities, phrases|
|[jszip](https://stuk.github.io/jszip/)|EPUB unzipping|
|[node-html-parser](https://github.com/taoqf/node-html-parser)|HTML extraction from EPUB chapters|
|[lowdb](https://github.com/typicode/lowdb)|Persistent local word database|
|[commander](https://github.com/tj/commander.js/)|CLI argument parsing|
|[ora](https://github.com/sindresorhus/ora)|Terminal spinners|
|[chalk](https://github.com/chalk/chalk)|Terminal colors|
|[cli-table3](https://github.com/cli-table/cli-table3)|Terminal tables|

\---

## License

MIT - enjoi! 
- nmyriad

