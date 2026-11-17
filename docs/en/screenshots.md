# Public screenshots and recordings


[中文](../screenshots.md) · English

All public screenshots and recordings are captured directly from the live React and OneGUI interface populated with self-contained sample data, keeping real student accounts and campus credentials completely out of the build pipeline.

Each capture script mounts mock adapters for Tsinghua Cloud, organizations, and Xiaoda, seeds sample courses, assignments, and profile records, restricts network access to localhost, and runs in a clean browser context. Viewport sizes and SHA-256 checksums are recorded in `docs/assets/0.11/en-US/manifest.json`. After running the scripts, review the generated images by eye to confirm layout spacing, contrast, and text legibility before publishing.

```bash
# With the local Vite server already running on port 5180
ONETHU_CAPTURE_LOCALE=en-US node tools/capture-public-preview.mjs
ONETHU_CAPTURE_LOCALE=en-US node tools/capture-localized-tour.mjs
ONETHU_CAPTURE_LOCALE=en-US node tools/record-vault-onboarding.mjs
```

Standard capture sets cover 390×844 portrait, 844×390 landscape, and 1440×900 desktop viewports rendered by real application components. The staging-box animation drives the app's actual pickup, drag, and drop handlers with a visual pointer indicator overlaid, and calibrates the Chromium compositor to eliminate blank edge padding; the onboarding tour plays this same recording on physical phones.

English documentation and onboarding tours use dedicated captures rendered with the English locale active, kept separate from the Chinese asset set. Website WebP images are re-encoded directly from these approved native-locale captures so all UI text comes straight from the app, and other non-Chinese locales share the English tour assets.

![English minimal-mode home](../assets/0.11/en-US/home-simple.png){ width="260" }

![English landscape home](../assets/0.11/en-US/home-landscape.png)
