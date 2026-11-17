# OneGUI visual and interaction architecture


[中文](../../architecture/onegui.md) · [System overview](../architecture.md)

## Code and contracts

`packages/gui` provides the design tokens, layered CSS, React components, and runtime style pipeline. `gui.css` establishes the cascade order, while `onethu.css` layers host-specific recipes and legacy compatibility aliases alongside the older token entry in `packages/ui`. Ongoing page migrations move views onto native OneGUI semantics while keeping that compatibility layer working smoothly.

```text
reference.css: reference palette
structure.css: spacing, curvature, sizing, type, z-index, motion
semantic.css: surfaces, content, borders, actions, semantic roles
   → StyleDirector: axes, theme, controlled scopes
   → skins + components + patterns
   → host recipes + app layout/behavior
```

Sources: [CSS entry](../../../packages/gui/src/gui.css), [components](../../../packages/gui/src/index.ts), [host recipes](../../../packages/gui/src/recipes/onethu.css).

## Style pipeline

`StyleDirector` resolves active `skin`, `scheme`, `density`, `motion`, `platform`, and `theme` axes—including `skinLevel` for material intensity—and writes the resulting attributes and CSS custom properties to the document root. React components subscribe to axis snapshots via hooks, and the host detects platform traits centrally so individual components share a consistent view of the device.

Themes define surface, content, border, typography, corner-radius, and accent roles. `scheme` switches between light, dark, and system; `skin` selects neutral or glass materials across intensity levels; `density` adapts across compact, comfortable, and touch sizing; and `motion` toggles full or reduced choreography. Graphite ships as the default theme preset, while wallpapers, themes, accents, and material levels remain user-configurable.

Switching themes clears prior role overrides cleanly before applying the new token set. Scoped subtrees can register targeted overrides from approved token families via `defineScope`, while runtime coordinates and dimensions flow through component and layout props to keep styling unified.

Sources: [director](../../../packages/gui/src/pipeline/director.ts), [React bindings](../../../packages/gui/src/pipeline/react.tsx), [host bridge](../../../apps/desktop/src/lib/oneguiBridge.ts).

## Actions and contrast

Primary action tokens (`--og-action` and `--og-action-on`) stay distinct from decorative theme accents, and interactive states—selection, hover, press, disabled, and focus—follow shared semantic rules so text, icons, spinners, and hit targets stay clear in both light and dark modes.

The color pipeline handles surface compositing and contrast math, paired with runtime text-contrast adaptation over wallpapers, veils, surfaces, and glass layers so foreground copy and status badges stay legible across custom backgrounds and theme changes. Sources: [color.ts](../../../packages/gui/src/pipeline/color.ts), [app entry](../../../apps/desktop/src/main.tsx).

## Glass and refraction

Material tokens govern translucency, backdrop blur, specular edges, and elevation depth: floating shells, capsules, and overlays let background context show through, whereas text inputs and long-form reading views sit on calm, high-legibility surfaces. Enabling reduced transparency or reduced refraction falls back gracefully while keeping hierarchy and readability intact.

At startup, the host registers structural refraction targets through `installOneGUI`. Viewport visibility, surface area, device capability, and WebView performance budgets determine when live refraction runs and when standard blur takes over, with sampling tied to window lifecycle while overlay z-order and pointer hit-testing stay in the layout layer.

Sources: [refraction](../../../packages/gui/src/pipeline/refraction.ts), [glass skin](../../../packages/gui/src/skins/glass.css).

## Shells, overlays and scrolling

A shared content shell manages horizontal gutters, available viewport height, and scroll behavior across tabs, whiteboard deep links, search results, and tool navigation. Bottom sheets, pickers, OH panels, staging boxes, and floating shortcuts each occupy dedicated z-layers and safe-area insets.

Every scrollable view defines an explicit height constraint and overflow rule so drawers and lists scroll cleanly past floating OneShot or system bars to their final item. Horizontally scrolling segmented controls keep an accessible scroll indicator, and selected items combine both surface fill and foreground contrast tokens.

Platform identity, touch input, and viewport width are tracked as independent signals—allowing a tablet in landscape to use a wide multi-column layout while keeping touch-specific edit-mode safeguards for whiteboard dragging. Sources: [platform.ts](../../../apps/desktop/src/state/platform.ts), [FreeBoard](../../../apps/desktop/src/components/FreeBoard.tsx).

## Dragging and editing

Pointer gestures progress explicitly through press, movement threshold, pickup, live drag, drop-target highlight, and commit. Each gesture resolves to a single outcome: cancelling a drag or dropping an item into a collection box consumes the gesture cleanly without shifting the source item's position. Floating-button repositioning and content drag-and-drop track separate state machines so simple taps receive instant click feedback.

On touch devices, rearranging or resizing whiteboard widgets requires entering edit mode so everyday browsing scrolls and opens content without accidental moves. Live drag transforms stay transient until release, Undo steps back through persisted document snapshots, and Reset restores the board's default template after confirmation.

Sources: [model](../../../apps/desktop/src/state/boardCore.ts), [editing](../../../apps/desktop/src/state/boardEdit.ts), [floating controls](../../../apps/desktop/src/components/useFloatingButtonDrag.ts), [drop handling](../../../apps/desktop/src/components/vault/vaultDrag.ts).

## Localization and onboarding

UI copy owned by the application resolves through the locale dictionary at render time, and structured errors carry either a localizable error key or the upstream message from a campus service. Course titles, personal names, and university announcements remain in their original source text. Core controls localize inside OneGUI while feature pages draw from the app dictionary.

Onboarding adapts its copy and layout to the chosen experience mode and showcases real UI recordings populated with fictional sample data, matching visual media to the active Chinese or English interface. Offscreen views, backgrounded windows, paused stages, and reduced-motion preferences suspend video playback and frame timers automatically, and all bundled media stays free of personal account data.

## Verification and extension

`guard:onegui` alongside the token, contrast, style, and geometry linters verify structural rules in source code, complemented by interactive browser and WebView checks covering click targets, keyboard focus, scroll bounds, orientation changes, zoom, and motion.

New shared components specify their semantic roles, variants, states, and keyboard/pointer behavior before landing in `packages/gui` or host recipes, keeping campus-specific business logic and IDs inside the app layer. See [design language](../design-language.md), [historical contract](../../onegui/10-contract.md) and [token entry map](../../tokens-map.md).
