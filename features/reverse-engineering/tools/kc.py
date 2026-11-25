import sys, struct; sys.path.insert(0, sys.argv[2]); sys.argv=[sys.argv[0], sys.argv[1]]
import emu3
from emu3 import *
KI=HEAP
cases = [
 ('key A', (2<<24), 0, 0x41), ('key F1', 2<<24, 0, 0x70), ('ctrl+C', 2<<24, 1, 0x43), ('mod LCtrl alone', 2<<24, 1, 0),
 ('VK LCtrl', 2<<24, 0, 0xA2), ('VK Esc', 2<<24, 0, 0x1b), ('VK Space',2<<24,0,0x20), ('VK Delete',2<<24,0,0x2e),
 ('mouse left', (1<<24)|0x11, 0, 0), ('mouse 5', (1<<24)|0x15, 0, 0),
 ('media play', (4<<24)|0x21, 0, 0), ('media email', (4<<24)|0x22, 0, 0), ('vol+', (3<<24)|0x2d, 0,0),
 ('cmd close', (6<<24)|0x43, 0,0), ('disable', (8<<24)|0xa2,0,0), ('fn', 2<<24, 0, 0xfa),
]
for fn,name in ((0x495bf0,'916KB'),(0x49a4d0,'G5KB')):
    out=[]
    for c,t,mods,vk in cases:
        def setup(mu, t=t, mods=mods, vk=vk):
            mu.mem_write(KI, struct.pack('<IBB', t, mods, vk)+b'\0'*10)
        try:
            r,mu=run(fn, ecx=OBJ, args=(KI, DEV), setup=setup)
            out.append(f'{r:08x}')
        except Exception as e: out.append('ERR')
    print(name, out)
print([c[0] for c in cases])
