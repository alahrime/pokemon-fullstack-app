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
// Every theme block in themes.css, discovered rather than listed — adding a
// theme should not require editing its own guard.
const THEMES = [...themeCss.matchAll(/:root\[data-theme='([\w-]+)'\]/g)]
  .map((m) => m[1])
  .filter((v, i, a) => a.indexOf(v) === i);
const defs = new Map();
// `hud` shares its block with the bare :root default.
defs.set('hud', defsIn(":root,\n:root[data-theme='hud']") ?? defsIn(":root[data-theme='hud']"));
for (const t of THEMES) {
  if (t === 'hud') continue;
  defs.set(t, defsIn(`:root[data-theme='${t}']`) ?? new Set());
}

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

// Set inline on elements rather than declared in a theme, so absence from
// themes.css is expected, not a parity failure.
const LOCAL = new Set([
  '--i','--cell-delay','--path-len','--marker-delay','--stagger-step',
  '--type',                       // move/species type tint, set per element
  '--lg','--lg-deep','--lg-accent', // league identity, set per tab
]);
// Type colours live in types.css deliberately: they're brand constants, not
// theme tokens, so they must NOT differ per theme. `var(--type-${t})` is also
// built by interpolation, which the literal scan can only see as `--type-`.
// Built by interpolation (`var(--type-${t})`, `var(--lg-${id})`), so the
// literal scan only ever sees the prefix. Both sets live outside the themes
// deliberately: they're game brand constants and must not differ per theme.
const IGNORE_PREFIX = ['--type-', '--lg-'];
// The reference contract is the union of what every theme defines. A token in
// one theme and not another is the failure this exists to catch: the value
// falls through to the :root default and the theme is subtly wrong with
// nothing reporting it.
const contract = new Set();
for (const set of defs.values()) for (const t of set) contract.add(t);

const missingUsed = new Map();
for (const [tok, where] of used) {
  if (LOCAL.has(tok) || other.has(tok)) continue;
  if (IGNORE_PREFIX.some((pre) => tok.startsWith(pre))) continue;
  for (const [name, set] of defs) {
    if (!set.has(tok)) {
      if (!missingUsed.has(name)) missingUsed.set(name, []);
      missingUsed.get(name).push(`${tok}  \u2190 ${[...where].join(', ')}`);
    }
  }
}

const gaps = [];
for (const [name, set] of defs) {
  const missing = [...contract].filter((t) => !set.has(t));
  if (missing.length) gaps.push({ name, missing });
}

console.log(`themes: ${[...defs.keys()].join(', ')}`);
console.log(`contract: ${contract.size} tokens | ` +
  [...defs].map(([n, s2]) => `${n} ${s2.size}`).join(' | '));

// Tokens a stylesheet uses that a theme never defines. Reported, not fatal:
// several are set inline per element (--t1, --tab-hue) or read with a
// fallback, and both are legitimate.
for (const [name, list] of missingUsed) {
  if (list.length) console.log(`\nused but undefined in ${name}:\n  ` + list.join('\n  '));
}

if (gaps.length) {
  console.log('\nPARITY FAILURES');
  for (const g of gaps) console.log(`  ${g.name} is missing: ${g.missing.join(', ')}`);
  console.log('\nEvery theme must define every token any theme defines, or the');
  console.log('value silently falls through to the :root default.');
  process.exit(1);
}
console.log('\nPARITY — every theme defines the full contract');
