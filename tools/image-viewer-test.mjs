/**
 * 手机端「长按看图」护栏（2026-09-23）。
 *
 * 契约：长按图片 → 全屏看图（双指缩放 + 单击任意处退出）→ 底部「保存图片」写进系统相册。
 * 四个环节缺一不可，且各自有本仓库踩过的坑：
 *  ① 前端只挂真机密度层（html.is-phone）——桌面行为不许变；
 *  ② 保存必须走**新的**原生通道：相册应用只索引 MediaStore.Images，写进「下载」的图不在
 *     相册里（用户会找不到）；
 *  ③ Kotlin 的参数类必须 @InvokeArg —— 漏注解在 release 包里必崩（R8 下 parseArgs 报
 *     "no Creators"），debug 包与桌面端都发现不了，见 docs/android-release-traps.md §1；
 *  ④ Rust 桥必须真的注册进 invoke_handler，否则前端调用直接失败（widgetInstances 曾漏接）。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const kt = read("apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/java/app/onethu/mobile/OnethuMobilePlugin.kt");
const ktManifest = read("apps/desktop/src-tauri/plugins/onethu-mobile/android/src/main/AndroidManifest.xml");
const rs = read("apps/desktop/src-tauri/src/lib.rs");
const host = read("apps/desktop/src/components/ImageViewer.tsx");
const saver = read("apps/desktop/src/lib/imageSave.ts");
const main = read("apps/desktop/src/main.tsx");
const css = read("apps/desktop/src/styles/global.css");

/* ---------- Kotlin：相册条目（Images 集合，不是 Downloads） ---------- */
assert.ok(/fun saveImage\(invoke: Invoke\)/.test(kt), "插件必须提供 saveImage 命令");
assert.ok(/@InvokeArg\s+class SaveImageArgs/.test(kt), "参数类必须 @InvokeArg（R8 下漏注解必崩）");
assert.ok(
  /MediaStore\.Images\.Media\.EXTERNAL_CONTENT_URI/.test(kt),
  "必须写进 MediaStore.Images —— 相册只索引这个集合",
);
assert.ok(
  /Environment\.DIRECTORY_PICTURES \+ "\/OneTHU"/.test(kt),
  "相册落点必须是 Pictures/OneTHU（用户认得出是应用存的图）",
);
assert.ok(/IS_PENDING, 1/.test(kt) && /IS_PENDING, 0/.test(kt), "写一半的条目不许被相册扫到（IS_PENDING 两端）");
assert.ok(/SDK_INT >= 29/.test(kt), "旧系统要有降级分支（API<29 无分区存储）");
assert.ok(
  /WRITE_EXTERNAL_STORAGE/.test(kt) && /maxSdkVersion="28"/.test(ktManifest),
  "API 24–28 需要存储权限，且只在旧系统上声明",
);
assert.ok(/MediaScannerConnection\.scanFile/.test(kt), "旧系统直写后必须通知媒体库扫描，否则相册看不到");

