import pefile, capstone, sys, struct
pe = pefile.PE(sys.argv[1])
base = pe.OPTIONAL_HEADER.ImageBase
iat = {}
for e in pe.DIRECTORY_ENTRY_IMPORT:
    for i in e.imports:
        if i.name: iat[i.address] = (e.dll.decode(), i.name.decode())
text = [s for s in pe.sections if s.Name.startswith(b'.text')][0]
code = text.get_data(); tva = base + text.VirtualAddress
targets = {a:n for a,n in iat.items() if any(k in n[1] for k in sys.argv[2].split(','))}
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
# scan for FF 15 <addr> (call [mem]) and 8B xx <addr> mov reg,[mem]
for off in range(len(code)-6):
    if code[off]==0xFF and code[off+1]==0x15 or (code[off]==0x8B and code[off+1] in (0x35,0x3D,0x1D,0x2D,0x0D,0x15,0x05)):
        a = struct.unpack_from('<I', code, off+2)[0]
        if a in targets:
            print(hex(tva+off), targets[a][1], 'call' if code[off]==0xFF else 'mov')
