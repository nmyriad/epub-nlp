// src/updater.js
// Checks GitHub for the latest version and notifies the user if an update is available.
// Runs silently in the background — never blocks the main command.

import chalk from "chalk";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const GITHUB_REPO = "nmyriad/epub-nlp";
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const REPO_URL = `https://github.com/${GITHUB_REPO}`;

/**
 * Get the current local version from package.json
 */
function getLocalVersion() {
  try {
    const pkg = require("../package.json");
    return pkg.version;
  } catch {
    return null;
  }
}

/**
 * Compare two semver strings. Returns true if remote is newer than local.
 * e.g. "1.2.0" > "1.1.0" → true
 */
function isNewer(local, remote) {
  const parse = (v) => v.replace(/^v/, "").split(".").map(Number);
  const [lMaj, lMin, lPat] = parse(local);
  const [rMaj, rMin, rPat] = parse(remote);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPat > lPat;
}

/**
 * Fetch the latest release tag from GitHub API.
 * Times out after 3 seconds so it never slows the tool down.
 */
async function fetchLatestVersion() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(RELEASES_URL, {
      signal: controller.signal,
      headers: { "User-Agent": "epub-nlp-updater" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    return data.tag_name?.replace(/^v/, "") || null;
  } catch {
    clearTimeout(timeout);
    return null; // Silently fail — no internet, rate limit, etc.
  }
}

/**
 * Main export — run this at startup.
 * Prints a friendly update notice if a newer version exists.
 * Completely silent if up to date or if the check fails.
 */
export async function checkForUpdates() {
  const localVersion = getLocalVersion();
  if (!localVersion) return;

  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) return;

  if (isNewer(localVersion, latestVersion)) {
    console.log("");
    console.log(
      chalk.yellow("  ┌─────────────────────────────────────────────────┐")
    );
    console.log(
      chalk.yellow("  │") +
      chalk.bold(`  Update available! ${chalk.dim("v" + localVersion)} → ${chalk.green("v" + latestVersion)}`) +
      chalk.yellow("          │")
    );
    console.log(
      chalk.yellow("  │") +
      chalk.dim(`  Run the installer to update:`) +
      chalk.yellow("                    │")
    );
    console.log(
      chalk.yellow("  │") +
      chalk.cyan(`  irm ${REPO_URL}/raw/main/install.ps1 | iex`) +
      chalk.yellow(" │")
    );
    console.log(
      chalk.yellow("  └─────────────────────────────────────────────────┘")
    );
    console.log("");
  }
}
