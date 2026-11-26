import { useCallback, useRef, useState } from 'react';
import { MK75_KEYS } from '../device/mk75Layout';
import { MK75_FILTERS, openMk75, requestMk75 } from '../protocol/connect';
import type { Mk75Device } from '../protocol/device';
import { MockMk75 } from '../protocol/mock';
import { Mk75 } from '../protocol/mk75';
import { WirelessLink } from '../protocol/wireless/link';
import { MockWirelessIO } from '../protocol/wireless/mockWireless';
import { Mk75Wireless } from '../protocol/wireless/mk75Wireless';
import { toHex } from './profileStore';

export interface LogLine {
  t: number;
  dir: 'out' | 'in' | 'info' | 'error';
  text: string;
  /** Full packet bytes (hex) for the device-data contribution; the text above shows only 16. */
  hex?: string;
}

export interface DeviceSnapshot {
  profile: Uint8Array;
  matrix: Uint8Array;
  rgbTable: Uint8Array;
}

const fmt = (d: Uint8Array) => {
  const head = [...d.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  return `${head}${d.length > 16 ? ' …' : ''} (${d.length} B)`;
};

/**
 * Macro writes can hold typed text (passwords), so logs keep only their 7-byte header:
 * wired report 0x06 op 0x05/0x85, wireless cmd 0x03/0x43.
 */
export function logBytes(d: Uint8Array, macro: boolean): Pick<LogLine, 'text' | 'hex'> {
  const shown = macro ? d.slice(0, 7) : d;
  return { text: macro ? `${fmt(shown).replace(/ \(\d+ B\)$/, '')} … macro data hidden (${d.length} B)` : fmt(d), hex: toHex(shown) };
}
const isWiredMacro = (id: number, d: Uint8Array) => id === 0x06 && (d[0] & 0x7f) === 0x05;
const isWirelessMacro = (d: Uint8Array) => (d[0] & 0xbf) === 0x03;

export function useDevice() {
  const [dev, setDev] = useState<Mk75Device | null>(null);
  const [modelId, setModelId] = useState<Uint8Array | null>(null);
  const [snap, setSnap] = useState<DeviceSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const logRef = useRef<LogLine[]>([]);

  const push = useCallback((l: Omit<LogLine, 't'>) => {
    logRef.current = [...logRef.current.slice(-400), { ...l, t: Date.now() }];
    setLog(logRef.current);
  }, []);

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      setBusy(label);
      setError(null);
      try {
        return await fn();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        push({ dir: 'error', text: `${label}: ${msg}` });
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [push],
  );

  const wiredLog = useCallback(
    (dir: 'out' | 'in', id: number, data: Uint8Array) => {
      const b = logBytes(data, isWiredMacro(id, data));
      push({ dir, text: `#${id.toString(16).padStart(2, '0')} ${b.text}`, hex: `${id.toString(16).padStart(2, '0')}${b.hex}` });
    },
    [push],
  );
  const wirelessLog = useCallback(
    (dir: 'out' | 'in', body: Uint8Array) => {
      const b = logBytes(body, isWirelessMacro(body));
      push({ dir, text: `2.4G ${b.text}`, hex: b.hex });
    },
    [push],
  );

  const attach = useCallback(
    async (d: Mk75Device) => {
      push({ dir: 'info', text: `Connected: ${d.transport.name} (${d.kind === 'wired' ? 'USB cable' : '2.4 GHz / Bluetooth'})` });
      const id = await d.checkModel();
      setModelId(id);
      if (id && !(id[0] === 0x03 && id[5] === 0xc6)) push({ dir: 'error', text: 'Model id differs from the MK75 (03 00 00 00 00 C6)' });
      const profile = await d.readProfile();
      const matrix = await d.readKeyMatrix();
      const rgbTable = await d.readRgbTable();
      setDev(d);
      setSnap({ profile, matrix, rgbTable });
      // Dev-only test hook (stripped from production builds).
      if (import.meta.env.DEV) (window as unknown as { __mk75?: unknown }).__mk75 = { dev: d };
    },
    [push],
  );

  const connect = useCallback(
    () => run('Connecting', async () => attach(await requestMk75({ onFrame: wiredLog, onWireless: wirelessLog }))),
    [run, attach, wiredLog, wirelessLog],
  );

  /** Previously granted MK75 devices (no permission prompt needed to reopen). */
  const grantedDevices = useCallback(async (): Promise<HIDDevice[]> => {
    if (typeof navigator === 'undefined' || !('hid' in navigator)) return [];
    const all = await navigator.hid.getDevices();
    return all.filter((d) =>
      MK75_FILTERS.some(
        (f) =>
          (f.vendorId === undefined || f.vendorId === d.vendorId) &&
          (f.productId === undefined || f.productId === d.productId) &&
          (f.usagePage === undefined || d.collections.some((c) => c.usagePage === f.usagePage && (f.usage === undefined || c.usage === f.usage))),
      ),
    );
  }, []);

  const reconnect = useCallback(
    () =>
      run('Reconnecting', async () => {
        const granted = await grantedDevices();
        if (!granted.length) throw new Error('No previously connected MK75 found. Use Connect keyboard.');
        return attach(await openMk75(granted, { onFrame: wiredLog, onWireless: wirelessLog }));
      }),
    [run, attach, grantedDevices, wiredLog, wirelessLog],
  );

  const connectDemo = useCallback(
    (mode: 'wired' | 'wireless' = 'wired') =>
      run('Starting simulator', async () => {
        if (mode === 'wired') return attach(new Mk75(new MockMk75(), { onFrame: wiredLog }));
        const w = new Mk75Wireless(new WirelessLink(new MockWirelessIO(), 0x13, wirelessLog, { pace: 2, livePace: 1, ackMs: 800, readMs: 800 }), '3632');
        w.setLiveLeds(MK75_KEYS.map((k) => k.index));
        return attach(w);
      }),
    [run, attach, wiredLog, wirelessLog],
  );

  const disconnect = useCallback(async () => {
    await dev?.transport.close();
    setDev(null);
    setSnap(null);
    push({ dir: 'info', text: 'Disconnected' });
  }, [dev, push]);

  const refresh = useCallback(
    () =>
      run('Reading device', async () => {
        if (!dev) return;
        setSnap({ profile: await dev.readProfile(), matrix: await dev.readKeyMatrix(), rgbTable: await dev.readRgbTable() });
      }),
    [dev, run],
  );

  return { dev, modelId, snap, setSnap, busy, error, setError, log, push, run, connect, connectDemo, reconnect, grantedDevices, disconnect, refresh, isDemo: !!dev?.simulated };
}

export type DeviceApi = ReturnType<typeof useDevice>;
