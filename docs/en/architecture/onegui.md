# OneGUI visual and interaction architecture

[中文](../../architecture/onegui.md) · [System overview](../architecture.md)

## Code and contracts

`packages/gui` supplies tokens, CSS, React components and the style pipeline. `gui.css` orders the layers; `onethu.css` adds host recipes and compatibility aliases. `packages/ui` still supplies a legacy token entry. Existing page migration targets OneGUI semantics while preserving that compatibility boundary.

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

`StyleDirector` resolves skin, scheme, density, motion, platform and theme, with skinLevel for material strength. Root attributes and CSS variables carry the resolved values. React hooks subscribe to axis snapshots. The host injects platform detection instead of each component guessing.

Theme roles include surface/content/border, font, curvature and accent families. Scheme supports light/dark/system. Skin/material supports neutral/glass and levels. Density supports compact/comfortable/touch; motion supports full/reduced. Graphite is a default preset; wallpapers, themes, accents and materials remain configurable dimensions.

A theme transition removes previous roles and applies the complete next set. `defineScope` allows registered semantic overrides from permitted token families/enums. Dynamic geometry belongs to component/layout parameters rather than a second page-local style system.

Sources: [director](../../../packages/gui/src/pipeline/director.ts), [React bindings](../../../packages/gui/src/pipeline/react.tsx), [host bridge](../../../apps/desktop/src/lib/oneguiBridge.ts).

## Actions and contrast

Primary action roles `--og-action / --og-action-on` are separate from theme accent. Selection, hover, press, disabled and focus states use shared semantics. Text, icons, loading and hit areas must remain distinguishable in light/dark themes.

The color pipeline supports compositing and contrast. The app also installs text contrast handling over the wallpaper/veil/surface/glass stack. Theme switching and dynamic materials must preserve readable content and semantic status colors. Sources: [color.ts](../../../packages/gui/src/pipeline/color.ts), [app entry](../../../apps/desktop/src/main.tsx).

## Glass and refraction

Material roles control transparency, blur, edges and surface depth. Shells/capsules/overlays retain context, while inputs and sustained reading need stable surfaces. Reduced transparency/refraction must preserve function and legibility.

The host registers structural refraction selectors with `installOneGUI`. Visibility, area, device and WebView budgets govern the implementation and blur fallback. Sampling/refresh follows lifecycle. Material rendering does not own overlay stacking or hit testing.

Sources: [refraction](../../../packages/gui/src/pipeline/refraction.ts), [glass skin](../../../packages/gui/src/skins/glass.css).

## Shells, overlays and scrolling

The shared content boundary owns padding, available height and scrolling for tabs, board links, search and tool navigation. Sheets, pickers, OH, staging and fixed shortcuts have distinct layers/safe areas.

Every scroll container needs a defined height and overflow policy. Shells reserve OneShot/system-bar space; drawers and lists must reach their last item. Overflowing segments keep an operable horizontal indicator. Selection uses both content and surface roles.

Platform, touch capability and viewport width are separate inputs. A landscape tablet can use a wide layout while retaining touch editing rules. Width alone does not authorize dragging. Sources: [platform.ts](../../../apps/desktop/src/state/platform.ts), [FreeBoard](../../../apps/desktop/src/components/FreeBoard.tsx).

## Dragging and editing

Gestures distinguish press, threshold, pickup, movement, candidate target and committed drop. One gesture commits once; cancellation or successful collection consumes the source movement. Floating-button placement and content drops have separate state and immediate click feedback.

Mobile board geometry changes require edit mode. Browsing retains reading and scrolling. Temporary transforms are separate from persisted documents, undo restores document history, and reset explicitly restores a template.

Sources: [model](../../../apps/desktop/src/state/boardCore.ts), [editing](../../../apps/desktop/src/state/boardEdit.ts), [floating controls](../../../apps/desktop/src/components/useFloatingButtonDrag.ts), [drop handling](../../../apps/desktop/src/components/vault/vaultDrag.ts).

## Localization and onboarding

Application-owned strings resolve at display time. Errors retain localizable identity or an external reason. School text, names and service messages keep source semantics. OneGUI locale adaptation covers common controls; business UI uses the application dictionary.

Onboarding selects mode-specific explanation/layout and uses real application captures with fictional data. Chinese and English media match their UI language. Pause/offscreen/background/reduced-motion states stop or reduce media/frame work. Public assets exclude real account data.

## Verification and extension

`guard:onegui` and token/contrast/style/geometry guards validate structural contracts. Browser/device acceptance covers clicks, focus, scrolling, orientation, zoom and motion; source checks do not replace WebView results.

New components define semantic roles, variants, states and interaction before entering the library or host recipe. Business services/IDs stay in the app. See [design language](../design-language.md), [historical contract](../../onegui/10-contract.md) and [token entry map](../../tokens-map.md).
