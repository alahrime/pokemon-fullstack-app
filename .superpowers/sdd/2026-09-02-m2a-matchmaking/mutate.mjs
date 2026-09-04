#!/usr/bin/env node
/**
 * Mutation harness for the Task 8 fix rounds.
 *
 * Round 2 recorded a mutation that silently landed in a function its test does
 * not call, and briefly read as "the mutation survived". Round 3's report
 * claimed a script asserted its anchors; no such script was on disk, so the
 * claim could not be checked. This is that script, committed.
 *
 * It ASSERTS rather than reports:
 *   - the anchor occurs in the file exactly `count` times (default 1), so a
 *     mutation cannot land somewhere else and look applied;
 *   - the line the mutation lands on sits inside `region` — the nearest
 *     preceding line matching that pattern must be it, which is how "landed in
 *     `myOffers` instead of `listOpenOffers`" gets caught;
 *   - the replacement is actually present afterwards.
 * Then it PRINTS the mutated region back, so the evidence in the report is a
 * transcript of the file as it stood when the test ran.
 *
 *   node mutate.mjs apply <spec.json>     # back up, mutate, verify, print
 *   node mutate.mjs restore <spec.json>   # restore from the backup, verify
 *
 * spec.json: { "file", "find", "replace", "region", "count"? }
 *   region: a regex matched against whole lines; the nearest such line ABOVE
 *           the mutation point is asserted to be the enclosing one.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const [, , cmd, specPath] = process.argv;
if (!cmd || !specPath) {
  console.error('usage: mutate.mjs apply|restore <spec.json>');
  process.exit(2);
}
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const file = resolve(spec.file);
const backup = `${file}.premutation`;

function die(msg) {
  console.error(`ASSERTION FAILED: ${msg}`);
  process.exit(1);
}

function show(src, index, label) {
  const lines = src.split('\n');
  let off = 0;
  let hit = 0;
  for (let i = 0; i < lines.length; i++) {
    if (off + lines[i].length >= index) {
      hit = i;
      break;
    }
    off += lines[i].length + 1;
  }
  const from = Math.max(0, hit - 6);
  const to = Math.min(lines.length, hit + 7);
  console.log(`--- ${label}: ${spec.file} lines ${from + 1}-${to} ---`);
  for (let i = from; i < to; i++) {
    console.log(`${String(i + 1).padStart(4)}${i === hit ? ' >' : '  '}| ${lines[i]}`);
  }
  return { lines, hit };
}

if (cmd === 'apply') {
  const src = readFileSync(file, 'utf8');
  const want = spec.count ?? 1;
  const found = src.split(spec.find).length - 1;
  if (found !== want) die(`anchor occurs ${found} time(s), expected ${want}\n  anchor: ${spec.find}`);
  const index = src.indexOf(spec.find);

  // Which region did it land in? The nearest preceding line matching `region`.
  const before = src.slice(0, index).split('\n');
  const re = new RegExp(spec.region);
  let enclosing = null;
  for (let i = before.length - 1; i >= 0; i--) {
    if (re.test(before[i])) {
      enclosing = before[i].trim();
      break;
    }
  }
  if (enclosing === null) die(`no line matching /${spec.region}/ above the mutation point`);
  console.log(`anchor found ${found}x; enclosing region: ${enclosing}`);

  copyFileSync(file, backup);
  const out = src.replace(spec.find, spec.replace);
  if (out === src) die('replacement produced an identical file');
  writeFileSync(file, out);
  const check = readFileSync(file, 'utf8');
  if (!check.includes(spec.replace)) die('replacement text is not present after writing');
  show(check, check.indexOf(spec.replace), 'MUTATED');
  console.log('MUTATION APPLIED');
} else if (cmd === 'restore') {
  if (!existsSync(backup)) die(`no backup at ${backup}`);
  copyFileSync(backup, file);
  unlinkSync(backup);
  const src = readFileSync(file, 'utf8');
  if (!src.includes(spec.find)) die('the original anchor is not back after restore');
  if (spec.replace && src.includes(spec.replace) && spec.replace !== spec.find) {
    die('the mutated text is still present after restore');
  }
  console.log('RESTORED (anchor present, mutation absent)');
} else {
  die(`unknown command ${cmd}`);
}
