/** WebHID output/input-report IO for the MK75 wireless vendor collection (usage page 0xFF02, usage 0x02). */
import type { ReportIO } from './link';

export const WIRELESS_USAGE = { usagePage: 0xff02, usage: 0x02 } as const;

/** Report IDs the official driver accepts: 0x15 = "Combo" receiver framing, 0x13 = CDev3632 framing. */
export function findWirelessInterface(devices: HIDDevice[]): { dev: HIDDevice; reportId: number; size: number } | null {
  for (const dev of devices) {
    for (const col of dev.collections) {
      if (col.usagePage !== WIRELESS_USAGE.usagePage || col.usage !== WIRELESS_USAGE.usage) continue;
      for (const rep of col.outputReports ?? []) {
        if (rep.reportId === 0x15 || rep.reportId === 0x13) {
          let bits = 0;
          for (const it of rep.items ?? []) bits += (it.reportSize ?? 0) * (it.reportCount ?? 0);
          return { dev, reportId: rep.reportId, size: Math.ceil(bits / 8) || 19 };
        }
      }
    }
  }
  return null;
}

export class WebHidReportIO implements ReportIO {
  constructor(
    private dev: HIDDevice,
    private size: number,
  ) {}

  get name() {
    return this.dev.productName || 'MK75 (wireless)';
  }

  async send(reportId: number, body: Uint8Array) {
    const out = new Uint8Array(this.size);
    out.set(body.subarray(0, this.size));
    await this.dev.sendReport(reportId, out);
  }

  onInput(cb: (reportId: number, body: Uint8Array) => void) {
    const h = (e: HIDInputReportEvent) => cb(e.reportId, new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength));
    this.dev.addEventListener('inputreport', h);
    return () => this.dev.removeEventListener('inputreport', h);
  }

  async close() {
    if (this.dev.opened) await this.dev.close();
  }
}
