/**
 * MK75 2.4 GHz receiver / Bluetooth packet format (vendor classes CDevComboFilm / CDev3632,
 * emulated from the official LINGBAO driver). 20-byte output/input reports on usage page 0xFF02:
 *
 *   [reportId][cmd][total][index][(sub << 4) | len][14 data bytes][checksum]
 *   checksum = sum(bytes 0..18) & 0xFF   (includes the report ID)
 *
 * Output report ID: 0x15 ("Combo" receiver) or 0x13 (CDev3632). Replies echo `cmd`; bit 7 of
 * `total` = busy. WebHID passes the report ID separately, so `data` arrays here are 19 bytes.
 */
export const PKT_DATA = 14;
export const PKT_LEN = 19; // excluding report ID

export interface Packet {
  cmd: number;
  total: number;
  index: number;
  sub: number;
  len: number;
  data: Uint8Array; // up to 14 bytes
  busy: boolean;
}

export function checksum(reportId: number, body19: Uint8Array): number {
  let s = reportId;
  for (let i = 0; i < 18; i++) s += body19[i];
  return s & 0xff;
}

/** Build the 19 bytes after the report ID. */
export function buildPacket(reportId: number, cmd: number, total: number, index: number, sub: number, data: Uint8Array): Uint8Array {
  const b = new Uint8Array(PKT_LEN);
  b[0] = cmd;
  b[1] = total;
  b[2] = index;
  b[3] = ((sub & 0x0f) << 4) | (data.length & 0x0f);
  b.set(data.subarray(0, PKT_DATA), 4);
  b[18] = checksum(reportId, b);
  return b;
}

/** Split a payload into 14-byte packets. An empty payload is a single request packet. */
export function chunk(reportId: number, cmd: number, sub: number, payload: Uint8Array): Uint8Array[] {
  const total = Math.max(1, Math.ceil(payload.length / PKT_DATA));
  return Array.from({ length: total }, (_, i) => buildPacket(reportId, cmd, total, i, sub, payload.subarray(i * PKT_DATA, (i + 1) * PKT_DATA)));
}

/** Parse an input report body (bytes after the report ID). */
export function parsePacket(body: Uint8Array): Packet {
  return {
    cmd: body[0],
    total: body[1] & 0x7f,
    busy: (body[1] & 0x80) !== 0,
    index: body[2],
    sub: body[3] >> 4,
    len: Math.min(PKT_DATA, body[3] & 0x0f),
    data: body.slice(4, 4 + Math.min(PKT_DATA, body[3] & 0x0f)),
  };
}

export const WCmd = {
  SetMatrix: 0x01,
  GetMatrix: 0x41,
  SetColors: 0x02,
  GetColors: 0x42,
  SetMacro: 0x03,
  GetMacro: 0x43,
  SetLed: 0x04,
  GetLed: 0x44,
  Reset: 0x06, // CDev3632 only
  Online: 0x07,
  SetPalette: 0x09,
  GetPalette: 0x49,
  SetOnBoard: 0x0a,
  GetOnBoard: 0x4a, // CDev3632: battery
  Live: 0x88,
  LiveAlt: 0x8e,
} as const;
