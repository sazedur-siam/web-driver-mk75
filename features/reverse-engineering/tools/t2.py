import sys, os; sys.path.insert(0, sys.argv[2]); sys.argv=[sys.argv[0], sys.argv[1]]
from emu2 import *
import emu2
from unicorn.x86_const import *
DATA=HEAP; OUT=HEAP+0x10000; D=int(os.environ.get('DELTA','0'),16)
_mk=emu2.mk
def mk2():
    mu,st=_mk(); mu.mem_write(DATA, bytes((i*7+1)&0xff for i in range(0x1000))); return mu,st
emu2.mk=mk2
def go(name, fn, **kw):
    log.clear(); r,mu=run(fn+D, **kw); print(f'## {name} @{fn+D:#x} -> {r}')
    for k,h,d in log: print(f'  {k} h={h:#x} {hx(d,12)}')
go('GetPassword', 0x48b260, args=(OUT,), regs={UC_X86_REG_EDI:0x1002})
go('SetProfile', 0x48b360, edx=DATA)
go('GetProfile', 0x48b400, ecx=OUT, args=(OBJ,))
go('SetLedMatrix bc', 0x48b4f0, args=(0xbc,), regs={UC_X86_REG_EDI:DATA})
go('SetKeyMatrix', 0x48b5b0, edx=DATA)
go('GetKeyMatrix', 0x48b670, ecx=OUT, args=(OBJ,))
go('SetLedRgbTab', 0x48b760, args=(DATA,0x3f))
go('GetLedRgbTab', 0x48b830, args=(OUT,0x3f))
go('SetMacroData 3', 0x48b940, edx=DATA, args=(3,))
go('Music', 0x48ba00, args=(DATA,0x17a,0))
