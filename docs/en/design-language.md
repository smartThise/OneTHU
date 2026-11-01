# OneGUI design language (0.11)

[中文](../design-language.md) · English

Graphite is the default theme. `packages/gui` owns tokens, components and recipes; see the [package reference](../../packages/gui/README.md). Earlier MD3 experiments and page-specific styles are not a second design standard.

Reuse OneGUI buttons, inputs, segments, modals, sheets, lists and feedback components. Central theme injection determines surfaces, text, selection and semantic colors. Check selected states, contrast and platform font fallbacks on both light and dark themes.

Material and color are separate: glass belongs in contextual floating layers, capsules and panels. Preserve the text-contrast engine; do not hard-code unreadable black-on-black states in individual pages.

Use shared content gutters for every route, including navigation from whiteboard widgets. Keep OneShot clear of scrolling content and separate it from whiteboard controls, refresh and staging targets. Free movement and a committed drop are separate outcomes: collecting a widget must not also move its original position. Scrollable segments retain an operable horizontal indicator. Verify list bottoms, timelines, dialogs and landscape layouts.

Guide animation uses actual UI captures and recordings with fictional data. Physical devices have depth and natural transitions. Portrait stages give single-device demos most of the available area; NFC can show paired devices. Pause videos and frame scheduling offscreen, in the background and with reduced motion. Motion must not replace feedback or obscure primary content.

The detailed [motion specification](../动效设计规范.md), [token map](../tokens-map.md) and [widget sizes](../白板组件尺寸档清单.md) are engineering references currently maintained in Chinese.

The [OneGUI architecture](architecture/onegui.md) covers token ownership, compatibility, theme injection, material budgets, gestures and scrolling.
