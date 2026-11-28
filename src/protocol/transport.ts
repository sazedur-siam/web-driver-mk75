/**
 * Raw HID feature-report transport.
 *
 * The vendor driver opens up to three HID top-level collections on usage page 0xFF00:
 *   - report 0x05: short command channel   (Windows handle "hCmd")
 *   - report 0x06: 1031-byte data channel  (Windows handle "hDev")
 *   - report 0x08: 381-byte stream channel (Windows handle "hMusic", unused here)
 * On WebHID these may surface as one HIDDevice or several (one per USB interface),
 * so we route each report ID to whichever opened device declares it.
 */
export interface FeatureTransport {
  /** Send a feature report. `data` excludes the report ID byte. */
  sendFeature(reportId: number, data: Uint8Array): Promise<void>;
  /** Read a feature report. Returned bytes exclude the report ID byte. */
  receiveFeature(reportId: number): Promise<Uint8Array>;
  /** Declared payload size (excluding report ID) of a feature report, if known. */
  featureSize(reportId: number): number | undefined;
  /** Listen for input reports on the opened vendor interfaces (diagnostics). Returns the unsubscribe function. */
  onInput?(cb: (reportId: number, data: Uint8Array) => void): () => void;
  readonly name: string;
  close(): Promise<void>;
}

export const MK75_USB = {
  vendorId: 0x258a,
  productId: 0x010c,
  /** 2.4 GHz dongle: uses a different (20-byte, checksummed) protocol that this port does not implement. */
  wirelessVendorId: 0x3554,
  wirelessProductId: 0xfa09,
  usagePage: 0xff00,
} as const;

function reportSizeBytes(report: HIDReportInfo): number {
  let bits = 0;
  for (const item of report.items ?? []) bits += (item.reportSize ?? 0) * (item.reportCount ?? 0);
  return Math.ceil(bits / 8);
}

export class WebHidTransport implements FeatureTransport {
  private routes = new Map<number, { dev: HIDDevice; size: number }>();

  private constructor(private devices: HIDDevice[]) {
    for (const dev of devices) {
      for (const col of dev.collections) {
        for (const rep of col.featureReports ?? []) {
          if (rep.reportId === undefined) continue;
          const size = reportSizeBytes(rep);
          if (!this.routes.has(rep.reportId)) this.routes.set(rep.reportId, { dev, size });
        }
      }
    }
  }

  get name(): string {
    return this.devices[0]?.productName || 'MK75';
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'hid' in navigator;
  }

  /** Prompt the user to pick the keyboard, then open every matching vendor interface. */
  static async request(): Promise<WebHidTransport> {
    if (!WebHidTransport.isSupported()) throw new Error('WebHID is not available. Use Chrome, Edge or Opera on desktop over HTTPS or localhost.');
    const picked = await navigator.hid.requestDevice({
      filters: [{ vendorId: MK75_USB.vendorId, productId: MK75_USB.productId, usagePage: MK75_USB.usagePage }],
    });
    if (picked.length === 0) throw new Error('No device selected.');
    return WebHidTransport.openDevices(picked);
  }

  /** Re-open previously granted devices without prompting (returns null if none). */
  static async reconnect(): Promise<WebHidTransport | null> {
    if (!WebHidTransport.isSupported()) return null;
    const granted = (await navigator.hid.getDevices()).filter(
      (d) => d.vendorId === MK75_USB.vendorId && d.productId === MK75_USB.productId,
    );
    return granted.length ? WebHidTransport.openDevices(granted) : null;
  }

  static async openDevices(candidates: HIDDevice[]): Promise<WebHidTransport> {
    // Chrome may only return the interface the user clicked; pull in sibling interfaces we already have permission for.
    const all = await navigator.hid.getDevices();
    const set = new Set<HIDDevice>(candidates);
    for (const d of all) if (d.vendorId === MK75_USB.vendorId && d.productId === MK75_USB.productId) set.add(d);
    const vendor = [...set].filter((d) => d.collections.some((c) => c.usagePage === MK75_USB.usagePage));
    for (const d of vendor) if (!d.opened) await d.open();
    const t = new WebHidTransport(vendor);
    // IC2481 boards (519-byte report 0x06) carry everything on 0x06; report 0x05 isn't used.
    for (const id of t.routes.get(0x06)?.size === 0x207 ? [0x06] : [0x05, 0x06]) {
      if (!t.routes.has(id)) {
        throw new Error(
          `The keyboard did not expose feature report 0x0${id}. Make sure it is connected by USB cable (not 2.4 GHz/Bluetooth) and in Windows mode (Fn+W).`,
        );
      }
    }
    return t;
  }

  featureSize(reportId: number): number | undefined {
    return this.routes.get(reportId)?.size;
  }

  async sendFeature(reportId: number, data: Uint8Array): Promise<void> {
    const route = this.routes.get(reportId);
    if (!route) throw new Error(`Feature report 0x${reportId.toString(16)} not available`);
    // Pad/truncate to the descriptor size; Windows rejects mismatched lengths.
    const out = new Uint8Array(route.size || data.length);
    out.set(data.subarray(0, out.length));
    await route.dev.sendFeatureReport(reportId, out);
  }

  async receiveFeature(reportId: number): Promise<Uint8Array> {
    const route = this.routes.get(reportId);
    if (!route) throw new Error(`Feature report 0x${reportId.toString(16)} not available`);
    const view = await route.dev.receiveFeatureReport(reportId);
    let bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    // Chrome prefixes the report ID on most platforms; strip it if present.
    if (bytes.length === route.size + 1 && bytes[0] === reportId) bytes = bytes.subarray(1);
    return new Uint8Array(bytes);
  }

  onInput(cb: (reportId: number, data: Uint8Array) => void): () => void {
    const h = (e: HIDInputReportEvent) => cb(e.reportId, new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
    for (const d of this.devices) d.addEventListener('inputreport', h);
    return () => {
      for (const d of this.devices) d.removeEventListener('inputreport', h);
    };
  }

  async close(): Promise<void> {
    for (const d of this.devices) if (d.opened) await d.close();
  }
}
