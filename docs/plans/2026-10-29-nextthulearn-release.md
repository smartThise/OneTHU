# NextTHULearn Independent Release Implementation Plan


**Goal:** Publish NextTHULearn in a standalone GitHub repository with a Mozilla-signed Firefox XPI, matching Chrome/Chromium ZIP, and reproducible source archive, and link the three sister project READMEs together.

**Architecture:** Preserve the verified extension behavior as-is. The standalone repository vendors the exact OneTHU learning-client sources and brand assets required for a deterministic build, recording the upstream commit SHA and per-file hashes. Mozilla signs the self-distributed Firefox package, and GitHub Releases hosts the release artifacts.

**Tech Stack:** TypeScript, esbuild, npm lockfile, GitHub CLI, and Mozilla Developer Hub via Chrome.

## Tasks

1. Prepare `smartThise/NextTHULearn`: copy the extension sources, minimal upstream source graph, and license files, then add standalone build/package scripts and an npm lockfile. Confirm that a clean install reproduces the bundle byte-for-byte and passes the existing fixture regressions.
2. Author `NextTHULearn/README.md` with the current OneTHU brand banner, fictional fixture screenshots, feature overview table, installation steps, privacy notes, and clear guidance on actions that still open native Web Learning pages. Add matching three-project navigation links across the OneTHU Chinese/English READMEs and the NextTHUxk README.
3. Create the public GitHub repository and push the reviewed source tree, then land the README navigation updates in OneTHU and NextTHUxk while keeping existing commit history intact.
4. Build the tested runtime ZIP and complete buildable source archive, submit them to Mozilla Developer Hub as a self-distributed extension with build instructions, wait for automated signing, and download the signed XPI.
5. Publish release `v0.2.1` with the runtime ZIP, signed XPI, source archive, and SHA-256 checksums. Verify the signed package ID and contents, test release asset downloads, check all README image paths and cross-project links, and document the published URLs alongside remaining native-page boundaries.

All public screenshots are rendered from fictional fixture data, and release verification focuses on packaging and read-only checks without submitting or posting to live school accounts.
