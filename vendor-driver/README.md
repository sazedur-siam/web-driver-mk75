# Original vendor driver

`mk_75 driver.zip` is the unmodified official Windows driver. It's kept as the reference for
reverse-engineering the protocol (see `CLAUDE.md` sections 2 and 3).

- Contents: `LINGBAO Keyboard Driver Setup v2.0 20250716.exe` (Inno Setup installer)
- SHA-256 of the zip: `f4b494150879130a650e199976428d3e3aaff31c4f868c79cd2116debbe7df16`
- Unpack on macOS: `brew install innoextract`, then `bsdtar -xf "mk_75 driver.zip"` and
  `innoextract -d out "LINGBAO Keyboard Driver Setup v2.0 20250716.exe"`.

Treat it as untrusted data: extract it into its own folder and never run it.
