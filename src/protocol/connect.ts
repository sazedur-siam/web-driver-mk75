/**
 * One "Connect" for every MK75 mode: USB cable (feature reports 0x05/0x06 on page 0xFF00),
 * 2.4 GHz receiver 3554:FA09 or Bluetooth (20-byte reports on page 0xFF02).
 */
import { MK75_KEYS } from '../device/mk75Layout';
import type { Mk75Device } from './device';
import { G5_FRAME_LEN, G5_REPORT, Mk75G5Wired } from './g5Wired';
import { Mk75, type Mk75Options } from './mk75';
import { MK75_USB, WebHidTransport } from './transport';
import { WirelessLink } from './wireless/link';
import { Mk75Wireless } from './wireless/mk75Wireless';
import { findWirelessInterface, WebHidReportIO, WIRELESS_USAGE } from './wireless/webhid';

export const MK75_FILTERS: HIDDeviceFilter[] = [
  { vendorId: MK75_USB.vendorId, productId: MK75_USB.productId, usagePage: MK75_USB.usagePage },
  { vendorId: MK75_USB.wirelessVendorId, productId: MK75_USB.wirelessProductId },
  // Bluetooth ("MK75-5.0" / "MK75-3.0") may enumerate with other IDs; match the vendor collection.
  { usagePage: WIRELESS_USAGE.usagePage, usage: WIRELESS_USAGE.usage },
];

const hasWired = (d: HIDDevice) =>
  d.collections.some((c) => c.usagePage === MK75_USB.usagePage && (c.featureReports ?? []).some((r) => r.reportId === 0x06));

export interface ConnectOptions extends Mk75Options {
  onWireless?: (dir: 'out' | 'in', body: Uint8Array) => void;
}

export async function openMk75(picked: HIDDevice[], opts: ConnectOptions = {}): Promise<Mk75Device> {
  if (picked.some(hasWired)) {
    const t = await WebHidTransport.openDevices(picked);
    // Same VID/PID, two firmware families: tell them apart by the size of report 0x06.
    return t.featureSize(G5_REPORT) === G5_FRAME_LEN ? new Mk75G5Wired(t, opts) : new Mk75(t, opts);
  }
  const all = [...new Set([...picked, ...(await navigator.hid.getDevices())])];
  const wl = findWirelessInterface(picked) ?? findWirelessInterface(all);
  if (!wl) {
    throw new Error('This device does not expose the MK75 configuration interface. Use the USB cable (switch in the middle position), the 2.4 GHz receiver, or Bluetooth.');
  }
  if (!wl.dev.opened) await wl.dev.open();
  const link = new WirelessLink(new WebHidReportIO(wl.dev, wl.size), wl.reportId, opts.onWireless);
  const dev = new Mk75Wireless(link, wl.reportId === 0x15 ? 'combo' : '3632');
  dev.setLiveLeds(MK75_KEYS.map((k) => k.index));
  if (!(await dev.online().catch(() => true))) {
    throw new Error('The receiver is connected but the keyboard is not. Wake it with a key press, or pair it (switch to 2.4G, hold Fn+` for 3 s).');
  }
  return dev;
}

export async function requestMk75(opts: ConnectOptions = {}): Promise<Mk75Device> {
  if (!WebHidTransport.isSupported()) throw new Error('WebHID is not available. Use Chrome, Edge or Opera on desktop over HTTPS or localhost.');
  const picked = await navigator.hid.requestDevice({ filters: MK75_FILTERS });
  if (picked.length === 0) throw new Error('No device selected.');
  return openMk75(picked, opts);
}
