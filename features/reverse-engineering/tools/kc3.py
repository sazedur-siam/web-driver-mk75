import sys, struct; sys.path.insert(0, sys.argv[2]); sys.argv=[sys.argv[0], sys.argv[1]]
import emu3
from emu3 import *
KI=HEAP
def enc(fn, t, mods=0, vk=0, extra=0):
    def setup(mu):
        mu.mem_write(KI, struct.pack('<IBBBBI', t, mods, vk, 0, 0, extra)+b'\0'*8)
    try:
        r,mu=run(fn, ecx=OBJ, args=(KI, DEV), setup=setup); return f'{r:08x}'
    except Exception: return 'ERR'
G=0x49a4d0; W=0x495bf0
print('type5 macro:'); print(' ', [(enc(W,5<<24,0,0), enc(G,5<<24,0,0))])
print('type9 raw 0x020000cd etc:'); print(' ', [(hex(x), enc(W,(9<<24)|1,0,0,x), enc(G,(9<<24)|1,0,0,x)) for x in (0x020000cd,0x07000014,0x08030200,0x0004002b,0x00080008)])
print('VKs:'); print(' ', [(hex(v), enc(W,2<<24,0,v), enc(G,2<<24,0,v)) for v in (0xa0,0xa1,0xa3,0xa4,0xa5,0x5b,0x5c,0x2c,0x91,0x13,0x5d,0xfb)])
