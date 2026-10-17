// SPDX-License-Identifier: Apache-2.0
/** Hocuspocus frames: var-string address (document\0session), then var-uint type.
 * Guests use anonymized, scoped vault presence; raw editor awareness is hidden.
 */
export function hideGuestAwareness(input: unknown, guestDocuments: ReadonlySet<string>): boolean {
  if (!(input instanceof Uint8Array)) return false;
  let offset = 0;
  const read = () => {
    let value = 0; let shift = 0;
    while (offset < input.length && shift < 35) {
      const byte = input[offset++]; value += (byte & 127) * 2 ** shift;
      if (!(byte & 128)) return value;
      shift += 7;
    }
    throw new Error("invalid varint");
  };
  try {
    const length = read(); if (length > input.length - offset) return false;
    const address = new TextDecoder().decode(input.subarray(offset, offset + length)); offset += length;
    return read() === 1 && guestDocuments.has(address.split("\0")[0]);
  } catch { return false; }
}
