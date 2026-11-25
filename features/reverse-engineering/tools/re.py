import pefile, capstone, sys, struct
pe = pefile.PE(sys.argv[1]); base = pe.OPTIONAL_HEADER.ImageBase
img = pe.get_memory_mapped_image()
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
text = [s for s in pe.sections if s.Name.startswith(b'.text')][0]
t0 = text.VirtualAddress; t1 = t0+text.Misc_VirtualSize
def calls(target):
    out=[]
    for off in range(t0, t1-5):
        if img[off]==0xE8 or img[off]==0xE9:
            rel = struct.unpack_from('<i', img, off+1)[0]
            if base+off+5+rel == target: out.append(base+off)
    return out
def dis(addr, n):
    for i in md.disasm(img[addr-base:addr-base+n], addr):
        print(f"{i.address:08x}  {i.mnemonic} {i.op_str}")
        if i.mnemonic=='ret' and len(sys.argv)>5: break
def funcstart(addr):
    # walk back to find CC/C3 padding followed by push ebp / sub esp
    a = addr-base
    while a>t0:
        if img[a-1] in (0xCC,0xC3) and (img[a]==0x55 or img[a] in (0x83,0x6A,0x51,0x53,0x56,0x57,0x8B,0xB8)):
            if img[a]==0x55 and img[a+1]==0x8B and img[a+2]==0xEC: return base+a
        a-=1
    return None
cmd = sys.argv[2]
if cmd=='calls':
    for c in calls(int(sys.argv[3],16)): print(hex(c), 'fn', hex(funcstart(c) or 0))
elif cmd=='dis': dis(int(sys.argv[3],16), int(sys.argv[4],0))
elif cmd=='fn': print(hex(funcstart(int(sys.argv[3],16))))
elif cmd=='str':
    a=int(sys.argv[3],16)-base; print(img[a:a+int(sys.argv[4],0)])
