import pefile, sys, re
pe = pefile.PE(sys.argv[1]); base = pe.OPTIONAL_HEADER.ImageBase; img = pe.get_memory_mapped_image()
a0, a1 = int(sys.argv[2],16)-base, int(sys.argv[3],16)-base
for m in re.finditer(rb'[\x20-\x7e\t\r\n]{4,}', img[a0:a1]):
    print(hex(base+a0+m.start()), m.group().decode().replace('\n','\\n'))
