/**
 * Layout fingerprint, for verifying that a styling refactor changes nothing.
 *
 * USAGE. Copy this file to `app/public/__snap.js` (it must be served from the
 * same origin; it is kept out of `public/` so it never ships in a build), then
 * in the dev-server console:
 *
 *   // baseline, before the refactor
 *   const load = () => new Promise(r => { const s = document.createElement('script');
 *     s.src = '/__snap.js?v=' + Date.now(); s.onload = r; document.head.appendChild(s); });
 *   await load(); window.__snapAll = true; await window.__snapRun('before');
 *
 *   // ... make the change, then reload the page and:
 *   await load(); window.__snapAll = true;
 *   await window.__snapRun('after', window.__snapPaths('before'));
 *   window.__snapDiff('before', 'after');
 *
 * Clear localStorage (except the `snapx.` keys) and reload between passes, so
 * both runs build the DOM the same way. `__snapAll = true` records every
 * rendered element; leaving it unset records only inline-styled ones, which is
 * the cheaper pass when converting inline styles specifically.
 *
 * The first two attempts at this were not usable and the reason is worth
 * recording. Hashing every element's class name made the diff meaningless by
 * construction — moving a style into a stylesheet changes the class, so every
 * row differs. Hashing every element's geometry instead was worse than useless:
 * two runs of IDENTICAL code differed in 7,390 elements, because app state
 * persists between passes and some panels fill in asynchronously. A noise floor
 * that large cannot distinguish a broken conversion from a screen that simply
 * settled differently.
 *
 * So this measures the smallest thing that actually answers the question. The
 * elements at risk are exactly those carrying an inline style today. Record
 * their computed style, keyed by position in the tree; after the refactor those
 * same positions must compute the same values, whatever the classes are called
 * and whatever else on the page has moved.
 *
 * Every pass starts from a fresh reload with app state cleared, so the DOM is
 * built the same way both times.
 */

const SNAP_PROPS = [
  'display', 'position', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems',
  'alignSelf', 'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gap',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'letterSpacing', 'textAlign',
  'color', 'backgroundColor', 'backgroundImage', 'opacity', 'borderRadius',
  'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'boxShadow', 'overflow', 'overflowX', 'overflowY', 'zIndex', 'transform',
  'whiteSpace', 'pointerEvents', 'flex', 'flexGrow', 'flexShrink', 'flexBasis',
  'top', 'right', 'bottom', 'left', 'placeItems', 'objectFit', 'verticalAlign',
];

const snapPath = (el) => {
  const parts = [];
  let n = el;
  while (n && n.nodeType === 1 && n !== document.body) {
    parts.push(`${n.tagName.toLowerCase()}[${n.parentNode ? [...n.parentNode.children].indexOf(n) : 0}]`);
    n = n.parentNode;
  }
  return parts.reverse().join('/');
};

/** Walk a recorded path back to a live element, or null if the shape changed. */
const snapResolve = (path) => {
  let n = document.body;
  for (const step of path.split('/')) {
    const i = Number(step.slice(step.indexOf('[') + 1, -1));
    n = n && n.children[i];
    if (!n) return null;
  }
  return n;
};

const snapRead = (el) => {
  const cs = getComputedStyle(el);
  const out = {};
  for (const p of SNAP_PROPS) out[p] = cs[p];
  return out;
};

const snapWait = (ms) => new Promise((r) => setTimeout(r, ms));
const SNAP_SCREENS = ['Report', 'Battle', 'Rankings', 'GBL Teams', 'Show 6', 'Cores', 'Diagnostics'];

/**
 * Record the at-risk elements on every screen.
 *
 * `mode: 'styled'` collects elements that still carry a style attribute — the
 * before pass. `mode: 'paths'` re-reads a list of paths recorded earlier — the
 * after pass, when those elements no longer have the attribute that found them.
 */
window.__snapRun = async function (label, paths) {
  const nav = (n) => [...document.querySelectorAll('.nav-tab')].find((x) => x.textContent.includes(n));
  const data = {};
  for (const s of SNAP_SCREENS) {
    const t = nav(s);
    if (!t) continue;
    t.click();
    await snapWait(1500);
    window.scrollTo(0, 0);
    await snapWait(200);
    if (paths) {
      for (const key of paths.filter((k) => k.startsWith(s + '|'))) {
        const el = snapResolve(key.slice(s.length + 1));
        data[key] = el ? snapRead(el) : null;
      }
    } else {
      // 'all' widens the net from inline-styled elements to every rendered one,
      // which is what a stylesheet-only refactor needs: the elements at risk
      // there are the ones carrying the merged classes, not the ones carrying a
      // style attribute.
      const sel = window.__snapAll ? '*' : '[style]';
      for (const el of document.querySelectorAll(sel)) {
        // `html` and `body` have no expressible path — the resolver walks down
        // FROM body — so they read as changed on every pass. They are the page,
        // not part of what a refactor moves.
        if (el === document.body || !document.body.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (window.__snapAll && r.width === 0 && r.height === 0) continue;
        data[`${s}|${snapPath(el)}`] = snapRead(el);
      }
    }
  }
  window.__snapStore = window.__snapStore || {};
  window.__snapStore[label] = data;
  localStorage.setItem(`snapx.${label}`, JSON.stringify(data));
  return JSON.stringify({ label, elements: Object.keys(data).length });
};

window.__snapPaths = (label) =>
  Object.keys(JSON.parse(localStorage.getItem(`snapx.${label}`) || '{}'));

/** Compare two recorded passes property by property. */
window.__snapDiff = function (a, b) {
  const A = JSON.parse(localStorage.getItem(`snapx.${a}`) || '{}');
  const B = JSON.parse(localStorage.getItem(`snapx.${b}`) || '{}');
  const changes = [];
  let unresolved = 0, missing = 0, same = 0;
  for (const [k, va] of Object.entries(A)) {
    if (!(k in B)) { missing++; continue; }
    const vb = B[k];
    if (vb === null) { unresolved++; continue; }
    const diffs = SNAP_PROPS.filter((p) => va[p] !== vb[p]).map((p) => `${p}: ${va[p]} -> ${vb[p]}`);
    if (diffs.length) changes.push({ el: k, diffs });
    else same++;
  }
  return JSON.stringify({
    recorded: Object.keys(A).length,
    identical: same,
    changed: changes.length,
    unresolved,
    missing,
    detail: changes.slice(0, 30),
  }, null, 1);
};

/** A pass always starts from the same place: fresh reload, app state cleared. */
window.__snapReset = function () {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('snapx.')) localStorage.removeItem(k);
  }
  location.reload();
};
