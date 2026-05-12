#!/usr/bin/env node
// src/index.js
// epub-nlp CLI — EPUB analysis + persistent word database + Anki/vocab export

import { program } from "commander";
import ora from "ora";
import chalk from "chalk";
import path from "path";
import { parseEpub } from "./parser.js";
import { analyzeText, mergeAnalyses } from "./analyze.js";
import { writeJson, writeCsv, printSummary } from "./output.js";
import { ingestBookWords, getUnexportedWords, getAllWords, getDbStats, resetExportedFlags } from "./worddb.js";
import { exportToAnki, exportToVocabCsv, exportTopWordsReport } from "./vocab-export.js";
import { checkForUpdates } from "./updater.js";

checkForUpdates();

program
  .name("epub-nlp")
  .description("Deep NLP analysis of EPUB books — POS, phrases, entities, word database, Anki export")
  .version("1.4.0");

// ── Command: analyze ────────────────────────────────────────────────────────

program
  .command("analyze <epub>", { isDefault: true })
  .description("Analyze an EPUB and optionally update the word database")
  .option("-o, --output <dir>", "Output directory for results", "./output")
  .option("--no-json", "Skip JSON export")
  .option("--no-csv", "Skip CSV export")
  .option("--chapters <list>", "Analyze only specific chapters, e.g. 1,2,5")
  .option("--quiet", "Skip terminal summary")
  .option("--top-words", "Export top-100 adjectives and verbs as a text report")
  .option("--no-update-db", "Skip updating the word database")
  .action(async (epubPath, opts) => {
    console.log(chalk.bold.cyan("\n📖 epub-nlp — starting analysis\n"));

    const absolutePath = path.resolve(epubPath);

    const parseSpinner = ora("Parsing EPUB structure...").start();
    let parsed;
    try {
      parsed = await parseEpub(absolutePath);
      parseSpinner.succeed(`Parsed "${chalk.bold(parsed.title)}" — ${parsed.chapters.length} chapters found`);
    } catch (err) {
      parseSpinner.fail("Failed to parse EPUB");
      console.error(chalk.red(err.message));
      process.exit(1);
    }

    let chapters = parsed.chapters;
    if (opts.chapters) {
      const indices = opts.chapters.split(",").map((n) => parseInt(n.trim(), 10) - 1);
      chapters = chapters.filter((_, i) => indices.includes(i));
      console.log(chalk.dim(`  → Analyzing chapters: ${opts.chapters}`));
    }

    const analysisSpinner = ora(`Analyzing ${chapters.length} chapters...`).start();
    const chapterResults = [];

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      analysisSpinner.text = `Analyzing chapter ${i + 1}/${chapters.length}: "${ch.title}"`;
      try {
        const result = analyzeText(ch.text, ch.id);
        result.chapterTitle = ch.title;
        result.chapterIndex = i + 1;
        chapterResults.push(result);
      } catch (err) {
        console.warn(chalk.yellow(`  ⚠ Skipped chapter "${ch.title}": ${err.message}`));
      }
    }

    analysisSpinner.succeed(`Analysis complete — ${chapterResults.length} chapters processed`);

    const bookResult = mergeAnalyses(chapterResults, parsed.title);
    const outputDir = path.resolve(opts.output);
    const safeTitle = parsed.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const exportSpinner = ora("Writing output files...").start();
    const written = [];

    try {
      if (opts.json !== false) {
        written.push(await writeJson(bookResult, outputDir, `${safeTitle}.json`));
      }
      if (opts.csv !== false) {
        written.push(await writeCsv(bookResult, outputDir, `${safeTitle}_summary.csv`));
      }
      if (opts.topWords) {
        written.push(await exportTopWordsReport(bookResult, outputDir, `${safeTitle}_top_words.txt`));
      }
      exportSpinner.succeed("Files written:");
      for (const f of written) console.log("  " + chalk.green("✔") + " " + chalk.underline(f));
    } catch (err) {
      exportSpinner.fail("Failed to write output: " + err.message);
      process.exit(1);
    }

    if (opts.updateDb !== false) {
      const dbSpinner = ora("Updating word database...").start();
      try {
        const { added, skipped } = await ingestBookWords(bookResult);
        dbSpinner.succeed(
          `Word database updated — ${chalk.green(added.length + " new words")} added, ${chalk.dim(skipped + " already known")}`
        );
        if (added.length > 0 && added.length <= 20) {
          console.log(chalk.dim("  New words: " + added.join(", ")));
        }
      } catch (err) {
        dbSpinner.fail("Word database error: " + err.message);
      }
    }

    if (!opts.quiet) printSummary(bookResult);
    console.log(chalk.bold.green("\n✅  Done!\n"));
  });

