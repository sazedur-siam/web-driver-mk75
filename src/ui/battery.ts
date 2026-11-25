import { useEffect, useState } from 'react';
import type { Mk75Device } from '../protocol/device';

export type Battery = { level: number; charging: boolean };

const POLL_MS = 5 * 60_000;
export const ALERT_LEVELS = [20, 10];

/** Lowest alert level already notified after this read (null = none). Each level fires once; charging re-arms. */
export function nextAlerted(level: number, charging: boolean, alerted: number | null): number | null {
  if (charging) return null;
  const crossed = ALERT_LEVELS.filter((t) => level < t);
  const t = crossed.length ? Math.min(...crossed) : null;
  return t !== null && (alerted === null || t < alerted) ? t : alerted;
}

/** Polls the keyboard battery while connected (receivers with `caps.battery`) and notifies when it runs low. */
export function useBattery(dev: Mk75Device | null): Battery | null {
  const [battery, setBattery] = useState<Battery | null>(null);
  useEffect(() => {
    setBattery(null);
    if (!dev?.caps.battery || !dev.readBattery) return;
    let alerted: number | null = null;
    let stopped = false;
    const poll = async () => {
      const b = await dev.readBattery!().catch(() => null);
      if (stopped || !b) return; // keep the last value on a failed read
      setBattery(b);
      const next = nextAlerted(b.level, b.charging, alerted);
      if (next !== null && next !== alerted && 'Notification' in window && Notification.permission === 'granted')
        new Notification('MK75 battery low', { body: `Keyboard battery is at ${b.level}%. Plug in the cable to charge.`, icon: 'icon-192.png' });
      alerted = next;
    };
    void poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [dev]);
  return battery;
}
