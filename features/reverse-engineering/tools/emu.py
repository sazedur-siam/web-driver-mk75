import pefile, struct, sys
from unicorn import *
from unicorn.x86_const import *
EXE = sys.argv[1]
pe = pefile.PE(EXE); base = pe.OPTIONAL_HEADER.ImageBase
img = bytearray(pe.get_memory_mapped_image())
size = (len(img)+0xfff)&~0xfff
STUB=0x10000000; STACK=0x20000000; OBJ=0x30000000; HEAP=0x40000000
log=[]
def mk():
    mu = Uc(UC_ARCH_X86, UC_MODE_32)
    mu.mem_map(base, size); mu.mem_write(base, bytes(img))
    mu.mem_map(STUB, 0x10000); mu.mem_write(STUB, b'\xc3'*0x10000)
    mu.mem_map(STACK, 0x100000); mu.mem_map(OBJ, 0x100000); mu.mem_map(HEAP, 0x100000)
    # IAT: point every import to a unique stub
    stubs={}
    for i,e in enumerate(pe.DIRECTORY_ENTRY_IMPORT):
        for j,imp in enumerate(e.imports):
            s = STUB + (i*0x100+j)*4 % 0xff00
            mu.mem_write(imp.address, struct.pack('<I', s)); stubs[s]=imp.name.decode() if imp.name else '?'
    # logger function pointer global
    mu.mem_write(0x64e298, struct.pack('<I', STUB+0xff00)); stubs[STUB+0xff00]='log'
    obj = {0x290:0x1001, 0x294:0x1002, 0x298:0x1003, 0x2a0:5}
    for k,v in obj.items(): mu.mem_write(OBJ+k, struct.pack('<I', v))
    return mu, stubs
NARGS={'Sleep':1,'GetLastError':0,'log':-1,'HidD_SetFeature':3,'HidD_GetFeature':3}
def run(fn, ecx=OBJ, edx=0, args=(), reply=None, regs={}):
    mu, stubs = mk()
    sp = STACK+0x80000
    for a in reversed(args): sp-=4; mu.mem_write(sp, struct.pack('<I',a))
    sp-=4; mu.mem_write(sp, struct.pack('<I', 0xdead0000))
    mu.mem_map(0xdead0000, 0x1000)
    mu.reg_write(UC_X86_REG_ESP, sp); mu.reg_write(UC_X86_REG_ECX, ecx); mu.reg_write(UC_X86_REG_EDX, edx)
    for r,v in regs.items(): mu.reg_write(r, v)
    def hook(mu, addr, sz, _):
        name = stubs.get(addr)
        if addr in (0x5bd34c, 0x5bd352):
            esp = mu.reg_read(UC_X86_REG_ESP)
            ret, h, buf, ln = struct.unpack('<IIII', mu.mem_read(esp, 16))
            data = bytes(mu.mem_read(buf, ln))
            if addr==0x5bd34c: log.append(('SET', h, data))
            else:
                r = reply(data, log) if reply else data
                mu.mem_write(buf, r[:ln]); log.append(('GET', h, r[:ln]))
            mu.reg_write(UC_X86_REG_EAX, 1); mu.reg_write(UC_X86_REG_ESP, esp+16); mu.reg_write(UC_X86_REG_EIP, ret)
        elif name:
            esp = mu.reg_read(UC_X86_REG_ESP); ret = struct.unpack('<I', mu.mem_read(esp,4))[0]
            n = NARGS.get(name, 0); n = 0 if n<0 else n
            mu.reg_write(UC_X86_REG_EAX, 0 if name!='Sleep' else 0)
            mu.reg_write(UC_X86_REG_ESP, esp+4+4*n); mu.reg_write(UC_X86_REG_EIP, ret)
    mu.hook_add(UC_HOOK_CODE, hook, begin=STUB, end=STUB+0x10000)
    mu.hook_add(UC_HOOK_CODE, hook, begin=0x5bd34c, end=0x5bd358)
    mu.emu_start(fn, 0xdead0000, count=20_000_000)
    return mu.reg_read(UC_X86_REG_EAX), mu
def hx(b, n=24): return ' '.join(f'{x:02x}' for x in b[:n]) + (' ...' if len(b)>n else '') + f'  (len {len(b)})'
