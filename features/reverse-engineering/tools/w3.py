import sys, struct; sys.path.insert(0, sys.argv[2]); sys.argv=[sys.argv[0], sys.argv[1]]
import emu3
from emu3 import *
DATA=HEAP; OUT=HEAP+0x20000
def pat(n): return bytes((i*7+1)&0xff for i in range(n))
def setup(mu):
    mu.mem_write(DATA, pat(0x2000)); mu.mem_write(OBJ+0x238, struct.pack('<I',1))
def go(name, fn, **kw):
    pkts.clear()
    r,mu=run(fn, setup=setup, **kw)
    print(f'## {name} -> {r}')
    for k,p in pkts[:4]: print(f'  {k} {hx(p)}')
    if len(pkts)>4: print(f'  ... ({len(pkts)} pkts) last: {pkts[-1][0]} {hx(pkts[-1][1])}')
    return mu
print('### CDev3632 (report 0x13), [obj+0x238]=1')
go('SetMatrix layer2 len 30', 0x493fe0, args=(2, DATA, 30))
emu3.dev.store={0x41: pat(20), 0x44: pat(0x80), 0x4a: b'\x02', 0x07: b'\x01\x01'}
mu=go('GetMatrix layer1 len 20', 0x494020, args=(1, OUT, 20)); print('  out', hx(mu.mem_read(OUT,20)))
go('SetLED 0x80', 0x494150, args=(DATA, 0x80))
mu=go('GetLED 0x80', 0x4941a0, args=(OUT, 0x80)); print('  out[0:16]', hx(mu.mem_read(OUT,16)))
go('SetOnBoard 2', 0x4941d0, args=(2,))
