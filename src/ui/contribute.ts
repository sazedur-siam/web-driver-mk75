/**
 * "Contribute device data": one JSON file with what the app can see of the keyboard, for reverse-engineering
 * new firmware variants and connection modes. What it holds (and doesn't) is documented in DEVICE_DATA.md.
 */
import type { Mk75Device } from '../protocol/device';
import { toHex } from './profileStore';
import { ISSUES_URL } from './report';
import { probeForFile, type ProbeRead } from './sideLightProbe';
import type { DeviceSnapshot, LogLine } from './useDevice';

export const DATA_DOC_URL = 'https://github.com/sazedur-siam/web-driver-mk75/blob/main/DEVICE_DATA.md';

export const dataIssueUrl = (c: DeviceData) =>
  `${ISSUES_URL}/new?${new URLSearchParams({ template: 'device_data.md', title: `Device data: ${c.connection.kind} · ${c.connection.flavour}` })}`;

export interface ContributionInput {
  version: string;
  userAgent: string;
  dev: Mk75Device;
  modelId: Uint8Array | null;
  snap: DeviceSnapshot | null;
  /** Every HID interface the user granted for the MK75 (cable, receiver, Bluetooth). */
  hid: HIDDevice[];
  log: LogLine[];
  note: string;
  /** Side-light probe reads (PROTOCOL.md, layout B side light bars), if the user ran it. */
  probe?: ProbeRead[];
}

export type DeviceData = ReturnType<typeof buildContribution>;

export function buildContribution(i: ContributionInput) {
  return {
    format: 'mk75-device-data' as const,
    version: 1,
    created: new Date().toISOString(),
    app: i.version,
    browser: i.userAgent,
    connection: {
      kind: i.dev.kind,
      transport: i.dev.transport.name,
      // Mk75Wireless names its framing; the classic wired class (CDev916KB) has none.
      flavour: (i.dev as { flavour?: string }).flavour ?? 'cdev916',
      caps: i.dev.caps,
      simulated: !!i.dev.simulated,
    },
    modelId: i.modelId ? toHex(i.modelId) : null,
    // HIDCollectionInfo is a plain WebIDL dictionary: usage pages, report IDs and item sizes (the parsed descriptor).
    hid: i.hid.map((d) => ({
      vendorId: d.vendorId,
      productId: d.productId,
      productName: d.productName,
      collections: JSON.parse(JSON.stringify(d.collections)) as unknown,
    })),
    snapshot: i.snap ? { profile: toHex(i.snap.profile), keyMatrix: toHex(i.snap.matrix), rgbTable: toHex(i.snap.rgbTable) } : null,
    log: i.log.map((l) => ({ t: new Date(l.t).toISOString(), dir: l.dir, text: l.text, ...(l.hex ? { hex: l.hex } : {}) })),
    note: i.note.trim(),
    probe: i.probe?.length ? probeForFile(i.probe) : null,
  };
}

export function downloadContribution(c: DeviceData) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(c, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `mk75-device-data-${c.connection.kind}-${c.connection.flavour}-${c.created.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
