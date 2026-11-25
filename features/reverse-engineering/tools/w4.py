import sys, struct; sys.path.insert(0, sys.argv[2]); sys.argv=[sys.argv[0], sys.argv[1]]
import emu3
from emu3 import *
from unicorn import UC_HOOK_CODE
DATA=HEAP
seen=[]
orig_mk=emu3.mk
def mk2():
    mu,st=orig_mk(); mu.mem_write(DATA, bytes(range(64))); mu.mem_write(OBJ+0x238, struct.pack('<I',1))
    def h(mu,a,s,_):
        if a in (0x493b14,0x493b8e,0x493b9d,0x493bb0,0x493bc6,0x493b48,0x493c1e,0x493b5f,0x493b6b): seen.append((hex(a), hex(mu.reg_read(UC_X86_REG_EAX))))
    mu.hook_add(UC_HOOK_CODE, h, begin=0x493930, end=0x493cb0)
    return mu,st
emu3.mk=mk2
r,mu=run(0x493fe0, args=(2, DATA, 30))
print('ret', r, seen, len(pkts))
