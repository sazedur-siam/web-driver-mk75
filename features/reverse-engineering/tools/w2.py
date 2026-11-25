import sys; sys.path.insert(0, sys.argv[2]); sys.argv=[sys.argv[0], sys.argv[1]]
import emu3
from emu3 import *
DATA=HEAP; OUT=HEAP+0x20000
def pat(n): return bytes((i*7+1)&0xff for i in range(n))
def setup(mu): mu.mem_write(DATA, pat(0x2000))
def go(name, fn, **kw):
    pkts.clear(); sleeps.clear()
    r,mu=run(fn, setup=setup, **kw)
    print(f'## {name} -> {r}')
    for k,p in pkts[:6]: print(f'  {k} {hx(p)}')
    if len(pkts)>6: print(f'  ... ({len(pkts)} pkts) last: {pkts[-1][0]} {hx(pkts[-1][1])}')
    return mu
print('### CDev3632 (report 0x13)')
go('SetMatrix layer2 len 30', 0x493fe0, args=(2, DATA, 30))
emu3.dev.store={0x41: pat(20), 0x44: pat(0x80), 0x4a: b'\x02'}
mu=go('GetMatrix layer1 len 20', 0x494020, args=(1, OUT, 20)); print('  out', hx(mu.mem_read(OUT,20)))
go('SetLED 0x80', 0x494150, args=(DATA, 0x80))
mu=go('GetLED 0x80', 0x4941a0, args=(OUT, 0x80)); print('  out[0:16]', hx(mu.mem_read(OUT,16)))
go('SetMacro 0x210', 0x4940f0, args=(DATA, 0x210))
go('SetOnBoard 2', 0x4941d0, args=(2,))
print('### CDevComboFilm (report 0x15)')
emu3.dev.store={0x44: pat(0x80), 0x4a: b'\x01', 0x07: b'\x01\x00', 0x42: pat(0x17a), 0x49: pat(0x200), 0x43: pat(0x30)}
mu=go('GetLED 0x80', 0x4982d0, args=(OUT, 0x80)); print('  out[0:16]', hx(mu.mem_read(OUT,16)))
go('SetMacro 0x210', 0x498200, args=(DATA, 0x210))
go('SetOnBoard 3', 0x498310, args=(3,))
mu=go('GetOnBoard', 0x498370, args=(OUT,)); print('  out', hx(mu.mem_read(OUT,1)))
go('cmd2 colourgroup g0 0x17a', 0x4983e0, args=(0, DATA, 0x17a))
go('cmd9 rgbtab 0x200', 0x498440, args=(DATA, 0x200))
mu=go('cmd0x49 get rgbtab', 0x498480, args=(OUT, 0x200)); print('  out[0:8]', hx(mu.mem_read(OUT,8)))
go('cmd0x88 stream len 30 sub 0', 0x4984f0, args=(DATA, 30, 0))
go('cmd0x8e stream len 30 sub 1', 0x498520, args=(DATA, 30, 1))
mu=go('online (cmd7)', 0x4984a0); print('  [obj+0x238]=', mu.mem_read(OBJ+0x238,4).hex())
