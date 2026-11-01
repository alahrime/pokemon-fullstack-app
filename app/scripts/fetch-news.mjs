/**
 * The News screen's data: in-game events from LeekDuck and the facts in pokemongo.com/news's announcements.
 * Writes src/data/news.json. Network, so it is run by hand (`npm run news`) or by .github/workflows/news.yml.
 *
 * Events come from ScrapedDuck, LeekDuck's events page (leekduck.com/events) published as JSON. A time without a
 * trailing Z is local — the event starts at that hour in every timezone — which is how `new Date` reads it too.
 *
 * Each announcement is read for facts, not prose: which Pokémon it names and in which section (wild, raids, eggs…),
 * which moves, the bonus list, the ticket price, the section headings. Names are matched against species.json, so
 * every Pokémon on a News page is one Paragon can draw and analyse. An event takes the facts of the announcement that
 * names it and mentions its start date; an announcement no event claims is a story of its own.
 *
 * Either source failing or coming back empty throws, so a site redesign fails the workflow instead of committing an
 * empty News screen.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const get = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (paragon-iv news)' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
};
const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const clean = (s) => decode(s.replace(/<[^>]+>/g, '')).replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── Names Paragon knows ───────────────────────────────────────────────────────
const data = JSON.parse(readFileSync(new URL('../src/data/species.json', import.meta.url), 'utf8'));
const speciesKeys = new Map(); // text as an article writes it → species id
for (const s of data.species) {
  const m = /^(.*) \((.*)\)$/.exec(s.name);
  const keys = !m ? [s.name]
    : /^(Mega|Primal)\b/.test(m[2]) ? [m[2].replace(/^(Mega|Primal)/, `$1 ${m[1]}`)]
    : [`${m[2]} ${m[1]}`, `${m[2]} Forme ${m[1]}`, `${m[1]} (${m[2]} Forme)`, s.name];
  for (const k of keys) if (!speciesKeys.has(k)) speciesKeys.set(k, s.id);
}
// A bare base name ("Landorus") falls to its first form when no species is called exactly that.
for (const s of data.species) {
  const m = /^(.*) \((.*)\)$/.exec(s.name);
  if (m && !/^(Mega|Primal)\b/.test(m[2]) && !speciesKeys.has(m[1])) speciesKeys.set(m[1], s.id);
}
// Longest first, so "Alolan Marowak" is taken before "Marowak" can be.
const speciesRe = new RegExp(`(Shadow )?\\b(${[...speciesKeys.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\w'])`, 'g');
const moveKeys = new Map(Object.values(data.moves).map((m) => [m.name, m.id]));
const moveRe = new RegExp(`\\b(${[...moveKeys.keys()].sort((a, b) => b.length - a.length).map(escape).join('|')})\\b`, 'g');

/** Species named in `text`, in order of first mention; `_shadow` marks a Shadow mention. */
function speciesIn(text) {
  const out = [];
  for (const [, shadow, name] of text.matchAll(speciesRe)) {
    const ref = speciesKeys.get(name) + (shadow ? '_shadow' : '');
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}
/**
 * Moves named where a move is meant. Many move names are ordinary words (Return, Counter, Present), so only a section
 * about attacks or a sentence that says Fast/Charged Attack is searched.
 */
function movesIn(sections) {
  const out = new Set();
  for (const s of sections) {
    const texts = /attack|move/i.test(s.heading) ? [s.text] : s.text.split(/(?<=[.!?])\s/).filter((t) => /\b(Fast|Charged) Attack|\bknows\b/.test(t));
    for (const t of texts) for (const [, name] of t.matchAll(moveRe)) out.add(moveKeys.get(name));
  }
  return [...out];
}

/** Adds `refs` to the group called `label`, creating it; a Pokémon appears once per group. */
function addGroup(groups, label, refs) {
  const g = groups.find((x) => x.label === label) ?? (groups.push({ label, refs: [] }), groups.at(-1));
  for (const r of refs) if (!g.refs.includes(r)) g.refs.push(r);
  return groups;
}

// ── Reading an announcement for facts ───────────────────────────────────────
const GROUPS = [
  ['Raids', /raid/i],
  ['Max Battles', /max battle|dynamax|gigantamax/i],
  ['Eggs', /\beggs?\b|hatch/i],
  ['Research', /research|reward|encounter/i],
  ['In the wild', /wild|spawn|appear|incense|lure|featured pok/i],
];
const BOILERPLATE = /web store|looking for other trainers|community ambassador|stay tuned|share your/i;

function readArticle(html) {
  const start = html.indexOf('_article_');
  let body = html.slice(start, html.indexOf('The Pokémon GO team', start) >>> 0 || undefined);
  body = body.replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
  const sections = [];
  let cur = { heading: '', text: '', bullets: [] };
  for (const [, tag, inner] of body.matchAll(/<(h[1-6]|li|p)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const t = clean(inner);
    if (!t) continue;
    if (tag[0] === 'h') { sections.push(cur); cur = { heading: t, text: '', bullets: [] }; continue; }
    cur.text += t + ' ';
    if (tag === 'li') cur.bullets.push(t);
  }
  sections.push(cur);
  const kept = sections.filter((s) => s.text && !BOILERPLATE.test(s.heading));
  const text = kept.map((s) => `${s.heading} ${s.text}`).join(' ');

  const groups = [];
  for (const s of kept) {
    const label = (GROUPS.find(([, re]) => re.test(s.heading)) ?? ['Featured'])[0];
    const refs = speciesIn(s.text);
    if (!refs.length) continue;
    addGroup(groups, label, refs);
  }
  // First sentence of each bonus, without the footnote marks that point at text not carried over.
  const bonuses = kept.filter((s) => /bonus/i.test(s.heading)).flatMap((s) => s.bullets)
    .map((b) => b.split(/(?<=\.)\s/)[0].replace(/\*+/g, '').trim()).filter((b) => b.length > 3 && b.length < 160);
  return {
    when: kept.map((s) => s.text.trim()).find((t) => t.length < 160 && /\b20\d\d\b/.test(t) && /(a\.m\.|p\.m\.|local time|UTC)/.test(t)) ?? null,
    groups,
    moves: movesIn(kept),
    bonuses: [...new Set(bonuses)],
    price: /US\$\d+(\.\d\d)?/.exec(text)?.[0] ?? null,
    topics: [...new Set(kept.map((s) => s.heading).filter((h, i) => i > 0 && h.length < 60 && !/bonus/i.test(h)))],
    text,
  };
}

// ── Matching an event to the announcement about it ──────────────────────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// Months are stop words too: "November" is in half of November's slugs and says nothing about which event.
const STOP = new Set(['pokemon', 'go', 'the', 'and', 'of', 'during', 'event', 'day', 'in', 'with', 'forme', 'star', 'battles', 'battle', 'raids', 'raid', 'mega', 'shadow', ...MONTHS.map((m) => m.toLowerCase())]);
const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4' };
/**
 * Slug words, accents folded ("Pokémon" is one word, not "pok" and "mon"). Years and the digits glued onto words
 * ("raidhour20261104") go; small numbers stay, and "Part I" is "part 1" as a slug writes it.
 */
const tokens = (s) => new Set(s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/)
  .map((t) => ROMAN[t] ?? (/^\d{1,2}$/.test(t) ? t : t.replace(/\d+/g, ''))).filter((t) => t && !STOP.has(t)));
/** "November 21" — the day an announcement writes for the event, from LeekDuck's start (local wall time, or UTC). */
const dayOf = (iso) => { const [, m, d] = /^\d{4}-(\d\d)-(\d\d)/.exec(iso); return `${MONTHS[m - 1]} ${Number(d)}`; };

function matchArticle(event, articles) {
  const want = new Set([...tokens(event.id), ...tokens(event.name)]);
  let best = null, bestScore = 0;
  for (const a of articles) {
    if (!new RegExp(`\\b${dayOf(event.start)}\\b`).test(a.facts.text)) continue;
    const have = new Set([...tokens(a.id), ...tokens(a.title)]);
    const score = [...want].filter((t) => have.has(t)).length / want.size;
    if (score > bestScore) { best = a; bestScore = score; }
  }
  return bestScore >= 0.3 ? best : null;
}

// ── Fetch ───────────────────────────────────────────────────────────────────
const now = Date.now();
const ld = (await (await get('https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json')).json())
  .filter((e) => new Date(e.end).getTime() > now)
  .sort((a, b) => new Date(a.start) - new Date(b.start));

const html = await (await get('https://pokemongo.com/en/news')).text();
const card = /<a href="\/news\/([^"]+)"[^>]*>[\s\S]*?timestamp="(\d+)"[\s\S]*?_newsCardTitle[^>]*>([^<]*)</g;
const articles = [];
for (const [, slug, ts, title] of html.matchAll(card)) {
  const link = `https://pokemongo.com/news/${slug}`;
  articles.push({ id: slug, title: clean(title), link, date: new Date(Number(ts)).toISOString(), facts: readArticle(await (await get(link)).text()) });
}

