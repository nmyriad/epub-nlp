// src/output.js
// Handles writing results to JSON and/or CSV, and pretty terminal printing

import fs from "fs/promises";
import path from "path";
import Table from "cli-table3";
import chalk from "chalk";

// ── File Exports ────────────────────────────────────────────────────────────

export async function writeJson(data, outputDir, filename) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

export async function writeCsv(data, outputDir, filename) {
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, filename);
  const csv = buildCsv(data);
  await fs.writeFile(filePath, csv, "utf-8");
  return filePath;
}

function buildCsv(data) {
  const rows = [];

  // ── Summary ──
  rows.push(["Section", "Key", "Value"]);
  rows.push(["Summary", "Book Title", data.bookTitle]);
  rows.push(["Summary", "Chapter Count", data.chapterCount]);
  rows.push(["Summary", "Total Words", data.summary.totalWords]);
  rows.push(["Summary", "Unique Words (approx)", data.summary.uniqueWords]);
  rows.push(["Summary", "Total Sentences", data.summary.sentenceCount]);
  rows.push([]);

  // ── Top Frequency Words ──
  rows.push(["Top Words", "Word", "Count"]);
  for (const [word, count] of Object.entries(data.frequency.topWords)) {
    rows.push(["Top Words", word, count]);
  }
  rows.push([]);

  // ── Top Nouns ──
  rows.push(["Top Nouns", "Noun", "Count"]);
  for (const [word, count] of Object.entries(data.frequency.topNouns)) {
    rows.push(["Top Nouns", word, count]);
  }
  rows.push([]);

  // ── Top Verbs ──
  rows.push(["Top Verbs", "Verb", "Count"]);
  for (const [word, count] of Object.entries(data.frequency.topVerbs)) {
    rows.push(["Top Verbs", word, count]);
  }
  rows.push([]);

  // ── Top Adjectives ──
  rows.push(["Top Adjectives", "Adjective", "Count"]);
  for (const [word, count] of Object.entries(data.frequency.topAdjectives)) {
    rows.push(["Top Adjectives", word, count]);
  }
  rows.push([]);

  // ── Named Entities ──
  rows.push(["Entities", "Type", "Values"]);
  rows.push(["Entities", "People", data.entities.people.join("; ")]);
  rows.push(["Entities", "Places", data.entities.places.join("; ")]);
  rows.push(["Entities", "Organizations", data.entities.organizations.join("; ")]);
  rows.push(["Entities", "Dates", data.entities.dates.join("; ")]);

  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

function csvEscape(val) {
  if (val === undefined || val === null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── Terminal Output ─────────────────────────────────────────────────────────

export function printSummary(data) {
  console.log("\n" + chalk.bold.cyan("═".repeat(60)));
  console.log(chalk.bold.white(`  📚  ${data.bookTitle}`));
  console.log(chalk.cyan("═".repeat(60)));

  // Summary table
  const summaryTable = new Table({
    head: [chalk.bold("Metric"), chalk.bold("Value")],
    style: { head: [], border: [] },
  });
  summaryTable.push(
    ["Chapters analyzed", chalk.yellow(data.chapterCount)],
    ["Total words", chalk.yellow(data.summary.totalWords.toLocaleString())],
    ["Unique words (approx)", chalk.yellow(data.summary.uniqueWords.toLocaleString())],
    ["Total sentences", chalk.yellow(data.summary.sentenceCount.toLocaleString())]
  );
  console.log("\n" + chalk.bold("📊  Summary"));
  console.log(summaryTable.toString());

  // Frequency tables
  printFreqTable("🔤  Top 20 Words", data.frequency.topWords);
  printFreqTable("📦  Top Nouns", data.frequency.topNouns);
  printFreqTable("⚡  Top Verbs", data.frequency.topVerbs);
  printFreqTable("🎨  Top Adjectives", data.frequency.topAdjectives);

  // Entities
  console.log("\n" + chalk.bold("🏷️   Named Entities"));
  const entTable = new Table({
    head: [chalk.bold("Type"), chalk.bold("Found")],
    style: { head: [], border: [] },
    colWidths: [18, 70],
    wordWrap: true,
  });
  entTable.push(
    ["People", chalk.green(data.entities.people.slice(0, 15).join(", ") || "—")],
    ["Places", chalk.green(data.entities.places.slice(0, 15).join(", ") || "—")],
    ["Organizations", chalk.green(data.entities.organizations.slice(0, 10).join(", ") || "—")],
    ["Dates", chalk.green(data.entities.dates.slice(0, 10).join(", ") || "—")]
  );
  console.log(entTable.toString());

  // POS counts
  console.log("\n" + chalk.bold("🧬  Part-of-Speech Counts"));
  const posTable = new Table({
    head: [chalk.bold("POS"), chalk.bold("Unique Count")],
    style: { head: [], border: [] },
  });
  for (const [pos, items] of Object.entries(data.pos)) {
    posTable.push([capitalize(pos), chalk.magenta(items.length.toLocaleString())]);
  }
  console.log(posTable.toString());

  console.log("\n" + chalk.bold("💬  Phrase Counts"));
  const phraseTable = new Table({
    head: [chalk.bold("Phrase Type"), chalk.bold("Unique Count")],
    style: { head: [], border: [] },
  });
  for (const [type, items] of Object.entries(data.phrases)) {
    phraseTable.push([capitalize(type), chalk.blue(items.length.toLocaleString())]);
  }
  console.log(phraseTable.toString());
  console.log();
}

function printFreqTable(label, freqObj) {
  console.log("\n" + chalk.bold(label));
  const t = new Table({
    head: [chalk.bold("Term"), chalk.bold("Count")],
    style: { head: [], border: [] },
  });
  for (const [word, count] of Object.entries(freqObj)) {
    t.push([word, chalk.yellow(count)]);
  }
  console.log(t.toString());
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, " $1");
}
