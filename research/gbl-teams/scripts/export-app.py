# Writes app/src/data/gbl-team-search.json for the Diagnostics "Team search" view. Run from data/:
#   python3 ../scripts/export-app.py [total games played, e.g. `wc -l meta4-memo.tsv`]
# Everything is read from the committed research files; nothing is typed in by hand.
import json, re, sys
log = open('meta4.log').read().split('\n')
m4 = json.load(open('meta4-out.json')); v = json.load(open('variants.json')); rk = json.load(open('ranking-v4.json'))
pct = lambda s: round(float(s) / 100, 4)
team = lambda s: [p.strip() for p in s.split('/')]
check, rounds, cur = [], [], None
for l in log:
    if m := re.match(r'  (.+): meta3 ([\d.]+)%, now ([\d.]+)% (ok|FAIL)', l): check.append({'team': team(m[1]), 'before': pct(m[2]), 'after': pct(m[3])})
    elif m := re.match(r'round (\d+): (\d+) teams, support (\d+), in-pool edge ([\d.]+)%', l):
        cur = {'round': int(m[1]), 'teams': int(m[2]), 'support': int(m[3]), 'edge': pct(m[4]), 'added': []}; rounds.append(cur)
    elif cur is None: continue
    elif l.startswith('  mix: '): cur['mix'] = [{'team': team(x.rsplit(' ', 1)[0]), 'share': pct(x.rsplit(' ', 1)[1][:-1])} for x in l[7:].split(', ')]
    elif m := re.match(r'  prefilter: \d+ teams in (\d+)s', l): cur['prefilterSecs'] = int(m[1])
    elif m := re.match(r'  played (\d+) proposal games', l): cur['wave1Teams'] = int(m[1]) // (3 * cur['support'])
    elif m := re.match(r'  wave 2: (\d+) teams.*best ([\d.]+)% vs wave 1 best ([\d.]+)%.*prefilter ([-\d.]+) \(wave 1\), corrected ([-\d.]+).*wave 1 (\d+), wave 2 (\d+)', l):
        cur.update(wave2Teams=int(m[1]), w2Best=pct(m[2]), w1Best=pct(m[3]), corrPrefilter=float(m[4]), corrCorrected=float(m[5]), w1Hits=int(m[6]), w2Hits=int(m[7]))
    elif m := re.match(r'  best: .* \(prefilter #(\d+)\); best random-sample team ([\d.]+)% \(#(\d+)\)', l): cur.update(bestRank=int(m[1]), randomBest=pct(m[2]))
    elif l.startswith('done:'): cur = None
final = [{'team': team(m[2]), 'share': pct(m[1])} for l in log if (m := re.match(r'  ([\d.]+)%  (.+)$', l))]
for a in m4['added']: rounds[a['round'] - 1]['added'].append({'team': a['team'], 'f': round(a['f'], 4), 'prefRank': a['prefRank'], 'wave': a['wave']})
pick = lambda x: {k: (round(x[k], 4) if isinstance(x[k], float) else x[k]) for k in ('A', 'rank_plain', 'rank_dedup', 'eqw', 'eqv', 'lgw', 'lgw_d', 'fav', 'ncl', 'worst')} | {'aba': len(x['aba'])}
watch = [{'clodsire', 'hydreigon_shadow', 'dondozo'}, {'mimikyu', 'talonflame_shadow', 'rillaboom'}]
out = {
    'generated': 'research/gbl-teams/scripts/export-app.py',
    'summary': {'piecesBefore': 163, 'piecesAfter': len(json.load(open('universe3.json'))['U']), 'variantsTried': len(v['kept']) + len(v['aliases']),
                'variantsKept': len(v['kept']), 'teams': int(re.search(r'(\d+) teams', log[0])[1]), 'games': int(sys.argv[1]) if len(sys.argv) > 1 else None,
                'poolTeams': len(m4['strat']) // 3, 'support': sum(x > 0.004 for x in m4['share']), 'edge': round(m4['edge'], 5), 'ranked': len(rk)},
    'check': check, 'rounds': rounds, 'final': final,
    'ranking': [pick(x) for x in rk[:30]], 'watch': [pick(x) | {'label': ['Your team', 'v3 pick'][i]} for i, w in enumerate(watch) for x in rk if set(x['A']) == w],
    'variants': [{'ref': k['ref'], 'moves': k['moves'], 'gains': len(k['justify']), 'losses': k['lost'], 'opps': [j['opp'] for j in k['justify']]} for k in v['kept']],
}
json.dump(out, open('../../../app/src/data/gbl-team-search.json', 'w'), separators=(',', ':'))
print(len(rounds), 'rounds,', sum(len(r['added']) for r in rounds), 'added,', len(check), 'check rows')
