import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../apps/desktop/src/pages/zhjwxk/Courses.tsx',import.meta.url),'utf8');
const sheet=await readFile(new URL('../packages/gui/src/recipes/selection.css',import.meta.url),'utf8');
const syntax=ts.createSourceFile('Courses.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const instances=new Map();
function visit(node) {
  if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) {
    const name=node.tagName.getText(syntax);
    instances.set(name,(instances.get(name)||0)+1);
  }
  ts.forEachChild(node,visit);
}
visit(syntax);
assert.equal(instances.get('CourseListPanel'),1,'Responsive modes must share a single course/search instance');
assert.equal(instances.get('PreviewSection'),1,'Preview state must survive mobile tab changes');
assert.equal(instances.get('StageSection'),1,'Staged operations must have one mounted owner');
assert(!source.includes('100vh - 150px'),'Course panes must use the measured shell height');
assert.match(source,/data-mobile-panel=\{mTab\}/);
assert.match(source,/className="xk-page-jump-group"/,'Jump field and GO stay grouped when pagination wraps');
assert.match(sheet,/\.xk-pagination \.xk-page-jump\s*\{[^}]*width:\s*72px;/,'Page jump field must remain compact');
assert.match(source,/<details className="xk-notice">/,'The full notice must start collapsed');
assert.match(source,/<div className="xk-filter-details" hidden=\{!filtersOpen\}>/,'Advanced filters must start collapsed');
assert(!source.includes('<details className="xk-course-details">'),'Course information must remain directly visible');
assert.match(source,/className="xk-course-content"/,'Full course information shares a compact layout');
assert.match(sheet,/\.xk-right > \.og-card\s*\{\s*flex:\s*none;/,'Management cards must not shrink below their content');
assert(!sheet.includes('100dvh')&&!sheet.includes('overflow: hidden auto'),'The whole page must retain one natural vertical scroll');
assert.match(sheet,/is-phone \.xk-two-col\[data-mobile-panel="manage"\]/,'Landscape phones retain mobile navigation');
assert.match(sheet,/data-mobile-panel="manage"[^}]*display:\s*none !important;/s);
for(const property of ['reviewsF','sortBy','tongshi','feature','grade','bksrem','yjsrem','xknote','conflictF','credits','day','period']) {
  assert(source.includes('value={'+property+'}'),'Filter must remain reachable: '+property);
}
const seed=JSON.parse(await readFile(new URL('../docs/i18n/static-label-seed.json',import.meta.url),'utf8'));
for(const key of ['noticeTitle','moreFilters','draftActions']) {
  const messages=seed.messages['pages.zhjwxk.courses.'+key];
  assert(messages?.['zh-CN']&&messages?.['en-US'],'New UI copy must include bilingual source text');
}
console.log('Selection layout invariants passed');
