# OneGUI design language (0.11)


[中文](../design-language.md) · English

Graphite is the default theme, and `packages/gui` serves as the single source of truth for design tokens, shared components, and visual recipes—superseding earlier MD3 prototypes and page-local style sheets; see the [package reference](../../packages/gui/README.md).

Build interfaces with OneGUI buttons, inputs, segmented controls, modals, sheets, lists, and feedback primitives. Central theme injection drives surface, text, selection, and semantic status colors across the app, so check active selection states, contrast ratios, and platform font fallbacks in both light and dark modes.

Material depth and color roles work as independent axes: reserve translucent glass for contextual floating bars, capsules, and overlays, and rely on the runtime text-contrast engine rather than hard-coded foreground colors so text stays legible over every background.

Apply shared content gutters consistently across every route, including views opened from whiteboard widgets. Leave clear bottom scroll padding for OneShot and keep its hit area well separated from whiteboard edit tools, floating refresh controls, and staging drop zones. Freeform dragging and dropping into a collection box resolve as mutually exclusive gestures—collecting a widget into staging leaves its original board coordinates unchanged. Keep an accessible horizontal scroll indicator on overflowing segmented controls, and verify list bottoms, timelines, dialogs, and landscape layouts across screen sizes.

Onboarding guides use genuine UI captures and recordings populated with fictional sample data, presenting realistic device depth and smooth transitions. Portrait stages dedicate most of the frame to single-device walkthroughs while NFC demos pair two devices side by side. Pause videos and animation loops whenever views move offscreen, enter the background, or run under reduced-motion settings, keeping motion supportive so primary content and state feedback stay front and center.

The detailed [motion specification](../动效设计规范.md), [token map](../tokens-map.md) and [widget sizes](../白板组件尺寸档清单.md) are maintained in Chinese as engineering references.
