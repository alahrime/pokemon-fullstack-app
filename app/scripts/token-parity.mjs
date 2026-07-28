import fs from 'node:fs';
import path from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;
const files = [];
(function walk(d){ for (const e of fs.readdirSync(d,{withFileTypes:true})) {
  const p = path.join(d,e.name);
  if (e.isDirectory()) walk(p);
  else if (/\.(tsx?|css)$/.test(e.name) && !p.includes('modernist.css')) files.push(p);
}})(SRC);

// Definitions, per theme block.
const themeCss = fs.readFileSync(path.join(SRC,'styles/themes.css'),'utf8');
function defsIn(selector){
  const i = themeCss.indexOf(selector);
  if (i < 0) return null;
  const start = themeCss.indexOf('{', i);
  let depth=0, end=start;
  for (let j=start;j<themeCss.length;j++){ if(themeCss[j]==='{')depth++; else if(themeCss[j]==='}'){depth--; if(!depth){end=j;break;}} }
  const body = themeCss.slice(start,end);
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map(m=>m[1]));
}
const hud = defsIn(":root,\n:root[data-theme='hud']") ?? defsIn(":root[data-theme='hud']");
const swiss = defsIn(":root[data-theme='modernist']");

// Theme-independent primitives.
const other = new Set();
for (const f of files) {
  if (f.endsWith('themes.css')) continue;
  const t = fs.readFileSync(f,'utf8');
  for (const m of t.matchAll(/(--[\w-]+)\s*:/g)) other.add(m[1]);
}

const used = new Map();
for (const f of files) {
  const t = fs.readFileSync(f,'utf8');
  for (const m of t.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(path.relative(SRC,f));
  }
}

const LOCAL = new Set(['--i','--cell-delay','--path-len','--marker-delay','--stagger-step']);
const miss = { hud: [], swiss: [] };
for (const [tok, where] of used) {
  if (LOCAL.has(tok) || other.has(tok)) continue;
  if (!hud.has(tok)) miss.hud.push(`${tok}  ← ${[...where].join(', ')}`);
  if (!swiss.has(tok)) miss.swiss.push(`${tok}  ← ${[...where].join(', ')}`);
}

// Parity: any token defined in one theme but not the other.
const onlyHud = [...hud].filter(t=>!swiss.has(t));
const onlySwiss = [...swiss].filter(t=>!hud.has(t));

console.log(`tokens used: ${used.size} | hud defines: ${hud.size} | swiss defines: ${swiss.size}`);
console.log('\nUNDEFINED IN HUD:', miss.hud.length ? '\n  '+miss.hud.join('\n  ') : ' none');
console.log('UNDEFINED IN SWISS:', miss.swiss.length ? '\n  '+miss.swiss.join('\n  ') : ' none');
console.log('\nPARITY — only in hud:', onlyHud.length?onlyHud.join(', '):'none');
console.log('PARITY — only in swiss:', onlySwiss.length?onlySwiss.join(', '):'none');
