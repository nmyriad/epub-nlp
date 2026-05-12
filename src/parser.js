// src/parser.js
// Extracts and cleans raw text from an EPUB file

import JSZip from "jszip";
import { parse as parseHtml } from "node-html-parser";
import fs from "fs/promises";
import path from "path";

/**
 * Load and unzip an EPUB file, returning ordered chapter text.
 * @param {string} epubPath - Absolute or relative path to the .epub file
 * @returns {Promise<{ title: string, chapters: { id: string, title: string, text: string }[] }>}
 */
export async function parseEpub(epubPath) {
  const buffer = await fs.readFile(epubPath);
  const zip = await JSZip.loadAsync(buffer);

  // 1. Find and parse container.xml to locate the OPF file
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("Invalid EPUB: missing META-INF/container.xml");

  const containerDoc = parseHtml(containerXml);
  const opfPath = containerDoc.querySelector("rootfile")?.getAttribute("full-path");
  if (!opfPath) throw new Error("Invalid EPUB: cannot find OPF path in container.xml");

  // 2. Parse the OPF (Open Packaging Format) file
  const opfContent = await zip.file(opfPath)?.async("string");
  if (!opfContent) throw new Error(`Invalid EPUB: cannot read OPF at ${opfPath}`);

  const opfDoc = parseHtml(opfContent);
  const opfDir = path.dirname(opfPath);

  // 3. Extract book title
  const title =
    opfDoc.querySelector("dc\\:title, title")?.text?.trim() || path.basename(epubPath, ".epub");

  // 4. Build a manifest map: id -> href
  const manifest = {};
  opfDoc.querySelectorAll("manifest item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    const mediaType = item.getAttribute("media-type");
    if (id && href && mediaType?.includes("html")) {
      manifest[id] = href;
    }
  });

  // 5. Follow spine order
  const spineItems = opfDoc.querySelectorAll("spine itemref").map((el) => el.getAttribute("idref"));

  // 6. Extract text from each spine item
  const chapters = [];
  for (const idref of spineItems) {
    const href = manifest[idref];
    if (!href) continue;

    const fullHref = opfDir !== "." ? `${opfDir}/${href}` : href;
    const htmlContent = await zip.file(fullHref)?.async("string");
    if (!htmlContent) continue;

    const dom = parseHtml(htmlContent);

    // Remove script/style/nav elements
    dom.querySelectorAll("script, style, nav").forEach((el) => el.remove());

    // Extract chapter heading if present
    const heading =
      dom.querySelector("h1, h2, h3")?.text?.trim() || idref;

    // Get clean text
    const rawText = dom.querySelector("body")?.text || dom.text;
    const text = cleanText(rawText);

    if (text.length > 50) {
      // Skip near-empty chapters
      chapters.push({ id: idref, title: heading, text });
    }
  }

  if (chapters.length === 0) {
    throw new Error("No readable chapters found in this EPUB.");
  }

  return { title, chapters };
}

/**
 * Collapse whitespace, fix encoding artifacts, trim.
 */
function cleanText(raw) {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[\u00A0]/g, " ")  // non-breaking spaces
    .trim();
}
