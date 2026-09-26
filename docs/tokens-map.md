# 设计令牌对照表（tokens map）

本表由 `node tools/gen-tokens-map.mjs` 从 `packages/ui/src/tokens.css` 与 `palette.css` **自动生成**，不要手改。

三层结构：**Reference**（`palette.css`，`tools/gen-tokens.mjs` 按「清华紫」种子生成的 tonal palette，零运行时依赖）
→ **System**（`--md-sys-color-*` / `--md-sys-shape-*` / `--md-sys-typescale-*` / `--md-sys-elevation-*`）
→ **Compat**（`--bg` / `--surface` / `--primary` / `--text-1` … 旧名全量保留）。

## 1. Compat 层实况（旧变量 → System 角色 → 当前解析值）

| 旧变量 | System 角色 | 当前解析值 |
|---|---|---|
| `--bg` | `--md-sys-color-surface` | `#ffffff` |
| `--bg-soft` | `--md-sys-color-surface-container-low` | `#f9fafb` |
| `--surface` | `--md-sys-color-surface` | `#ffffff` |
| `--surface-2` | `--md-sys-color-surface-container-low` | `#f9fafb` |
| `--surface-3` | `--md-sys-color-surface-container` | `#ebeef2` |
| `--skeleton` | `--md-sys-color-skeleton` | `rgba(0, 0, 0, 0.04)` |
| `--skeleton-shine` | `--md-sys-color-skeleton-shine` | `rgba(255, 255, 255, 0.6)` |
| `--border` | `--md-sys-color-outline-variant` | `rgba(0, 0, 0, 0.1)` |
| `--border-soft` | `--md-sys-color-outline-soft` | `rgba(0, 0, 0, 0.04)` |
| `--border-strong` | `--md-sys-color-outline-strong` | `rgba(0, 0, 0, 0.16)` |
| `--text-1` | `--md-sys-color-on-surface` | `#0f1115` |
| `--text-2` | `--md-sys-color-on-surface-variant` | `#61666b` |
| `--text-3` | `--md-sys-color-outline` | `#81858c` |
| `--text-dim` | `--md-sys-color-on-surface-disabled` | `#d5dbe3` |
| `--primary` | `--md-sys-color-primary` | `#0f1115` |
| `--primary-hover` | `--md-sys-color-primary-hover` | `#43454a` |
| `--on-primary` | `--md-sys-color-on-primary` | `#ffffff` |
| `--accent` | `--md-sys-color-secondary` | `#4176e6` |
| `--accent-soft` | `--md-sys-color-secondary-container` | `#edf3fe` |
| `--accent-border` | `--md-sys-color-secondary-container-border` | `#c9d9f9` |
| `--red` | `--md-sys-color-error` | `#e5484d` |
| `--red-soft` | `--md-sys-color-error-container` | `#feecec` |
| `--amber` | `--md-sys-color-warning` | `#d9730d` |
| `--amber-soft` | `--md-sys-color-warning-container` | `#fdf2e2` |
| `--green` | `--md-sys-color-success` | `#22c55e` |
| `--green-soft` | `--md-sys-color-success-container` | `#e6f9ee` |
| `--hover` | `--md-sys-color-state-hover` | `rgba(38, 49, 72, 0.06)` |
| `--active` | `--md-sys-color-state-pressed` | `rgba(38, 49, 72, 0.1)` |
| `--elev-1` | `--md-sys-elevation-1` | `0 2px 4px rgba(0, 0, 0, 0.05)` |
| `--elev-2` | `--md-sys-elevation-2` | `0 2px 8px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.02)` |
| `--elev-3` | `--md-sys-elevation-3` | `0 0 1px rgba(0, 0, 0, 0.2), 0 12px 32px rgba(0, 0, 0, 0.08)` |
| `--shadow-1` | `--md-sys-elevation-1` | `0 2px 4px rgba(0, 0, 0, 0.05)` |
| `--shadow-2` | `--md-sys-elevation-2` | `0 2px 8px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.02)` |
| `--shadow-3` | `--md-sys-elevation-3` | `0 0 1px rgba(0, 0, 0, 0.2), 0 12px 32px rgba(0, 0, 0, 0.08)` |
| `--ring` | `--md-sys-focus-ring` | `0 0 0 3px rgba(65, 118, 230, 0.25)` |
| `--r-sm` | `--md-sys-shape-corner-small` | `6px` |
| `--r-md` | `--md-sys-shape-corner-medium` | `8px` |
| `--r-lg` | `--md-sys-shape-corner-large` | `12px` |
| `--r-pill` | `--md-sys-shape-corner-full` | `999px` |

