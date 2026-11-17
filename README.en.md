<div align="center">

<img src="docs/logo-banner.png" alt="One above THU — One THUer should have OneTHU" width="640">

**0.11.4-fix-3 · Revolution**

[中文](README.md) · [English](README.en.md)

Your campus. In one place.

[Website](https://onethu.github.io/en/) · [Download](https://github.com/smartThise/OneTHU/releases/latest) · [Documentation](https://onethu.github.io/docs/en/) · [Developers](https://onethu.github.io/en/developers.html)

</div>

OneTHU is an unofficial Tsinghua campus app for macOS, Windows, and Android. Version 0.11 brings a unified OneGUI design with customizable themes, wallpapers, and layouts across three experience modes—**Minimal, Practical, and Full**. Global search and the OH capsule stay with you in every mode, while Full mode unlocks freeform whiteboards, quick staging and sharing, cards and organizations, plugins, OneTHU Harness, and Xiaoda.

## OneTHU and browser extensions

| Project | Best for | Get it |
|---|---|---|
| [OneTHU](https://github.com/smartThise/OneTHU) | Full campus app for macOS, Windows, and Android—courses, schedules, everyday campus services, and connected external platforms. | [Download the app](https://github.com/smartThise/OneTHU/releases/latest) |
| [NextTHUxk](https://github.com/smartThise/NextTHUxk) | Course search, timetable previews, draft schedules, and AI-assisted planning right on the course registration website. | [Install registration extension](https://github.com/smartThise/NextTHUxk/releases/latest) |
| [NextTHULearn](https://github.com/smartThise/NextTHULearn) | Turns the Web Learning website into a clean, OneTHU-style study workspace automatically. | [Install learning extension](https://github.com/smartThise/NextTHULearn/releases/latest) |

All three tools work on their own—the browser extensions hook directly into your active university web session and are ready to use right after installation.

## Recent updates

| Release | Highlights |
|---|---|
| [0.11.4-fix-3 · Current](docs/en/release-0.11.4-fix-3.md) | Fixes sign-in handoff after retained-data upgrades and restores Tsinghua Cloud update-check parameters while keeping local auth and 2FA smooth. |
| [0.11.4-fix-1](docs/en/release-0.11.4-fix-1.md) | Improves Windows sign-in and background startup, home course cards, tablet settings scrolling, and mobile card sizing. |
| [0.11.4](docs/en/release-0.11.4.md) | Introduces the standalone CLI, SDK, and desktop background daemon; connects OH to Rain Classroom, contacts, organizations, Xiaoda, and the staging box; refines attachment naming and multi-account isolation. |

## Interface preview (sample data)

Every screenshot below is captured directly from the live app populated with offline sample data across phone portrait, phone landscape, and desktop views. See [capture details](docs/en/screenshots.md) for how these previews are built.

<table><tr><th>Minimal</th><th>Practical</th><th>Full</th></tr><tr><td><img src="docs/assets/0.11/en-US/home-simple.png" alt="Minimal-mode home, fictional data" width="250"></td><td><img src="docs/assets/0.11/en-US/home-practical.png" alt="Practical-mode home, fictional data" width="250"></td><td><img src="docs/assets/0.11/en-US/home-full.png" alt="Full-mode home, fictional data" width="250"></td></tr></table>

![Fictional phone landscape home](docs/assets/0.11/en-US/home-landscape.png)

<details><summary>View desktop, Web Learning, schedule, and Xiaoda screenshots</summary>

![Full mode on desktop](docs/assets/0.11/en-US/home-desktop.png)

<table><tr><td><img src="docs/assets/0.11/en-US/learn.png" width="250" alt="Learning platform, fictional data"></td><td><img src="docs/assets/0.11/en-US/schedule.png" width="250" alt="Schedule, fictional data"></td><td><img src="docs/assets/0.11/en-US/xiaoda.png" width="250" alt="Xiaoda, fictional data"></td></tr></table>

</details>

## What’s inside 0.11

| Feature | Overview |
|---|---|
| Three modes | **Minimal** highlights today’s classes and to-dos; **Practical** keeps everyday campus services handy; **Full** opens a customizable workspace. Switch anytime—your layout and settings stay safe. |
| Unified search | Jump straight to features, campus services, and synced items from the OH capsule with instant local matching. |
| OneShot / OneGO / Whiteboards | Five default shortcuts—Study, Reservations, Life, Info, and Schedule—plus tabs, the OneGO favorites bar, workspaces, and draggable whiteboard widgets in Full mode. |
| Courses and schedule | Brings together Web Learning courses, assignments, notices, and files alongside optional Rain Classroom and OJ tasks, merging classes, deadlines, and personal events into one calendar. |
| Campus life and bookings | Check your campus card (with low-balance alerts that clear automatically after top-up), dorm electricity, campus Wi-Fi, news, available classrooms, library seats, and discussion rooms. |
| Staging box and share codes | Press and hold supported items, lift, and drop them onto the highlighted staging button, then share via a quick online short code (short codes are recommended over NFC for reliable everyday sharing). |
| Cards and organizations | Manage digital namecards, friends, organization roles, shared files, projects, and announcements in Full mode. |
| OH / OneTHU Harness | Use authorized app tools and plugins in Full mode, or connect your own model API and WeChat/Feishu channels in lighter modes. Model credentials stay independent of your campus login. |
| Xiaoda and skills | Browse models, agents, and the skill plaza. Lightweight synchronous JavaScript skills run right inside the built-in QuickJS sandbox, while Python, Node, or CLI-heavy skills can be exported to your desktop agent. |
| Plugins | Supports JavaScript extensions, desktop Rust sidecars, and embedded Android plugins across 41 namespaces and 297 API methods, governed by clear permissions and platform support. |

## Hold, lift, keep

Recorded directly from the live drag-and-drop interaction (with a visible pointer added for clarity). You can pick up and stage integrated assignments, course files, whiteboard widgets, tabs, workspaces, search results, calendar events, namecards, emails, and cloud files.

<img src="docs/assets/0.11/en-US/vault-drag.gif" width="300" alt="Actual long-press and drop into staging, with fictional assignments">

[See supported items and organization sync](docs/en/sharing-and-organizations.md)

## Download and get started

Grab the installer for your platform from [GitHub Releases](https://github.com/smartThise/OneTHU/releases/latest) or the [Tsinghua Cloud mirror](https://cloud.tsinghua.edu.cn/d/56f78a2a0b144a6ab737/).

1. **Pick your language and mode**: Follow the interactive tour on first launch—try real screens along the way and hop right back into the tour anytime.
2. **Sign in**: Log in with Tsinghua SSO and complete two-factor verification when prompted; connect mail, calendar, cloud storage, or AI models whenever you need them.
3. **Set up alerts**: Turn on notifications for deadlines, schedules, or card balance, and check the built-in redacted diagnostics if a network or sign-in hiccup comes up.

[Getting started](docs/en/getting-started.md) · [Privacy and troubleshooting](docs/en/privacy-and-troubleshooting.md) · [0.11 release notes](docs/en/release-0.11.md)

## Local development and docs

```bash
git clone --recurse-submodules https://github.com/smartThise/OneTHU.git
cd OneTHU
git switch dev3
pnpm install
pnpm dev
```

`pnpm dev` opens a fast browser preview for UI work; to run with full campus networking, local files, and native notifications, launch the Tauri host with Rust and platform prerequisites installed (plus JDK / SDK / NDK for Android). Day-to-day development happens on `dev3`.

- [Developer center and build guide](docs/en/developers.md)
- [OneTHU CLI, SDK, and background assistant](docs/en/onethu-cli.md): terminal sign-in, course file archiving, scheduled checks, IM alerts, and MCP integration for external agents.
- [Contributors](docs/en/contributors.md)
- [Plugin guide](docs/en/plugin-development.md) · [API surface](docs/en/api-surface.md) · [OneTHU Harness](https://github.com/smartThise/OneTHU-Harness)
- [Architecture](docs/en/architecture.md) · [OneGUI](docs/en/design-language.md) · [Full documentation index](docs/en/documentation-catalog.md)

## Credits and license

Warm thanks to [THU Info](https://github.com/thu-info-community/thu-info-app), [learnX](https://github.com/robertying/learnX), [thu-learn-lib](https://github.com/Harry-Chen/thu-learn-lib), [NextTHUxk](https://github.com/smartThise/NextTHUxk), [NextTHULearn](https://github.com/smartThise/NextTHULearn), thu-tok-auto, yuketang-helper-auto, and everyone who has contributed code, designs, testing, and feedback.

OneTHU’s original code is shared under a custom noncommercial license with fair-use protections for Tsinghua University information services. If you publicly release a project that reuses or adapts this code, please credit OneTHU and the relevant upstream projects in your README, NOTICE, or documentation. Separate terms apply to THU Info grants, LearnX-derived code, and other third-party packages.

[Full license](LICENSE) · [Third-party licenses and grants](LICENSES/THIRD-PARTY.md)
