import pefile, sys, struct, re
pe = pefile.PE(sys.argv[1]); base = pe.OPTIONAL_HEADER.ImageBase; img = pe.get_memory_mapped_image()
for s in sys.argv[2:]:
    for enc in ('utf-16le','ascii'):
        pat = s.encode(enc)
        for m in re.finditer(re.escape(pat), img):
            va = base+m.start(); refs=[]
            p = struct.pack('<I', va); i=0
            while (i:=img.find(p,i))>=0: refs.append(hex(base+i)); i+=1
            print(s, enc, hex(va), refs[:8])