共 39 个旧变量全部有映射。**重写不改变观感**由 `node tools/token-compat-diff.mjs` 逐条比对证明
（拿 git HEAD 版的 tokens.css 与新版解析值比，全部相等才通过）。

## 2. System 角色 → tonal palette 目标值（§3.2 品牌色 / §3.3 暗色 接入清单）

接入方式：改 System 层一族的初值即可（`--md-sys-color-primary: var(--md-ref-palette-primary-40)`），
Compat 层与所有组件自动跟随。建议一族一提交，便于单独回滚。

| System 角色 | 亮色（目标） | 暗色（目标） |
|---|---|---|
| `--md-sys-color-primary` | `#90399c` | `#fbabff` |
| `--md-sys-color-on-primary` | `#ffffff` | `#580065` |
| `--md-sys-color-primary-container` | `#ffd6fd` | `#751d82` |
| `--md-sys-color-on-primary-container` | `#36003e` | `#ffd6fd` |
| `--md-sys-color-secondary` | `#6c586b` | `#d8bfd5` |
| `--md-sys-color-on-secondary` | `#ffffff` | `#3b2b3b` |
| `--md-sys-color-secondary-container` | `#f5dbf1` | `#534152` |
| `--md-sys-color-on-secondary-container` | `#251626` | `#f5dbf1` |
| `--md-sys-color-tertiary` | `#82524a` | `#f6b8ad` |
| `--md-sys-color-on-tertiary` | `#ffffff` | `#4c251f` |
| `--md-sys-color-tertiary-container` | `#ffdad4` | `#673b33` |
| `--md-sys-color-on-tertiary-container` | `#33110c` | `#ffdad4` |
| `--md-sys-color-error` | `#ba1a1a` | `#ffb4ab` |
| `--md-sys-color-on-error` | `#ffffff` | `#690005` |
| `--md-sys-color-error-container` | `#ffdad6` | `#93000a` |
| `--md-sys-color-on-error-container` | `#410002` | `#ffb4ab` |
| `--md-sys-color-background` | `#fffbff` | `#1e1a1d` |
| `--md-sys-color-on-background` | `#1e1a1d` | `#e9e0e4` |
| `--md-sys-color-surface` | `#fffbff` | `#1e1a1d` |
| `--md-sys-color-on-surface` | `#1e1a1d` | `#e9e0e4` |
| `--md-sys-color-surface-variant` | `#eddfe8` | `#4d444c` |
| `--md-sys-color-on-surface-variant` | `#4d444c` | `#d0c3cc` |
| `--md-sys-color-outline` | `#7f747c` | `#998d96` |
| `--md-sys-color-outline-variant` | `#d0c3cc` | `#4d444c` |
| `--md-sys-color-shadow` | `#000000` | `#000000` |
| `--md-sys-color-scrim` | `#000000` | `#000000` |
| `--md-sys-color-inverse-surface` | `#332f32` | `#e9e0e4` |
| `--md-sys-color-inverse-on-surface` | `#f7eef2` | `#332f32` |
| `--md-sys-color-inverse-primary` | `#fbabff` | `#90399c` |

## 3. 尚未接入的令牌（有意留白）

- `--md-sys-typescale-*` 五档字阶：已定义语义档位，退役 `--text-xxs(11px)` / `--text-sm(13px)` 属 §3.9 字阶 lint + M3 组件批次的活；
- `--md-sys-shape-corner-extra-large(16px)`：为 B2 卡片批次预留；
- `--elev-1..3`：`--shadow-*` 的新名，新代码用新名；
- `--md-sys-color-state-hover/pressed` 现为 6%/10%（基线），§3.9 状态层规范目标 8%/12%；
- dark 通道（`prefers-color-scheme` + `state/theme.ts` 手动覆盖）见 §3.3，尚未接入。
