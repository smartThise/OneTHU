# NextTHULearn Independent Release Implementation Plan

**Goal:** Publish NextTHULearn in its own GitHub repository with a signed Firefox XPI and matching ZIP/source packages, and connect the three project READMEs.

**Architecture:** Keep the tested extension behavior. The independent repository vendors the exact OneTHU learning-client sources and brand assets needed for a reproducible build, with the upstream commit and file hashes recorded. Mozilla signs the unlisted Firefox package; GitHub Releases distributes it.

**Tech Stack:** TypeScript, esbuild, npm lockfile, GitHub CLI, Mozilla Developer Hub through Chrome.

## Tasks

1. Prepare `smartThise/NextTHULearn`: copy extension sources, the minimal upstream source graph and licenses; add standalone build/package scripts and lockfile. Verify a clean install reproduces the bundle and run the existing fixture regressions.
2. Design `NextTHULearn/README.md` from the current OneTHU brand banner, fictional screenshots, feature table, installation instructions, privacy statement and explicit native-page limitations. Add the same three-project navigation to OneTHU Chinese/English and NextTHUxk READMEs.
3. Create the independent public GitHub repository and push its reviewed source. Push OneTHU and NextTHUxk documentation updates without rewriting existing history.
4. Package the exact tested runtime ZIP and complete buildable source archive. Upload to Mozilla as a new self-distributed extension, supply source/build instructions, wait for signing and download the signed XPI.
5. Publish `v0.2.1` with ZIP, signed XPI, source ZIP and checksums. Verify the signed package identity/content, release downloads, README image paths and cross-project links. Record the resulting URLs and remaining limitations.

All public screenshots use fictional fixtures. Real-account submission/posting is outside release verification.