/** ScrapedDuck's own structured extras, where LeekDuck has them, as Pokémon names. */
const extraNames = (x) => [
  ...(x.raidbattles?.bosses ?? []), ...(x.communityday?.spawns ?? []), ...(x.spotlight?.list ?? []),
].map((p) => p.name).join(', ');

const claimed = new Set();
const events = ld.map((e) => {
  const a = matchArticle({ id: e.eventID, name: e.name, start: e.start }, articles);
  if (a) claimed.add(a.id);
  const facts = a?.facts ?? { when: null, groups: [], moves: [], bonuses: [], price: null, topics: [] };
  // The event's own name and LeekDuck's extras lead: "Dynamax Machop during Max Monday" is about Machop even when no
  // announcement is matched.
  const own = speciesIn(`${e.name} ${extraNames(e.extraData ?? {})}`);
  const groups = facts.groups.reduce((gs, g) => addGroup(gs, g.label, g.refs.filter((r) => !own.includes(r))), own.length ? [{ label: 'Featured', refs: own }] : []).filter((g) => g.refs.length);
  const bonus = e.extraData?.spotlight?.bonus;
  return {
    id: e.eventID, title: e.name, kind: e.heading, start: e.start, end: e.end,
    groups, moves: facts.moves, bonuses: facts.bonuses.length ? facts.bonuses : bonus ? [bonus] : [], price: facts.price, topics: facts.topics,
    sources: [{ name: 'LeekDuck', link: e.link }, ...(a ? [{ name: 'pokemongo.com', link: a.link }] : [])],
  };
});
const announcements = articles.filter((a) => !claimed.has(a.id)).map(({ id, title, link, date, facts }) => ({
  id, title, date, when: facts.when, groups: facts.groups, moves: facts.moves, bonuses: facts.bonuses, price: facts.price, topics: facts.topics,
  sources: [{ name: 'pokemongo.com', link }],
}));

if (!events.length) throw new Error('no current or upcoming events — has ScrapedDuck changed?');
if (!articles.length) throw new Error('no announcements parsed — has pokemongo.com/en/news changed?');
if (!articles.some((a) => a.facts.groups.length)) throw new Error('no Pokémon found in any announcement — has the article layout changed?');
writeFileSync(new URL('../src/data/news.json', import.meta.url), JSON.stringify({ events, announcements }, null, 1) + '\n');
console.log(`${events.length} events (${claimed.size} matched to an announcement), ${announcements.length} standalone announcements`);
