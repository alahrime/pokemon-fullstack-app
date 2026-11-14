# Step 3: plain vs deduplicated scores from g3c-*.json. Run from data/: python3 ../scripts/sum3.py [log exponent, default 0.5]
# Writes top100-v4.md (ranking), leadmix-v4.md (lead plans), ranking-v4.json; prints the top-10 cluster check.
import json, glob, collections, sys
P = float(sys.argv[1]) if len(sys.argv) > 1 else 0.5
R = [r for f in sorted(glob.glob('g3c-*.json')) for r in json.load(open(f))]
uni = json.load(open('universe3.json')); U = uni['U']; ix = {u: i for i, u in enumerate(U)}; M = uni['R']
var = json.load(open('variants.json')); MEAN = [ix[u] for u in var['meaningful']]
n = len(U)
inv = lambda m: [[1000 - m[j][i] for j in range(n)] for i in range(n)]
ich, ic0 = inv(M['ch']), inv(M['c0e'])
RA = [[((M['s11'][i][j] + M['s22'][i][j]) / 2 + (M['s11'][i][j] + M['ch'][i][j] + ich[i][j]) / 3
        + (M['s00'][i][j] + M['s01'][i][j] + M['c0e'][i][j] + ic0[i][j]) / 4) / 3 for j in range(n)] for i in range(n)]
short = lambda s: s.replace('_shadow', ' (S)').replace('dunsparce#ASTONISH', 'dunsparce (Astonish)').replace('dunsparce#ROLLOUT', 'dunsparce (Rollout)').replace('_alolan', ' (Alola)').replace('_hisuian', ' (Hisui)').replace('_shield', '')
def name(p):
    if '#' in p and not p.startswith('dunsparce'):
        b, mv = p.split('#'); return f"{short(b)} [{'/'.join(m.title().replace('_', ' ') for m in mv.split('-'))}]"
    return short(p)
team = lambda A: ' / '.join(name(x) for x in A)

# equivalence class: the same three pieces in any order (step 1 kept every shadow toggle and variant as distinct,
# and folded movesets never appear as pieces, so nothing else merges)
cls = lambda B: tuple(sorted(B))
def clusters(items):
    """items: [(class, weight, v)] -> single-link clusters: share 2 of 3 pieces, same winner, value within 0.05."""
    by = collections.defaultdict(lambda: [0.0, 0.0, 0, 0.0])  # class -> [weight, weight*v, count, weight*win]
    for c, w, v in items: e = by[c]; e[0] += w; e[1] += w * v; e[2] += 1; e[3] += w * (v > 0.5)
    C = list(by); val = {c: by[c][1] / by[c][0] if by[c][0] else 0.5 for c in C}
    par = {c: c for c in C}
    def f(c):
        while par[c] != c: par[c] = par[par[c]]; c = par[c]
        return c
    for i, a in enumerate(C):
        for b in C[i + 1:]:
            if len(set(a) & set(b)) >= 2 and (val[a] > 0.5) == (val[b] > 0.5) and abs(val[a] - val[b]) <= 0.05: par[f(a)] = f(b)
    g = collections.defaultdict(list)
    for c in C: g[f(c)].append(c)
    out = []
    for mem in g.values():
        w = sum(by[c][0] for c in mem); cnt = sum(by[c][2] for c in mem)
        out.append({'members': mem, 'w': w, 'n': cnt, 'v': sum(by[c][1] for c in mem) / w if w else 0.5,
                    'win': sum(by[c][3] for c in mem) / w if w else 0})
    return out

def score(r):
    W = sum(g['w'] for g in r['eq'])
    eqw = sum(g['w'] * (g['v'] > 0.5) for g in r['eq']) / W; eqv = sum(g['w'] * g['v'] for g in r['eq']) / W
    lgw = sum(g['v'] > 0.5 for g in r['log']) / len(r['log']); lgv = sum(g['v'] for g in r['log']) / len(r['log'])
    ce = clusters([(cls(g['B']), g['w'] / W, g['v']) for g in r['eq']])
    cl = clusters([(cls(g['B']), 1.0, g['v']) for g in r['log']])
    # equilibrium: a cluster counts once at its real weight (sum of shares); its result is the share-weighted mean
    eqw_d = sum(c['w'] * (c['v'] > 0.5) for c in ce)
    # log: each cluster weighs count^P, normalised
    Z = sum(c['n'] ** P for c in cl)
    lgw_d = sum(c['n'] ** P * c['win'] for c in cl) / Z; lgv_d = sum(c['n'] ** P * c['v'] for c in cl) / Z
    allc = ce + cl; worst = min(allc, key=lambda c: c['v'])
    return dict(eqw=eqw, eqv=eqv, lgw=lgw, lgv=lgv, eqw_d=eqw_d, lgw_d=lgw_d, lgv_d=lgv_d,
                plain=0.6 * eqw + 0.4 * lgw, dedup=0.6 * eqw_d + 0.4 * lgw_d,
                fav=sum(c['v'] > 0.5 for c in allc), ncl=len(allc), favE=sum(c['v'] > 0.5 for c in ce), nE=len(ce),
                favL=sum(c['v'] > 0.5 for c in cl), nL=len(cl), worst=worst['v'], worstT=worst['members'][0],
                merged=sorted(allc, key=lambda c: -len(c['members']))[:3])