/* ---------- Rust：桥 + 注册（桌面端不许空转报错） ---------- */
assert.ok(/async fn save_image_to_gallery\(/.test(rs), "Rust 侧必须有 save_image_to_gallery 命令");
assert.ok(
  /run_mobile_plugin_async\(\s*"saveImage"/.test(rs),
  "Rust 桥必须转发到 Kotlin 的 saveImage",
);
assert.ok(/save_image_to_gallery,/.test(rs), "命令必须注册进 invoke_handler");
assert.ok(/downloads::directory\(&app\)/.test(rs), "桌面端必须有落盘实现（写到「下载」目录）");
const rsLimit = /const MAX_B64_LEN: usize = (\d+) \* 1024 \* 1024;/.exec(rs);
const jsLimit = /const MAX_B64_LEN = (\d+) \* 1024 \* 1024;/.exec(saver);
assert.ok(rsLimit && jsLimit, "两侧都必须有 base64 上限常量");
assert.equal(rsLimit[1], jsLimit[1], "IPC 上限两侧必须同口径（前端先拒，Rust 再兜一层）");

/* ---------- 前端：只挂真机 + 长按判定 + 单击退出 ---------- */
assert.ok(/<ImageViewerHost \/>/.test(main), "看图宿主必须挂进应用根");
assert.ok(/classList\.contains\("is-phone"\)/.test(host), "行为必须只挂真机密度层（html.is-phone）");
assert.ok(/LONGPRESS_MS = \d+/.test(host) && /setTimeout\(/.test(host), "长按必须由计时器判定");
assert.ok(/LONGPRESS_SLOP_PX/.test(host), "长按期间必须有位移取消阈值（滚动不许误开）");
assert.ok(/e\.touches\.length > 1/.test(host), "出现第二根手指必须取消长按");
assert.ok(/addEventListener\("contextmenu"/.test(host), "必须拦掉原生长按菜单，否则两套菜单同时出现");
assert.ok(/addEventListener\("click", onClickCapture, true\)/.test(host), "长按开图这一下必须吞掉后续 click");
assert.ok(/contenteditable/.test(host), "富文本编辑器里的图片不参与（那里的长按是选词）");
assert.ok(/TAP_SLOP_PX/.test(host) && /TAP_MAX_MS/.test(host), "单击退出必须有位移与时长上限");
assert.ok(/shut\(\);/.test(host), "单击任意处必须退出看图");
assert.ok(/imgview-save/.test(host), "「保存图片」按钮必须独立于单击退出判定");

/* ---------- 安卓返回键：先退看图，再回上一级 ---------- */
assert.ok(/history\.pushState\(VIEWER_STATE/.test(host), "开图必须压入一层历史条目（wry 的返回键只做 goBack，没有钩子）");
assert.ok(/addEventListener\("popstate"/.test(host), "必须监听 popstate 才能接住返回键");
assert.ok(/history\.back\(\)/.test(host), "点按关闭要弹掉这层空条目，否则下一次返回键被吃掉");
assert.ok(/e\.state === VIEWER_STATE/.test(host), "popstate 必须按 state 标记区分「弹掉的是看图这一层」");

/* ---------- 前端：双指缩放 ---------- */
assert.ok(/MAX_SCALE = \d+/.test(host) && /Math\.hypot\(/.test(host), "缩放必须按双指距离比例计算");
assert.ok(/transform = `translate3d/.test(host), "缩放与位移必须直接写 transform（手势每帧都改）");
assert.ok(/imgview-save/.test(css) && /\.imgview\s*\{/.test(css), "浮层样式必须入库");
assert.ok(/touch-action: none/.test(css), "浮层必须关掉浏览器自己的滚动与缩放");
assert.ok(
  /\.imgview-save \{[\s\S]{0,240}background: #/.test(css) && !/btn-primary imgview-save/.test(host),
  "「保存图片」必须用自己的灰度（主按钮色 #0f1115 在全黑浮层上看不出边界，真机实录）",
);
assert.ok(
  /\.imgview-stage \{[\s\S]{0,200}position: absolute;[\s\S]{0,80}inset: 0/.test(css),
  "图片区必须铺满整屏——底栏另占一行时，放大后仍会留一条黑边（用户实录）",
);
assert.ok(
  /\.imgview-bar \{[\s\S]{0,240}position: absolute[\s\S]{0,400}pointer-events: none/.test(css) &&
    /\.imgview-save \{[\s\S]{0,120}pointer-events: auto/.test(css),
  "保存按钮只作浮层：容器不吃事件（点按钮以外仍退出看图），按钮自己收事件",
);
assert.ok(
  /html\.imgview-open \.hard-refresh-fab/.test(css) && /classList\.toggle\("imgview-open"/.test(host),
  "看图时必须收起右下角刷新按钮（它层级 9999，会压在浮层上，真机实录）",
);
assert.ok(/saveImageToGallery/.test(host) && /invoke<\{ dir\?: string \}>\("save_image_to_gallery"/.test(saver), "保存链路必须接到新命令");

console.log("image-viewer-test: 全部断言通过（长按开图 + 双指缩放 + 单击退出 + 相册通道）");
