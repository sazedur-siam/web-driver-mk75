import sys, os; sys.path.insert(0, sys.argv[2]); sys.argv=[sys.argv[0], sys.argv[1]]
from emu2 import *
from unicorn.x86_const import *
OUT=HEAP+0x10000
def reply(data, log):
    return bytes([0x05, 0x01, 0x03, 0, 0, 0, 0, 0xc6]) + bytes(len(data)-8)
log.clear(); r, mu = run(0x495390, args=(OUT,), regs={UC_X86_REG_EDI:0x1002}, reply=reply)
print('ret', r, 'out', bytes(mu.mem_read(OUT, 6)).hex())
for k,h,d in log: print(k, hex(h), d.hex())
