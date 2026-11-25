import sys, re; sys.path.insert(0, sys.argv[2]); ini=sys.argv[3]; sys.argv=[sys.argv[0], sys.argv[1]]
from emu2 import *
from unicorn.x86_const import *
txt=open(ini,encoding='latin-1').read().replace('\r','')
sec=None; name=None; rows=[]
for l in txt.split('\n'):
    l=l.strip()
    if l.startswith('['): sec=l; continue
    if l.startswith(';') or (l and not l.startswith('K') and '=' not in l): name=l.lstrip(';'); continue
    m=re.match(r'K(\d+)=(.*)',l)
    if m and sec in ('[FN1]','[KEY]'):
        p=[x.strip() for x in m.group(2).split(',')]
        if sec=='[KEY]' and int(p[4],0)!=9: continue
        t=int(p[4] if sec=='[KEY]' else p[0],0); code=int(p[6] if sec=='[KEY]' else p[2],0)
        rows.append((sec,m.group(1),name,t,code,p))
for sec,k,name,t,code,p in rows:
    if t==9:
        r,_=run(0x468190, ecx=code)
        print(f'{sec} K{k:<3} {name:<10} type9 {code:#010x} -> hw {r:#010x}  LE bytes {" ".join(f"{(r>>(8*i))&0xff:02x}" for i in range(4))}')
    else:
        print(f'{sec} K{k:<3} {name:<10} type{t} vk={p[1]}')
