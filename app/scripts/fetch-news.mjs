/**
 * The News screen's data: in-game events from LeekDuck and announcements from pokemongo.com/news.
 * Writes src/data/news.json. Network, so it is run by hand (`npm run news`) or by .github/workflows/news.yml.
 *
 * Events come from ScrapedDuck, LeekDuck's events page (leekduck.com/events) published as JSON. A time without a
 * trailing Z is local — the event starts at that hour in every timezone — which is how `new Date` reads it too.
 * Announcements are parsed out of the news page's cards. Either source failing or coming back empty throws, so a
 * site redesign fails the workflow instead of committing an empty News screen.
 */
import { writeFileSync } from 'node:fs';

const get = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (paragon-iv news)' } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
};
const decode = (s) =>
  s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const now = Date.now();
const events = (await (await get('https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json')).json())
  .filter((e) => new Date(e.end).getTime() > now)
  .map((e) => ({ id: e.eventID, name: e.name, kind: e.heading, link: e.link, image: e.image, start: e.start, end: e.end }))
  .sort((a, b) => new Date(a.start) - new Date(b.start));

const html = await (await get('https://pokemongo.com/en/news')).text();
const card = /<a href="\/news\/([^"]+)"[^>]*>[\s\S]*?<img src="([^"]*)"[\s\S]*?timestamp="(\d+)"[\s\S]*?_newsCardTitle[^>]*>([^<]*)</g;
const announcements = [...html.matchAll(card)].map(([, slug, image, ts, title]) => ({
  // The card's src is the 1920px original (=s0); =w480 asks Google's image server for a card-sized one.
  id: slug, title: decode(title).trim(), link: `https://pokemongo.com/news/${slug}`, image: image.replace(/=s0-/, '=w480-'), date: new Date(Number(ts)).toISOString(),
}));

if (!events.length) throw new Error('no current or upcoming events — has ScrapedDuck changed?');
if (!announcements.length) throw new Error('no announcements parsed — has pokemongo.com/en/news changed?');
writeFileSync(new URL('../src/data/news.json', import.meta.url), JSON.stringify({ events, announcements }, null, 1) + '\n');
console.log(`${events.length} events, ${announcements.length} announcements`);
