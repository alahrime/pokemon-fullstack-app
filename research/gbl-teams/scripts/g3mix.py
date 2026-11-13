import collections
exec(open('g3sum2.py').read().split('for i,((eqw')[0])  # reuse loading, ranking, short()
def label(p,A):
    k,t,pol=p.split(':'); who=short(A[int(t)]).title()
    s={'stay':f"Stay in with {short(A[0]).title()}",'now':f"Switch to {who} on turn 1",'after':f"Fight to the first charged move, then switch to {who}"}[k]
    return s+(", no shields in the lead" if pol=='save' else "")
out=['# Lead plan mix per team','','Share of the solved strategy, averaged over all games (vs the equilibrium, weighted by its share, plus the logged teams). Plans under 3% are folded into "other".','']
for i,(st,r) in enumerate(rows,1):
    plan=collections.Counter()
    for g in r['eq']+r['log']:
        w=g.get('w',0.4/len(r['log']))
        for p,x in g['plan']: plan[p]+=w*x
    tot=sum(plan.values()); out.append(f"## {i}. {' / '.join(short(x).title() for x in r['A'])}  (eq-win {st[0]:.0%}, log-win {st[2]:.0%})")
    other=0
    for p,v in plan.most_common():
        if v/tot<0.03: other+=v; continue
        out.append(f"- {v/tot:4.0%}  {label(p,r['A'])}")
    if other: out.append(f"- {other/tot:4.0%}  other")
    out.append('')
open('leadmix.md','w').write('\n'.join(out)); print('\n'.join(out))
