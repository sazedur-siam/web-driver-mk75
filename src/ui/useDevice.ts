import { useCallback, useRef, useState } from 'react';
import { Mk75 } from '../protocol/mk75';
import { MockMk75 } from '../protocol/mock';
import { WebHidTransport, type FeatureTransport } from '../protocol/transport';

export interface LogLine {
  t: number;
  dir: 'out' | 'in' | 'info' | 'error';
  text: string;
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

export function useDevice() {
  const [dev, setDev] = useState<Mk75 | null>(null);
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

  const attach = useCallback(
    async (t: FeatureTransport) => {
      const d = new Mk75(t, { onFrame: (dir, id, data) => push({ dir, text: `#${id.toString(16).padStart(2, '0')} ${fmt(data)}` }) });
      push({ dir: 'info', text: `Connected: ${t.name}` });
      const id = await d.checkModel();
      setModelId(id);
      if (id && !(id[0] === 0x03 && id[5] === 0xc6)) push({ dir: 'error', text: 'Model id differs from the MK75 (03 00 00 00 00 C6)' });
      const profile = await d.readProfile();
      const matrix = await d.readKeyMatrix();
      const rgbTable = await d.readRgbTable();
      setDev(d);
      setSnap({ profile, matrix, rgbTable });
    },
    [push],
  );

  const connect = useCallback(() => run('Connecting', async () => attach(await WebHidTransport.request())), [run, attach]);
  const connectDemo = useCallback(() => run('Starting simulator', async () => attach(new MockMk75())), [run, attach]);

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

  return { dev, modelId, snap, setSnap, busy, error, setError, log, push, run, connect, connectDemo, disconnect, refresh, isDemo: dev?.transport instanceof MockMk75 };
}

export type DeviceApi = ReturnType<typeof useDevice>;
