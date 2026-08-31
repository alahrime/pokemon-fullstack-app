import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'src/rules');

function sources(): string[] {
  return readdirSync(DIR).filter((f) => f.endsWith('.ts'));
}

describe('src/rules stays runnable outside a browser', () => {
  it('imports no React', () => {
    for (const f of sources()) {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src, `${f} imports react`).not.toMatch(/from\s+['"]react/);
    }
  });

  it('touches no browser global', () => {
    // Word-boundary matches so a comment mentioning "the document" does not trip
    // it, but `document.querySelector` does.
    const banned = /\b(window|document|localStorage|sessionStorage|navigator)\s*\./;
    for (const f of sources()) {
      const src = readFileSync(join(DIR, f), 'utf8');
      expect(src, `${f} touches a browser global`).not.toMatch(banned);
    }
  });

  it('has at least one source file, so the test cannot pass vacuously', () => {
    expect(sources().length).toBeGreaterThan(5);
  });
});
