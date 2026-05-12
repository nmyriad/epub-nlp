# Contributing to epub-nlp

Thanks for your interest in contributing! This is a small open source project and all help is welcome — whether that's reporting a bug, suggesting a feature, or submitting code.

---

## Reporting a Bug

1. Go to the [Issues](https://github.com/nmyriad/epub-nlp/issues) tab on GitHub
2. Click **New Issue**
3. Describe the problem clearly:
   - What command did you run?
   - What did you expect to happen?
   - What actually happened?
   - Copy and paste any error messages from PowerShell

The more detail the better — it makes fixing things much faster.

---

## Suggesting a Feature

1. Go to the [Issues](https://github.com/nmyriad/epub-nlp/issues) tab
2. Click **New Issue**
3. Describe the feature you'd like and why it would be useful
4. If you have ideas on how it could work, include those too

---

## Submitting Code Changes

If you'd like to fix a bug or add a feature yourself:

**Step 1 — Fork the repository**

Click **Fork** at the top right of the repo page. This creates your own copy of the project.

**Step 2 — Clone your fork**

```powershell
git clone https://github.com/YOUR_USERNAME/epub-nlp.git
cd epub-nlp
npm install
```

**Step 3 — Create a branch for your change**

```powershell
git checkout -b feat/your-feature-name
```

**Step 4 — Make your changes and test them**

```powershell
node src/index.js analyze "path\to\a-book.epub"
```

Make sure the tool still runs correctly before submitting.

**Step 5 — Commit your changes**

Use clear commit messages with a prefix:

```powershell
git add .
git commit -m "feat: describe what you added"
git push origin feat/your-feature-name
```

**Step 6 — Open a Pull Request**

Go to your fork on GitHub and click **Compare & pull request**. Describe what you changed and why.

---

## Code Style

- Use clear, descriptive variable and function names
- Add a comment if something isn't immediately obvious
- Follow the existing commit message convention:
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation changes
  - `chore:` for maintenance

---

## Project Structure

```
src/
  index.js        — CLI entry point
  parser.js       — EPUB parsing
  analyze.js      — NLP analysis
  output.js       — Terminal display and file export
  worddb.js       — Word database
  vocab-export.js — Anki and CSV export
```

---

## Questions?

Open an Issue and tag it with **question** — happy to help.
