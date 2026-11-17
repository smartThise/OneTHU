# OneGUI theme, material and editable home canvas


> 归档说明 / Archival note：本文记录当时的设计方案与阶段性验收情况；0.11 当前功能与使用指南请查阅 [文档入口](../README.md)（[English overview](../en/index.md)）。

Goal: repair theme injection, segment contrast, and glass material layers, then unify all home screen elements onto a single persistent canvas.

## Decisions / ADR

- Theme definitions serve as the single source of palette values. The app maps legacy theme roles onto OneGUI surface, content, line, and font roles, and the theme director applies and clears them alongside the accent color directly from the theme definition rather than reading back computed bridge CSS. Keep the historical `ivory` ID while updating its display name to 石墨.
- Material stays orthogonal to color palette. Blur and translucency apply to shell chrome, standalone cards, and overlay surfaces, while inputs, action buttons, segmented controls, and sticky notes keep solid, legible fills. Keeping ancestor layers transparent avoids nested blur and lets the wallpaper show through.
- Segmented controls paint active background and foreground tokens on the selected button itself so text contrast stays reliable without depending on a separate animated pill layer.
- The home canvas hosts the clock, large title, service shortcuts, and four information widgets in one workspace. Fresh or reset layouts start with this seven-item composition, while existing user boards run a one-time migration that adds the former fixed header items alongside authored cards—any widget deleted afterward stays removed.
- Browsing and editing operate as distinct interaction states: inner carousel gestures work freely while browsing, whereas moving and resizing use explicit handles in edit mode. Zoom and edit/add controls sit in a viewport toolbar layered above canvas content and below dialogs and navigation overlays.

## Implementation

1. Extend the director's theme input with controlled palette roles and complete cleanup, map the active scheduled theme, and fix swatch layout in the settings theme picker.
2. Apply material roles to visible surfaces, clear competing opaque wrapper layers, and bind every segment's active ink and fill atomically.
3. Extract the tasks carousel as a shared component and register today's tasks, service shortcuts, clock, and editable title as board widgets.
4. Seed the seven-item default home layout and implement an idempotent one-time migration that preserves existing user boards.
5. Add explicit edit mode, drag handles, keyboard movement and resizing, sensible size bounds, and the viewport zoom/edit/add toolbar.
6. Verify theme, color-scheme, and material combinations, legacy board migration, sticky-note persistence, carousel swiping, drag/resize, toolbar scrolling, and narrow mobile viewports. Run typecheck, build, board tests, and OneGUI guards, and archive desktop and mobile screenshots.

## Risks and validation

Switching palettes clears all prior role overrides cleanly, and partial or custom palettes maintain readable contrast while keeping primary action roles independent from theme accents. One-time board migration preserves existing user arrangements and respects subsequent widget deletions; background kept-alive tabs suppress their fixed toolbars so only the active tab renders viewport controls; canvas zoom anchors smoothly around the visible area without shifting focus during text entry; and mobile browsing scrolls naturally while keeping layout controls easy to reach.

## Completion

All six implementation stages are complete, with validation reports and screenshots archived in `docs/onegui/theme-home/README.md`. Existing user-authored boards migrate once while offering a manual reset to the default home template. Automated checks pass across 80 current-task browser assertions, 223 viewport and overflow checks, 34 prior-feedback regressions, and 79 pure model assertions for themes and home state, leaving native WebView glass rendering for on-device verification.
