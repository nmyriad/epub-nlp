# epub-nlp

A CLI tool for deep NLP analysis of EPUB books.

Extracts and analyzes text across every chapter, producing structured JSON and CSV reports covering parts of speech, phrases, named entities, sentence structure, and frequency statistics.

---

## Features

- **EPUB Parsing** — Reads spine order, extracts clean text from each chapter
- **Part-of-Speech Tagging** — Nouns, verbs, adjectives, adverbs, pronouns, prepositions, conjunctions
- **Phrase Extraction** — Noun phrases, verb phrases, prepositional phrases
- **Named Entity Recognition** — People, places, organizations, dates, numeric values
- **Sentence Analysis** — Count, average length, longest/shortest sentences
- **Frequency Statistics** — Top words, nouns, verbs, adjectives across the full book
- **Export** — Full JSON output + summary CSV

---

## Requirements

- Node.js >= 18.0.0

---

## Installation

```bash
git clone https://github.com/nmyriad/epub-nlp.git
cd epub-nlp
npm install
```

---

## Usage

```bash
node src/index.js <path-to-file.epub> [options]
```

### Options

| Flag | Description | Default |
|------|-------------|---------|
| `-o, --output <dir>` | Output directory for result files | `./output` |
| `--json` / `--no-json` | Enable/disable JSON export | enabled |
| `--csv` / `--no-csv` | Enable/disable CSV export | enabled |
| `--chapters <list>` | Analyze specific chapters only (e.g. `1,3,5`) | all |
| `--quiet` | Skip terminal summary, only write files | off |

### Examples

```bash
# Analyze a full book, export to ./output
node src/index.js my-book.epub

# Analyze only chapters 1, 2, and 5
node src/index.js my-book.epub --chapters 1,2,5

# Export JSON only, save to custom directory
node src/index.js my-book.epub --no-csv -o ./results

# Suppress terminal output (useful for scripting)
node src/index.js my-book.epub --quiet
```

---

## Output

### JSON (`<title>.json`)

Full structured data including all POS arrays, phrases, entities, per-chapter breakdowns, and frequency maps.

```json
{
  "bookTitle": "My Book",
  "chapterCount": 18,
  "summary": { "totalWords": 82000, "sentenceCount": 4100 },
  "pos": { "nouns": [...], "verbs": [...], "adjectives": [...] },
  "phrases": { "nounPhrases": [...], "verbPhrases": [...] },
  "entities": { "people": [...], "places": [...] },
  "frequency": { "topWords": { "said": 312, ... } },
  "chapters": [...]
}
```

### CSV (`<title>_summary.csv`)

Flat summary suitable for spreadsheet analysis: top words, nouns, verbs, adjectives, and entities.

---

## Project Structure

```
epub-nlp/
├── src/
│   ├── index.js      # CLI entry point (Commander)
│   ├── parser.js     # EPUB unzip + text extraction
│   ├── analyze.js    # NLP analysis (compromise.js)
│   └── output.js     # JSON/CSV export + terminal printing
├── output/           # Generated results (gitignored)
├── test/             # Test scripts
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
| [commander](https://github.com/tj/commander.js/) | CLI argument parsing |
| [ora](https://github.com/sindresorhus/ora) | Terminal spinners |
| [chalk](https://github.com/chalk/chalk) | Terminal colors |
| [cli-table3](https://github.com/cli-table/cli-table3) | Terminal tables |

---

## License

MIT
