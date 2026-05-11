#!/usr/bin/env node
// src/index.js
// epub-nlp CLI entry point

import { program } from "commander";
import ora from "ora";
import chalk from "chalk";
import path from "path";
import { parseEpub } from "./parser.js";
import { analyzeText, mergeAnalyses } from "./analyze.js";
import { writeJson, writeCsv, printSummary } from "./output.js";

program
  .name("epub-nlp")
  .description("Deep NLP analysis of EPUB books — POS tagging, phrases, entities, frequency stats")
  .version("1.0.0")
  .argument("<epub>", "Path to the .epub file")
  .option("-o, --output <dir>", "Output directory for results", "./output")
  .option("--json", "Export full results as JSON", true)
  .option("--csv", "Export summary as CSV", true)
  .option("--no-json", "Skip JSON export")
  .option("--no-csv", "Skip CSV export")
  .option("--chapters <list>", "Analyze only specific chapters (comma-separated indices, e.g. 1,2,5)")
  .option("--quiet", "Skip terminal summary, only write files")
  .action(async (epubPath, opts) => {
    console.log(chalk.bold.cyan("\n📖 epub-nlp — starting analysis\n"));

    const absolutePath = path.resolve(epubPath);

    // ── Step 1: Parse EPUB ──────────────────────────────────────────────────
    const parseSpinner = ora("Parsing EPUB structure...").start();
    let parsed;
    try {
      parsed = await parseEpub(absolutePath);
      parseSpinner.succeed(
        `Parsed "${chalk.bold(parsed.title)}" — ${parsed.chapters.length} chapters found`
      );
    } catch (err) {
      parseSpinner.fail("Failed to parse EPUB");
      console.error(chalk.red(err.message));
      process.exit(1);
    }

    // ── Step 2: Filter chapters if requested ────────────────────────────────
    let chapters = parsed.chapters;
    if (opts.chapters) {
      const indices = opts.chapters.split(",").map((n) => parseInt(n.trim(), 10) - 1);
      chapters = chapters.filter((_, i) => indices.includes(i));
      console.log(chalk.dim(`  → Analyzing chapters: ${opts.chapters}`));
    }

    // ── Step 3: NLP Analysis per chapter ────────────────────────────────────
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

    // ── Step 4: Merge into book-level result ────────────────────────────────
    const bookResult = mergeAnalyses(chapterResults, parsed.title);

    // ── Step 5: Export files ─────────────────────────────────────────────────
    const outputDir = path.resolve(opts.output);
    const safeTitle = parsed.title.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const exportSpinner = ora("Writing output files...").start();

    const written = [];
    try {
      if (opts.json) {
        const jsonPath = await writeJson(bookResult, outputDir, `${safeTitle}.json`);
        written.push(jsonPath);
      }
      if (opts.csv) {
        const csvPath = await writeCsv(bookResult, outputDir, `${safeTitle}_summary.csv`);
        written.push(csvPath);
      }
      exportSpinner.succeed("Files written:");
      for (const f of written) console.log("  " + chalk.green("✔") + " " + chalk.underline(f));
    } catch (err) {
      exportSpinner.fail("Failed to write output");
      console.error(chalk.red(err.message));
      process.exit(1);
    }

    // ── Step 6: Terminal summary ─────────────────────────────────────────────
    if (!opts.quiet) {
      printSummary(bookResult);
    }

    console.log(chalk.bold.green("\n✅  Done!\n"));
  });

program.parse();