// ── Command: db ─────────────────────────────────────────────────────────────

const db = program.command("db").description("Manage and export the persistent word database");

db.command("stats")
  .description("Show word database statistics")
  .action(async () => {
    const stats = await getDbStats();
    console.log("\n" + chalk.bold.cyan("📚  Word Database Stats\n"));
    console.log(`  Total words:    ${chalk.yellow(stats.totalWords.toLocaleString())}`);
    console.log(`  Unexported:     ${chalk.green(stats.unexportedWords.toLocaleString())}`);
    console.log(`  Already exported: ${chalk.dim(stats.exportedWords.toLocaleString())}`);
    console.log(`  Last updated:   ${chalk.dim(new Date(stats.lastUpdated).toLocaleString())}`);
    console.log("\n  By part of speech:");
    for (const [pos, count] of Object.entries(stats.byPos)) {
      console.log(`    ${pos.padEnd(14)} ${chalk.magenta(count.toLocaleString())}`);
    }
    console.log();
  });

db.command("export-anki")
  .description("Export new words to an Anki-importable TSV file")
  .option("-o, --output <dir>", "Output directory", "./output")
  .option("--all", "Export all words, not just unexported ones")
  .option("--pos <pos>", "Filter by POS: noun, verb, adjective, adverb")
  .option("--no-mark", "Don't mark words as exported after writing")
  .action(async (opts) => {
    const spinner = ora("Preparing Anki export...").start();
    try {
      let words = opts.all ? await getAllWords(opts.pos || null) : await getUnexportedWords();
      if (opts.pos && !opts.all) words = words.filter((w) => w.pos === opts.pos);

      if (words.length === 0) {
        spinner.info("No new words to export. Use --all to export everything.");
        return;
      }

      const timestamp = new Date().toISOString().slice(0, 10);
      const filePath = await exportToAnki(
        words,
        path.resolve(opts.output),
        `anki_vocab_${timestamp}.txt`,
        opts.mark !== false
      );

      spinner.succeed(`Exported ${chalk.green(words.length + " words")} to Anki file:`);
      console.log("  " + chalk.underline(filePath));
      console.log(chalk.dim("\n  To import: Open Anki → File → Import → select this file\n"));
    } catch (err) {
      spinner.fail("Export failed: " + err.message);
    }
  });

db.command("export-csv")
  .description("Export word database to CSV")
  .option("-o, --output <dir>", "Output directory", "./output")
  .option("--all", "Export all words, not just unexported ones")
  .option("--pos <pos>", "Filter by POS: noun, verb, adjective, adverb")
  .option("--no-mark", "Don't mark words as exported after writing")
  .action(async (opts) => {
    const spinner = ora("Preparing CSV export...").start();
    try {
      let words = opts.all ? await getAllWords(opts.pos || null) : await getUnexportedWords();
      if (opts.pos && !opts.all) words = words.filter((w) => w.pos === opts.pos);

      if (words.length === 0) {
        spinner.info("No new words to export. Use --all to export everything.");
        return;
      }

      const timestamp = new Date().toISOString().slice(0, 10);
      const filePath = await exportToVocabCsv(
        words,
        path.resolve(opts.output),
        `vocab_export_${timestamp}.csv`,
        opts.mark !== false
      );

      spinner.succeed(`Exported ${chalk.green(words.length + " words")} to CSV:`);
      console.log("  " + chalk.underline(filePath));
      console.log();
    } catch (err) {
      spinner.fail("Export failed: " + err.message);
    }
  });

db.command("reset-exports")
  .description("Mark all words as unexported so they can be re-exported")
  .action(async () => {
    await resetExportedFlags();
    console.log(chalk.green("\n✔  All words marked as unexported.\n"));
  });

// ── Command: ui ──────────────────────────────────────────────────────────────

program
  .command("ui")
  .description("Launch the drag-and-drop web UI in your browser")
  .action(async () => {
    const { startServer } = await import("./server.js");
    await startServer();
  });

program.parse();
