import { describe, expect, it } from 'vitest';
import { MockMk75 } from '../protocol/mock';
import { Mk75 } from '../protocol/mk75';
import { buildContribution, dataIssueUrl } from './contribute';
import { logBytes } from './useDevice';

describe('contribute device data', () => {
  it('hides macro payloads in the log but keeps full bytes otherwise', () => {
    const macro = new Uint8Array(1031).fill(0x41);
    macro.set([0x05, 0xdc, 0, 0, 0, 0, 0]);
    const m = logBytes(macro, true);
    expect(m.hex).toBe('05dc0000000000');
    expect(m.text).toContain('macro data hidden (1031 B)');
    expect(m.text).not.toContain('41');

    const plain = logBytes(new Uint8Array(40).fill(0xab), false);
    expect(plain.hex).toHaveLength(80);
  });

  it('builds the file from the device, HID layout and log', () => {
    const dev = new Mk75(new MockMk75());
    const collections = [{ usagePage: 0xff00, usage: 1, featureReports: [{ reportId: 6, items: [{ reportSize: 8, reportCount: 1031 }] }] }];
    const hid = [{ vendorId: 0x258a, productId: 0x010c, productName: 'MK75', collections }] as unknown as HIDDevice[];
    const c = buildContribution({
      version: '0.1.0',
      userAgent: 'UA',
      dev,
      modelId: new Uint8Array([3, 0, 0, 0, 0, 0xc6]),
      snap: { profile: new Uint8Array([1, 2]), matrix: new Uint8Array([3]), rgbTable: new Uint8Array([4]) },
      hid,
      log: [{ t: 0, dir: 'out', text: '#06 …', hex: '06aa' }, { t: 0, dir: 'info', text: 'Connected' }],
      note: '  cable, Windows 11 ',
    });
    expect(c.connection).toMatchObject({ kind: 'wired', flavour: 'cdev916', simulated: true });
    expect(c.modelId).toBe('0300000000c6');
    expect(c.hid[0].collections).toEqual(collections);
    expect(c.snapshot).toEqual({ profile: '0102', keyMatrix: '03', rgbTable: '04' });
    expect(c.log[0].hex).toBe('06aa');
    expect('hex' in c.log[1]).toBe(false);
    expect(c.note).toBe('cable, Windows 11');
    expect(c.probe).toBeNull();
    expect(new URL(dataIssueUrl(c)).searchParams.get('template')).toBe('device_data.md');
  });
});
