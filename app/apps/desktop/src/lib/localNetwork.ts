// SPDX-License-Identifier: Apache-2.0
/**
 * Hosts plain `http` may reach: this computer, and the local network (private
 * IPv4 ranges, IPv6 unique-local and link-local, `.local` mDNS names). Lets a
 * team run a server on one machine and join it over the same Wi-Fi. Anything
 * on the public internet must be https: over plain http there a session token
 * would cross networks in the clear.
 */
export function isLocalNetworkHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local")) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}
