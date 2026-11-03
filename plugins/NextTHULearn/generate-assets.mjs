import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url);
const source=readFileSync(new URL('packages/gui/src/components/icons.tsx',root),'utf8');
const names=['Today','Learn','Check','Pen','Bell','File','Search','Refresh','Clock','Calendar','Download','Upload','Chevron','External','Star','Sun','X','User','Info','Mail','More','Plus','Trash','Book','HelpCircle','Camera'];
const glyphs={};
for(const name of names){
 const start=source.indexOf('export function Icon'+name+'(');if(start<0)throw Error('Missing OneGUI icon '+name);
 const chunk=source.slice(start,source.indexOf('\nexport function ',start+1)>0?source.indexOf('\nexport function ',start+1):undefined);
 const match=chunk.match(/<Icon\b([^>]*)>([\s\S]*?)<\/Icon>/);if(!match)throw Error('Unsupported icon '+name);
 const box=match[1].match(/viewBox="([^"]+)"/)?.[1]||'0 0 24 24';
 const paths=match[2].replace(/\{\/\*[\s\S]*?\*\/\}/g,'').replace(/strokeDasharray/g,'stroke-dasharray').trim();
 if(/[{}]/.test(paths))throw Error('Dynamic icon '+name);
 glyphs[name]=`<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="${box}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}
const brand=readFileSync(new URL('apps/desktop/src/components/BrandLogo.tsx',root),'utf8');
const content=brand.slice(brand.indexOf('<span className="p">('),brand.lastIndexOf('\n    </span>')).replace(/className=/g,'class=').replace(/<span\s*\/>/g,'<span></span>').trim();
if(!content.includes('class="word"')||!content.includes('class="u"'))throw Error('Unsupported OneTHU brand');
const globalCss=readFileSync(new URL('apps/desktop/src/styles/global.css',root),'utf8');
const brandCss=globalCss.slice(globalCss.indexOf('.brand-logo {'),globalCss.indexOf('/* Slogan：')).replace('color: var(--text-1, #fff);','color: var(--ink);');
const output='// Generated from OneGUI icons.tsx and OneTHU BrandLogo.tsx/global.css. Do not redraw.\n'+
`const glyphs: Record<string,string> = ${JSON.stringify(glyphs,null,2)};\nexport const icon = (name:string) => glyphs[name] || '';\nexport const brandLogo = ${JSON.stringify('<span class="brand-logo" aria-label="OneTHU">'+content+'</span>')};\nexport const brandCss = ${JSON.stringify(brandCss)};\n`;
writeFileSync(new URL('src/brand.generated.ts',import.meta.url),output);
console.log('Synced '+names.length+' OneGUI SVG icons and official OneTHU brand');
