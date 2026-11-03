/**
 * Existing architecture guards inspect source + visible Chinese copy together.
 * Resolve literal, imported i18n calls from the real catalog for those assertions.
 * No source or dictionary code is evaluated; behavioral tests still run real modules.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {readDataFile} from "./dictionary.mjs";
/* Windows 上 new URL(...).pathname 给出的是 "/D:/..."，fs 会把它当相对路径拼成 "D:\D:\..."。
   统一走 fileURLToPath：两个平台都得到可直接打开的本机路径。 */
const messages=readDataFile(fileURLToPath(new URL("../../apps/desktop/src/i18n/locales/zh-CN.ts",import.meta.url))).messages;
export function localizedSource(source,file="source.tsx"){
  if(typeof source!=="string"||!source.includes("i18n/"))return source;
  const ast=ts.createSourceFile(String(file),source,99,true),edits=[],bindings=new Set();
  for(const st of ast.statements)if(ts.isImportDeclaration(st)&&ts.isStringLiteral(st.moduleSpecifier)&&/i18n\/index\.js$/.test(st.moduleSpecifier.text)){
    const b=st.importClause?.namedBindings;if(b&&ts.isNamedImports(b))for(const el of b.elements)if(/^(t|typedT|msg|rich|localizedList)$/.test(el.propertyName?.text??el.name.text))bindings.add(el.name.text);
  }
  const render=n=>{
    let s=n.getText(ast),start=n.getStart(ast);
    for(const e of edits.filter(e=>e.start>=start&&e.end<=n.end).sort((a,b)=>b.start-a.start))s=s.slice(0,e.start-start)+e.text+s.slice(e.end-start);
    return s;
  };
  function visit(n){
    ts.forEachChild(n,visit);
    if(!ts.isCallExpression(n)||!ts.isIdentifier(n.expression)||!bindings.has(n.expression.text))return;
    const key=n.arguments[0];
    if(key&&ts.isArrayLiteralExpression(key)&&key.elements.every(el=>ts.isStringLiteral(el))){
      const values=key.elements.map(el=>el.text?messages[el.text]:"");
      if(values.some(v=>typeof v!=="string"))throw new Error("Unresolved translation list");
      edits.push({start:n.getStart(ast),end:n.end,text:JSON.stringify(values)});
      return;
    }
    if(!key||!ts.isStringLiteral(key))return;
    const template=messages[key.text];if(typeof template!=="string")throw new Error(`Unresolved translation ${key.text}`);
    const p=n.arguments[1],params=new Map();
    if(p&&ts.isObjectLiteralExpression(p))for(const entry of p.properties)if(ts.isPropertyAssignment(entry)){
      let val=entry.initializer;if(ts.isCallExpression(val)&&val.expression.getText(ast)==="String"&&val.arguments.length===1)val=val.arguments[0];
      params.set(entry.name.text??entry.name.getText(ast),render(val));
    }
    const text=params.size?"`"+template.replace(/[`\\]/g,"\\$&").replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g,(m,k)=>params.has(k)?"${"+params.get(k)+"}":m)+"`":JSON.stringify(template);
    const start=n.getStart(ast),end=n.end;
    for(let i=edits.length-1;i>=0;i--)if(edits[i].start>=start&&edits[i].end<=end)edits.splice(i,1);
    edits.push({start,end,text});
  }visit(ast);
  for(const e of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,e.start)+e.text+source.slice(e.end);
  return source
    .replace(/get\s+((?:"[^"]+"|[A-Za-z_$][\w$]*))\s*\(\)\s*\{\s*return\s+("(?:[^"\\]|\\.)*")\s*;\s*\}/g,"$1: $2")
    .replace(/=\{("(?:[^"\\]|\\.)*")\}/g,"=$1");
}
export function readUiSource(file,encoding="utf8"){
  const s=fs.readFileSync(file,encoding);
  return /\.tsx?$/.test(String(file))?localizedSource(s,file):s;
}
