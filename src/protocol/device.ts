import type { MacroFormat } from './macro';

/**
 * What the UI talks to. Both the wired protocol (Mk75) and the 2.4 GHz / Bluetooth protocol
 * (Mk75Wireless) expose the *wired* data formats (254-byte profile, 1024-byte key matrix,
 * RGB table, per-key planes); the wireless class translates to and from its own layouts.
 */
export interface DeviceCaps {
  /** Macro storage format: 'slots' = CDev916KB 128-byte slots, 'store' = layout B store, false = none. */
  macros: false | MacroFormat;
  /** Effects can use any of the 7 palette colours (wireless always uses colour 1 or colourful). */
  paletteIndex: boolean;
  /** Battery level can be read. */
  battery: boolean;
}

/** Config-block settings the wired 254-byte profile has no field for (layout B boards only). */
export interface KeyboardSettings {
  /** Debounce level 0..4 (layout B byte 0x03; the official app shows level + 1). */
  debounce: number;
  /** Knob mode (byte 0x1A): 0 = media (volume), 1 = lighting (brightness / effect). */
  knob: number;
}

/**
 * The side light bars (layout B config block; found with the side-light probe on a real IC2481 MK75, 2026-11-28).
 * Brightness and speed (Fn + Right Alt / Right Ctrl) aren't stored in any readable block, so they stay keyboard-only.
 */
export interface SideLights {
  /** Byte 0x12: 0 off, 1 flow, 2 neon, 3 steady, 4 breathe (the Fn + Right Shift cycle). */
  mode: number;
  /** Byte 0x13: firmware colour 0..6 (Fn + /); shows in steady and breathe. */
  colour: number;
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
  /** Throws if writeKeyMatrix(m) would; call it before writing macro pages (layout B boards only). */
  checkKeyMatrix?(m: Uint8Array): Promise<void>;
  readRgbTable(): Promise<Uint8Array>;
  writeRgbTable(t: Uint8Array): Promise<void>;
  writeLedMatrix(buf: Uint8Array): Promise<void>;
  writeMacroPages(pages: { sub: number; data: Uint8Array }[]): Promise<void>;
  /** Wired model id (6 bytes) or null. */
  checkModel(): Promise<Uint8Array | null>;
  readonly canStream: boolean;
  sendLiveFrame(rgb: Uint8Array): Promise<void>;
  readBattery?(): Promise<{ level: number; charging: boolean } | null>;
  readSettings?(): Promise<KeyboardSettings>;
  /** Keymap layer 1 (Fn held), wired view like readKeyMatrix. Layout B boards only. */
  readFnLayer?(): Promise<Uint8Array>;
  writeFnLayer?(m: Uint8Array): Promise<void>;
  writeSettings?(s: Partial<KeyboardSettings>): Promise<void>;
  /** Side light bars (layout B boards only). Writes change only the given fields' bytes. */
  readSideLights?(): Promise<SideLights>;
  writeSideLights?(s: Partial<SideLights>): Promise<void>;
  /**
   * Every readable layout B block, raw, as the keyboard holds it: `led` (128-byte config: LED profile, debounce,
   * knob ...), `palette`, `keymap 0`..`keymap 3`. Read-only, for diagnostics such as the side-light probe.
   */
  readRawBlocks?(): Promise<Record<string, Uint8Array>>;
  /**
   * Input reports the keyboard sends unasked on its vendor interface (diagnostics). Returns the unsubscribe
   * function, or null where the connection can't tell them apart from protocol replies (2.4 GHz, Bluetooth).
   */
  onRawInput?(cb: (reportId: number, data: Uint8Array) => void): (() => void) | null;
}
