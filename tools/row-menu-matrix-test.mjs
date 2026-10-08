#!/usr/bin/env node
/**
 * A3 / A4 护栏：列表行的「长按菜单矩阵」必须三行同源，且行内只留信息。
 *
 * 为什么要有它：霖 2026-10-05 指出两件事——
 *   ① 课程通知行**没有**长按菜单（作业行早就有，通知行当时漏了）；
 *   ② 课程文件行行内挂着「预览」与左下角星标，列表项看着乱；预览/下载/收藏应当进 ctx 菜单。
 * 这类「一行有一行没有」的漏项靠肉眼 review 抓不住（三行分散在同一个文件的不同位置），
 * 所以这里把矩阵与项序钉死。
 */
import { readFileSync } from "node:fs";

const F = "apps/desktop/src/pages/learn/shared.tsx";
const src = readFileSync(F, "utf8");
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

/** 取某个组件函数的源码块（按大括号配对） */
function comp(name) {
  const i = src.indexOf("export function " + name + "(");
  if (i < 0) return "";
  /* 先跳过参数表（里面有解构的 {}），再从函数体的 { 起做配对——
     直接从 i 往后找第一个 { 会停在参数解构上，取到的"函数体"只有参数。 */
  const pOpen = src.indexOf("(", i);
  let d = 0;
  let pClose = -1;
  for (let j = pOpen; j < src.length; j++) {
    if (src[j] === "(") d++;
    else if (src[j] === ")") { d--; if (!d) { pClose = j; break; } }
  }
  if (pClose < 0) return "";
  const from = src.indexOf("{", pClose);
  if (from < 0) return "";
  let depth = 0;
  for (let j = from; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (!depth) return src.slice(i, j + 1); }
  }
  return "";
}

/* [1] 三行同源：都必须接同一套长按矩阵 */
for (const name of ["HomeworkRow", "NoticeRow", "FileRow"]) {
  const body = comp(name);
  ok(body.length > 0, "找不到 " + name);
  ok(/useLongPress\(/.test(body), name + " 没接长按（矩阵缺一行）");
  ok(/useContextMenu\(\)/.test(body), name + " 没接 ctx 菜单");
  ok(/menu\.open\(/.test(body), name + " 没打开 ctx 菜单");
}

/* [2] 行内只留信息：两个行都不再内联星标，文件行不再内联「预览」 */
for (const name of ["NoticeRow", "FileRow"]) {
  const body = comp(name);
  ok(!/<CollectStar/.test(body), name + " 仍有行内星标（A4：收藏进 ctx 菜单）");
}
{
  const body = comp("FileRow");
  ok(!/>\s*预览\s*</.test(body), "FileRow 仍有行内「预览」按钮（A4：预览进 ctx 菜单）");
  ok(!/className="btn btn-ghost"/.test(body), "FileRow 行内仍有按钮（会把行高与命中区撑得和其它行不一致）");
}

/* [3] 文件行菜单项序固定：预览 → 下载 →（在文件夹中显示）→ 收藏 */
{
  const body = comp("FileRow");
  const iPreview = body.indexOf('key: "preview"');
  const iDownload = body.indexOf('key: "download"');
  const iReveal = body.indexOf('key: "reveal"');
  const iCollect = body.indexOf("items.push(collect.item)");
  ok(iPreview > 0, "FileRow 菜单缺「预览」项");
  ok(iDownload > 0, "FileRow 菜单缺「下载」项");
  ok(iCollect > 0, "FileRow 菜单缺收藏项");
  ok(iPreview < iDownload, "FileRow 菜单项序：预览应在下载之前");
  ok(iReveal > 0 && iDownload < iReveal, "FileRow 菜单项序：在文件夹中显示应在下载之后");
  ok(iReveal < iCollect || iCollect > iDownload, "FileRow 菜单项序：收藏应在文件操作之后");
}

/* [4] 通知行菜单含收藏项，且原子 kind 是 notice（与列表状态同源的那一个 key） */
{
  const body = comp("NoticeRow");
  ok(/items: \[collect\.item\]/.test(body) || /collect\.item/.test(body), "NoticeRow 菜单没有收藏项");
  ok(/kind: "notice"/.test(body), 'NoticeRow 收藏原子的 kind 必须是 "notice"');
  ok(/collect\.modal/.test(body), "NoticeRow 没有渲染收藏弹层（点了收藏没有反应）");
}
ok(/collect\.modal/.test(comp("FileRow")), "FileRow 没有渲染收藏弹层");

/* [5] 收藏项与列表状态同源：读 useFavs 的 foldersContaining，不许自建一份收藏 state */
{
  const i = src.indexOf("function useRowCollect(");
  ok(i >= 0, "缺少行内收藏的统一入口 useRowCollect");
  const body = i >= 0 ? src.slice(i, src.indexOf("export function NoticeRow(", i)) : "";
  ok(/useFavs\(\)/.test(body), "useRowCollect 没读收藏仓（会与列表状态不同源）");
  ok(/foldersContaining\(atom\)/.test(body), "useRowCollect 没查「在哪些收藏夹里」（无法给出取消收藏）");
  ok(/toggleAtomIn\(/.test(body), "useRowCollect 取消收藏没走收藏仓的开关接口");
  ok(/取消收藏/.test(body) && /"收藏"/.test(body), "useRowCollect 缺少「收藏 / 取消收藏」两个文案");
  ok(!/AtomRef\[\]|favs\.data/.test(body), "useRowCollect 自己维护了一份收藏数据（必须与列表同源）");
}
/* 收藏入口只许有一处定义（防两行各写一份、语义分叉） */
ok((src.match(/function useRowCollect\(/g) || []).length === 1, "useRowCollect 定义多于一处");

if (fails.length) {
  console.error("列表行长按菜单矩阵护栏（A3/A4）：不通过");
  for (const f of fails) console.error("  ✗ " + f);
  process.exit(1);
}
console.log("列表行长按菜单矩阵护栏（A3/A4）：三行同源（作业 / 通知 / 文件）✓ 行内无星标与预览 ✓ 文件菜单序 预览→下载→(定位)→收藏 ✓ 收藏与列表同源 ✓");
