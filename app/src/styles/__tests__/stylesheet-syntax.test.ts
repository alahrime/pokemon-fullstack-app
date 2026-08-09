import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * The stylesheets must actually parse.
 *
 * This exists because the gate once went green on a stylesheet that made the
 * app render nothing. A script that trimmed a dead selector out of a grouped
 * rule rewrote the single-line form
 *
 *     .a, .b, .dead { display: flex; gap: 2px; }
 *
 * as `.a, .b {` — dropping the declarations and the closing brace with them.
 * Six rules were damaged that way. Tailwind then failed to compile the whole
 * bundle ("Missing closing }"), the dev server returned 500 for every request
 * and the page was blank — and none of tsc, oxlint, the token checks or 750
 * tests noticed, because nothing in the gate parses CSS.
 *
 * These are the two cheapest properties that would have caught it.
 */

const dir = 'src/styles';
const sheets = readdirSync(dir).filter((f) => f.endsWith('.css'));

/** Strip comments and quoted strings, which may legally contain braces. */
const code = (css: string) =>
  css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');

describe('every stylesheet parses', () => {
  it('has files to check, so a bad glob cannot pass vacuously', () => {
    expect(sheets.length).toBeGreaterThan(5);
  });

  it.each(sheets)('%s closes every block it opens', (file) => {
    const c = code(readFileSync(`${dir}/${file}`, 'utf8'));
    const open = (c.match(/\{/g) ?? []).length;
    const close = (c.match(/\}/g) ?? []).length;
    expect(open - close, `${file}: ${open} '{' vs ${close} '}'`).toBe(0);

    // Depth must never go negative — balanced totals alone would accept `} {`.
    let depth = 0;
    let underflow = false;
    for (const ch of c) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth < 0) underflow = true;
    }
    expect(underflow, `${file} closes a block that was never opened`).toBe(false);
  });

  it.each(sheets)('%s declares no rule with an empty body', (file) => {
    const c = code(readFileSync(`${dir}/${file}`, 'utf8'));
    // A rule with no declarations is either a mistake or dead weight.
    const empties = [...c.matchAll(/([^{}@][^{}]*)\{\s*\}/g)].map((m) => m[1].trim());
    expect(empties, `${file} has empty rules: ${empties.join(' | ')}`).toEqual([]);
  });
});
