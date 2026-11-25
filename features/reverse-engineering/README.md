# Reverse-engineering notes (local only)

Specs produced while decoding the official LINGBAO Keyboard Driver v2.0 (`OemDrv.exe`, MK75 build 2025-07-16):

- `spec_wireless.md`: 2.4 GHz / Bluetooth protocol (packets, commands, layouts, key-code encoding)
- `spec_macro_layers.md`: wired macros, key-matrix layers, Fn function codes
- `spec_live_misc.md`: live stream, model check, sleep, timing

`tools/`: Python + Unicorn helpers used to disassemble and emulate vendor functions
(`re.py` disassembler, `emu.py`/`emu2.py`/`emu3.py` emulation harnesses, test drivers).
They expect a venv with `pefile capstone unicorn` and the vendor `OemDrv.exe` extracted with `innoextract`
from `mk_75 driver.zip`. Paths inside the scripts point at the original scratch folder; adjust before reuse.
