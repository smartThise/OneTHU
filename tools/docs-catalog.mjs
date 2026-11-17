/** Inventory every Markdown document, without rewriting historical evidence. */
import {readdirSync,writeFileSync} from 'node:fs';
import {join,relative} from 'node:path';
const root='docs';
function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.name.startsWith('._')?[]:entry.isDirectory()?walk(join(dir,entry.name)):entry.name.endsWith('.md')?[relative(root,join(dir,entry.name)).replaceAll('\\','/')]:[]);}
const current=new Set(['i18n/TRANSLATOR_GUIDE.md','i18n/GLOSSARY.md','examples/harness-skel/README.md','README.md','architecture.md','api-reference.md','api-surface.md','plugin-development.md','homework.md','external-homework.md','android-release-traps.md','dev-build.md','design-language.md','tokens-map.md','动效设计规范.md','入口映射表.md','白板组件尺寸档清单.md','developers.md','contributors.md','getting-started.md','experience-modes.md','workbench.md','sharing-and-organizations.md','schedule-and-sync.md','oh-and-xiaoda.md','privacy-and-troubleshooting.md','release-0.11.md','screenshots.md']);
const paths=walk(root).sort((a,b)=>a.localeCompare(b,'en'));
for(const en of [false,true]){
 const text=[`# ${en?'Documentation inventory and status':'文档全量清单与状态'}`,'',en?'[中文](../documentation-catalog.md) · English':'中文 · [English](en/documentation-catalog.md)','',en?'Current user and developer guides alongside generated API signatures reflect the active 0.11 behavior. Earlier design plans, audits, and verification notes are kept in their original language as engineering archives. Regenerate this index with `node tools/docs-catalog.mjs`.':'日常使用与开发请优先参考现行指南与自动生成的 API 清单；早期的设计草案、专题调研与阶段验收记录按原文归档备查。可通过 `node tools/docs-catalog.mjs` 重新生成本索引。','','| '+(en?'Document | Status |':'文档 | 状态 |'),'|---|---|'];
 for(const path of paths){if(path.endsWith('documentation-catalog.md'))continue;const status=path.startsWith('en/')?(en?'English current guide':'现行英文说明'):current.has(path)?(en?'Current reference':'现行说明/工程参考'):(en?'Historical evidence':'历史计划/研究/验收证据');text.push(`| [${path}](${en?'../':''}${path}) | ${status} |`);}
 writeFileSync(join(root,en?'en/documentation-catalog.md':'documentation-catalog.md'),text.join('\n')+'\n');
}
console.log(`${paths.length} documents inventoried`);
