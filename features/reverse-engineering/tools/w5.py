import sys, struct; sys.path.insert(0, sys.argv[2]); sys.argv=[sys.argv[0], sys.argv[1]]
import emu3
from emu3 import *
OUT=HEAP+0x20000
def setup(mu): mu.mem_write(OBJ+0x238, struct.pack('<I',1))
def go(name, fn, **kw):
    pkts.clear(); r,mu=run(fn, setup=setup, **kw); print(f'## {name} -> {r}')
    for k,p in pkts[:3]: print(f'  {k} {hx(p)}')
    return mu
emu3.dev.store={0x4a: b'\x55\x10'}
mu=go('3632 ReadPower (0x4a,2B)', 0x4943c0, args=(OUT, OUT+4)); print('  out', hx(mu.mem_read(OUT,1)), hx(mu.mem_read(OUT+4,4)))
emu3.dev.store={}
go('3632 ResetDevice(item=1)', 0x494450, args=(1,))
emu3.dev.store={0x43: bytes(range(40))}
mu=go('combo GetMacro 0x28', 0x498240, args=(OUT, 0x28)); print('  out', hx(mu.mem_read(OUT,8)))
