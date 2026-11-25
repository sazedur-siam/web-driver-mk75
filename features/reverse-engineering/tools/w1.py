import sys; sys.path.insert(0, sys.argv[2]); sys.argv=[sys.argv[0], sys.argv[1]]
import emu3
from emu3 import *
DATA=HEAP; OUT=HEAP+0x20000
def pat(n): return bytes((i*7+1)&0xff for i in range(n))
def setup(mu): mu.mem_write(DATA, pat(0x2000))
def go(name, fn, **kw):
    pkts.clear(); sleeps.clear()
    r,mu=run(fn, setup=setup, **kw)
    print(f'## {name} -> {r}  ({len([p for p in pkts if p[0]=="W"])} writes)')
    for i,(k,p) in enumerate(pkts[:8]): print(f'  {k} {hx(p)}')
    if len(pkts)>8: print(f'  ... last: {pkts[-1][0]} {hx(pkts[-1][1])}')
    if sleeps: print('  sleeps', sleeps[:6])
    return mu
# SetMatrix(layer=0, buf, len=0x40)
go('SetMatrix layer0 len 30', 0x4980c0, args=(0, DATA, 30))
go('SetMatrix layer2 len 14', 0x4980c0, args=(2, DATA, 14))
emu3.dev.store={0x41: pat(40)}
mu=go('GetMatrix layer1 len 40', 0x498110, args=(1, OUT, 40))
print('  out', hx(mu.mem_read(OUT, 40)))
go('SetLED len 20', 0x498270, args=(DATA, 20))
