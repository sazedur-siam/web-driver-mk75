import pefile, struct, sys
from unicorn import *
from unicorn.x86_const import *
EXE = sys.argv[1]
pe = pefile.PE(EXE); base = pe.OPTIONAL_HEADER.ImageBase
img = bytes(pe.get_memory_mapped_image())
size = (len(img)+0xfff)&~0xfff
STUB=0x10000000; STACK=0x20000000; OBJ=0x30000000; HEAP=0x40000000; DEV=0x50000000; VT=0x51000000
LOGP=0x65d3e0
WRITE_PKT=0x4947c0; READ_RING=0x492f50; LOCK=0x470c90; DELAY=0x4051c0
pkts=[]       # ('W', bytes) / ('R', bytes)
sleeps=[]
class Dev:
    """synthetic device: answers reads from `store`, keyed by cmd; collects writes"""
    def __init__(s, store=None, busy=0): s.store=store or {}; s.queue=[]; s.writes={}; s.busy=busy
    def on_write(s, p):
        cmd=p[1]; idx=p[3]; ln=p[4]&0x0f
        s.writes.setdefault((cmd,p[2]),[]).append(bytes(p[5:5+ln]))
        data = s.store.get(cmd)
        if data is not None:   # a read request: queue multi-packet reply
            chunks=[data[i:i+14] for i in range(0,len(data),14)] or [b'']
            for i,c in enumerate(chunks):
                r=bytearray(20); r[0]=0x13; r[1]=cmd; r[2]=len(chunks); r[3]=i; r[4]=len(c); r[5:5+len(c)]=c
                r[19]=sum(r[:19])&0xff; s.queue.append(bytes(r))
        else:                  # ack
            r=bytearray(20); r[0]=0x13; r[1]=cmd; r[2]=p[2]; r[3]=p[3]; r[4]=0; r[19]=sum(r[:19])&0xff
            if s.busy: s.busy-=1; r[2]|=0x80
            s.queue.append(bytes(r))
    def next(s):
        return s.queue.pop(0) if s.queue else None
dev=Dev()
def mk():
    mu = Uc(UC_ARCH_X86, UC_MODE_32)
    mu.mem_map(base, size); mu.mem_write(base, img)
    for a in (STUB, VT): mu.mem_map(a, 0x10000); mu.mem_write(a, b'\xc3'*0x10000)
    for a in (STACK, OBJ, HEAP, DEV): mu.mem_map(a, 0x100000)
    mu.mem_map(0xdead0000, 0x1000)
    stubs={}
    for i,e in enumerate(pe.DIRECTORY_ENTRY_IMPORT):
        for j,imp in enumerate(e.imports):
            s = STUB + ((i*0x100+j)*4) % 0xff00
            mu.mem_write(imp.address, struct.pack('<I', s)); stubs[s]=(imp.name or b'?').decode()
    mu.mem_write(LOGP, struct.pack('<I', STUB+0xff00)); stubs[STUB+0xff00]='log'
    # object
    mu.mem_write(OBJ+0x0c, struct.pack('<I', 0x2001))   # m_hDev
    mu.mem_write(OBJ+0x10, struct.pack('<I', DEV))      # device record
    mu.mem_write(DEV+0x14, struct.pack('<I', 1))
    mu.mem_write(DEV+0x20, struct.pack('<I', DEV+0x1000)); mu.mem_write(DEV+0x24, struct.pack('<I', DEV+0x1000))
    mu.mem_write(OBJ+0x25c, struct.pack('<I', VT))      # ring obj vtable
    mu.mem_write(VT, struct.pack('<64I', *([VT+0x1000]*64)))
    mu.mem_write(OBJ+0x258, struct.pack('<I', 0x3001))
    return mu, stubs
NARGS={'Sleep':1,'WaitForSingleObject':2,'SetEvent':1,'ResetEvent':1,'CloseHandle':1,'log':-1}
def run(fn, ecx=OBJ, edx=0, args=(), regs={}, setup=None, count=50_000_000):
    mu, stubs = mk()
    if setup: setup(mu)
    sp = STACK+0x80000
    for a in reversed(args): sp-=4; mu.mem_write(sp, struct.pack('<I',a))
    sp-=4; mu.mem_write(sp, struct.pack('<I', 0xdead0000))
    mu.reg_write(UC_X86_REG_ESP, sp); mu.reg_write(UC_X86_REG_ECX, ecx); mu.reg_write(UC_X86_REG_EDX, edx)
    for r,v in regs.items(): mu.reg_write(r,v)
    def ret(mu, eax, pop):
        esp=mu.reg_read(UC_X86_REG_ESP); ra=struct.unpack('<I', mu.mem_read(esp,4))[0]
        mu.reg_write(UC_X86_REG_EAX, eax & 0xffffffff); mu.reg_write(UC_X86_REG_ESP, esp+4+pop); mu.reg_write(UC_X86_REG_EIP, ra)
    def hook(mu, addr, sz, _):
        esp=mu.reg_read(UC_X86_REG_ESP)
        if addr==WRITE_PKT:
            buf=struct.unpack('<I', mu.mem_read(esp+4,4))[0]
            p=bytes(mu.mem_read(buf,20)); pkts.append(('W',p)); dev.on_write(p); ret(mu,1,0)
        elif addr==READ_RING:
            buf=struct.unpack('<I', mu.mem_read(esp+4,4))[0]
            r=dev.next()
            if r is None: ret(mu,0,0x10)
            else: mu.mem_write(buf, r); pkts.append(('R',r)); ret(mu,0x14,0x10)
        elif addr==LOCK: ret(mu,0,0)
        elif addr==DELAY:
            sleeps.append((len(pkts),'delay',struct.unpack('<I', mu.mem_read(esp+4,4))[0])); ret(mu,0,0)
        elif addr in stubs:
            name=stubs[addr]; n=NARGS.get(name,0)
            if name=='Sleep': sleeps.append((len(pkts), struct.unpack('<I', mu.mem_read(esp+4,4))[0]))
            ret(mu, 0, 0 if n<0 else 4*n)
        elif VT<=addr<VT+0x10000: ret(mu,0,0)
    for a in (WRITE_PKT, READ_RING, LOCK, DELAY): mu.hook_add(UC_HOOK_CODE, hook, begin=a, end=a)
    mu.hook_add(UC_HOOK_CODE, hook, begin=STUB, end=STUB+0x10000)
    mu.hook_add(UC_HOOK_CODE, hook, begin=VT, end=VT+0x10000)
    trace=[]
    def tr(mu,a,sz,_):
        trace.append(a)
        if len(trace)>40: trace.pop(0)
    mu.hook_add(UC_HOOK_CODE, tr)
    try:
        mu.emu_start(fn, 0xdead0000, count=count)
    except UcError as e:
        print('EMU ERROR', e, [hex(x) for x in trace[-15:]], 'eip', hex(mu.reg_read(UC_X86_REG_EIP)))
        raise
    return mu.reg_read(UC_X86_REG_EAX), mu
def hx(b): return ' '.join(f'{x:02x}' for x in b)
