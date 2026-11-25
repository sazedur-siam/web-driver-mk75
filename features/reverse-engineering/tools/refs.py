import pefile, sys, struct
pe = pefile.PE(sys.argv[1]); base = pe.OPTIONAL_HEADER.ImageBase
data = pe.get_memory_mapped_image()
for e in pe.DIRECTORY_ENTRY_IMPORT:
    if b'HID' not in e.dll.upper(): continue
    for i in e.imports:
        pat = struct.pack('<I', i.address); idx = 0; hits=[]
        while True:
            idx = data.find(pat, idx)
            if idx<0: break
            hits.append(hex(base+idx)); idx+=1
        print(i.name.decode(), hex(i.address), hits)
