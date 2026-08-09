import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A Tailwind utility must not butt against a template interpolation.
 *
 * Tailwind v4 finds utilities by scanning source text for candidates. A class
 * written as
 *
 *     className={`flip-card h-[38px] w-[54px]${win ? ' is-won' : ''}`}
 *
 * puts `w-[54px]` directly against `${`, and the scanner never extracts it —
 * so the utility is never generated. Nothing fails: no build error, no type
 * error, no test. The rule is simply absent at runtime and the element falls
 * back to `auto`. The flip cards measured 32.8px instead of 54px this way, and
 * `gap-[5px]` on the Best Buddy toggle was dead for the same reason.
 *
 * A single space before the interpolation is the whole fix.
 */

const UTILITY = String.raw`(?:w|h|size|min-w|min-h|max-w|max-h|gap|gap-x|gap-y|m[trblxye]?|p[trblxye]?|inset|top|right|bottom|left|basis|grow|shrink|order|col-span|row-span|grid-cols|grid-rows|flex|items|justify|self|place-items|place-content|text|bg|border|rounded|opacity|z|leading|tracking)`;
/**
 * A *complete* utility — the value after the dash is required, so a `key` like
 * `gap-${i}` (a React key, not a class) is not mistaken for one.
 */
const GLUED = new RegExp(String.raw`(?<![\w-])(${UTILITY}-(?:\[[^\]]*\]|[\w./%()-]+))\$\{`, 'g');

/** The template literals actually used as a class list. */
function classLiterals(text: string): { body: string; index: number }[] {
  const out: { body: string; index: number }[] = [];
  const re = /className=\{`/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    // Walk to the matching backtick, skipping over ${…} nesting.
    let i = m.index + m[0].length;
    let depth = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') { i++; continue; }
      if (c === '{' && text[i - 1] === '$') depth++;
      else if (c === '}' && depth > 0) depth--;
      else if (c === '`' && depth === 0) break;
    }
    out.push({ body: text.slice(m.index, i), index: m.index });
  }
  return out;
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('every Tailwind utility stays extractable', () => {
  const files = tsxFiles('src');

  it('finds source to scan, so a bad walk cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never glues a utility to a ${…} interpolation', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const lit of classLiterals(text)) {
        for (const m of lit.body.matchAll(GLUED)) {
          const line = text.slice(0, lit.index + (m.index ?? 0)).split('\n').length;
          offenders.push(`${f}:${line} — \`${m[1]}\` is followed directly by \${`);
        }
      }
    }
    expect(offenders, `add a space before the interpolation:\n${offenders.join('\n')}`).toEqual([]);
  });
});
