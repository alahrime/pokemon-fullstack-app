import json, glob, collections
R=[r for f in sorted(glob.glob('g3b-*.json')) for r in json.load(open(f))]
by=collections.defaultdict(list)
for r in R: by[tuple(r['team'])].append(r)
def stats(r):
    W=sum(g['w'] for g in r['eq'])
    eqw=sum(g['w']*(g['v']>0.5) for g in r['eq'])/W
    eqv=sum(g['w']*g['v'] for g in r['eq'])/W
    lgw=sum(g['v']>0.5 for g in r['log'])/len(r['log'])
    return eqw,eqv,lgw
rows=[]
for team,rs in by.items():
    best=max(rs,key=lambda r:stats(r)[1]); rows.append((stats(best),best))
rows.sort(key=lambda x:-(0.6*x[0][0]+0.4*x[0][2]))
short=lambda n:n.replace('_shadow',' (S)').replace('dunsparce#ASTONISH','dunsparce (Astonish)').replace('_alolan',' (Alola)').replace('_hisuian',' (Hisui)').replace('_shield','')
def wc(r):
    plan=collections.Counter(); closer=collections.Counter(); shield=collections.Counter(); bank=[]; lossTo=collections.Counter()
    for g in r['eq']+r['log']:
        w=g.get('w',0.4/len(r['log']))
        for p,x in g['plan']:
            k,t,pol=p.split(':'); plan[(k if k=='stay' else f"{k} to {short(r['A'][int(t)])}")+(' (save shields)' if pol=='save' else '')]+=w*x
        if g['v']>0.5 and g['ln']['win']:
            last=g['ln']['out'][-1]; closer[short(last['a'])]+=w; shield[f"{last['shA']}-{last['shB']}"]+=w; bank.append(last['enA'])
        elif g['v']<=0.5: lossTo.update(set(g['B']))
    tot=sum(plan.values()); ct=sum(closer.values()) or 1; st=sum(shield.values()) or 1
    return ([f"{k} {v/tot:.0%}" for k,v in plan.most_common(3)], [f"{k} {v/ct:.0%}" for k,v in closer.most_common(2)],
            [f"{k} {v/st:.0%}" for k,v in shield.most_common(3)], (sum(bank)/len(bank) if bank else 0), [short(k) for k,_ in lossTo.most_common(4)])
for i,((eqw,eqv,lgw),r) in enumerate(rows,1):
    plan,clo,sh,bk,lt=wc(r)
    print(f"{i:2} {' / '.join(short(x) for x in r['A']):55} eq-win {eqw:.0%} log-win {lgw:.0%} | lead: {', '.join(plan)} | closes: {', '.join(clo)} | final-fight shields me-them: {', '.join(sh)} | closer banked {bk:.0f}e | loses to: {', '.join(lt)}")