def wc(r):
    plan = collections.Counter(); closer = collections.Counter(); lossTo = collections.Counter()
    for g in r['eq'] + r['log']:
        w = g.get('w', 0.4 / len(r['log']))
        for p, x in g['plan']: plan[p] += w * x
        if g['v'] > 0.5 and g['ln']['win']: closer[g['ln']['out'][-1]['a']] += w
        elif g['v'] <= 0.5: lossTo.update(set(g['B']))
    return plan, closer, lossTo

def label(p, A):
    k, t, pol = p.split(':'); who = name(A[int(t)])
    s = {'stay': 'stay', 'now': f'switch to {who} on turn 1', 'after': f'first charged move, then {who}'}[k]
    return s + (' (save shields)' if pol == 'save' else '')

rows = []
for r in R:
    s = score(r); plan, closer, loss = wc(r); A = r['A']
    clo = closer.most_common(1)[0][0] if closer else A[2]
    aba = [U[o] for o in MEAN if clo != A[0] and RA[ix[A[0]]][o] < 500 and RA[ix[clo]][o] < 500]
    rows.append(dict(A=A, s=s, plan=plan, closer=clo, loss=[k for k, _ in loss.most_common(3)], aba=aba))
for k in ('plain', 'dedup'):
    for i, x in enumerate(sorted(rows, key=lambda x: -x['s'][k]), 1): x['rank_' + k] = i
rows.sort(key=lambda x: x['rank_dedup'])
pc = lambda x: f'{x:.0%}'
abaS = lambda a: (f'{len(a)}: ' + ', '.join(name(o) for o in a[:3]) + (' …' if len(a) > 3 else '')) if a else '—'
out = ['# Great League ranking, v4: plain vs deduplicated', '',
       f'{len(rows)} teams (meta4 pool on best lead, plus the v3 ranking and the user\'s team). Ranked by the deduplicated score, '
       f'`0.6 × eq win + 0.4 × log win`, with log clusters weighted by count^{P}. "Plain" is the same formula without clustering. '
       'Breadth = clusters favoured / clusters met (equilibrium + log). Worst = lowest cluster value. ABA = meaningful opponents '
       'that both the lead and the usual closer lose to (1v1 rating < 500).', '',
       '| # | Plain # | Lead / back / back | Eq win | Log win plain → dedup | Score plain → dedup | Breadth | Worst cluster | Main lead plan | Closer | ABA |',
       '|---|---|---|---|---|---|---|---|---|---|---|']
for x in rows[:100]:
    s = x['s']; tp = sum(x['plan'].values()); lp = x['plan'].most_common(1)[0]
    out.append(f"| {x['rank_dedup']} | {x['rank_plain']} | {team(x['A'])} | {pc(s['eqw'])} | {pc(s['lgw'])} → {pc(s['lgw_d'])} | "
               f"{s['plain']:.3f} → {s['dedup']:.3f} | {s['fav']}/{s['ncl']} | {s['worst']:.2f} ({team(s['worstT'])}) | "
               f"{label(lp[0], x['A'])} {lp[1] / tp:.0%} | {name(x['closer'])} | {abaS(x['aba'])} |")
open('top100-v4.md', 'w').write('\n'.join(out) + '\n')
lm = ['# Lead plan mix per team, v4', '', 'Share of the solved strategy over all games (equilibrium by share, plus the log). Plans under 3% fold into "other".', '']
for x in rows[:100]:
    tp = sum(x['plan'].values()); other = 0; lm.append(f"## {x['rank_dedup']}. {team(x['A'])}")
    for p, v in x['plan'].most_common():
        if v / tp < 0.03: other += v; continue
        lm.append(f'- {v / tp:4.0%}  {label(p, x["A"])}')
    if other: lm.append(f'- {other / tp:4.0%}  other')
    lm.append('')
open('leadmix-v4.md', 'w').write('\n'.join(lm))
json.dump([dict(A=x['A'], rank_plain=x['rank_plain'], rank_dedup=x['rank_dedup'], closer=x['closer'], aba=x['aba'],
                **{k: v for k, v in x['s'].items() if k not in ('merged', 'worstT')}) for x in rows], open('ranking-v4.json', 'w'), indent=0)
# check: the plain top 10, before/after, and the three largest merged clusters for each
print(f'log exponent {P}')
for x in sorted(rows, key=lambda x: x['rank_plain'])[:10]:
    s = x['s']; print(f"plain #{x['rank_plain']} → dedup #{x['rank_dedup']}  {team(x['A'])}: plain {s['plain']:.3f} (eq {pc(s['eqw'])}, log {pc(s['lgw'])}) → dedup {s['dedup']:.3f} (eq {pc(s['eqw_d'])}, log {pc(s['lgw_d'])}), breadth {s['fav']}/{s['ncl']}, worst {s['worst']:.2f}")
    for c in s['merged']:
        if len(c['members']) > 1: print(f"    merged {len(c['members'])} (v {c['v']:.2f}, {'win' if c['v'] > 0.5 else 'loss'}): " + '; '.join(team(m) for m in c['members'][:5]))
