/**
 * What the UI talks to. Both the wired protocol (Mk75) and the 2.4 GHz / Bluetooth protocol
 * (Mk75Wireless) expose the *wired* data formats (254-byte profile, 1024-byte key matrix,
 * RGB table, per-key planes); the wireless class translates to and from its own layouts.
 */
export interface DeviceCaps {
  /** Macro storage supported (wired only; the wireless macro format isn't decoded yet). */
  macros: boolean;
  /** Effects can use any of the 7 palette colours (wireless always uses colour 1 or colourful). */
  paletteIndex: boolean;
  /** Battery level can be read. */
  battery: boolean;
}

export interface Mk75Device {
  readonly kind: 'wired' | 'wireless';
  readonly transport: { readonly name: string; close(): Promise<void> };
  readonly caps: DeviceCaps;
  readonly simulated?: boolean;
  readProfile(): Promise<Uint8Array>;
  writeProfile(p: Uint8Array): Promise<void>;
  readKeyMatrix(): Promise<Uint8Array>;
  writeKeyMatrix(m: Uint8Array): Promise<void>;
  readRgbTable(): Promise<Uint8Array>;
  writeRgbTable(t: Uint8Array): Promise<void>;
  writeLedMatrix(buf: Uint8Array): Promise<void>;
  writeMacroPages(pages: { sub: number; data: Uint8Array }[]): Promise<void>;
  /** Wired model id (6 bytes) or null. */
  checkModel(): Promise<Uint8Array | null>;
  readonly canStream: boolean;
  sendLiveFrame(rgb: Uint8Array): Promise<void>;
  readBattery?(): Promise<{ level: number; charging: boolean } | null>;
}
