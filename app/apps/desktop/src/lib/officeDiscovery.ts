// SPDX-License-Identifier: Apache-2.0
import * as ipc from "./ipc";

export type UntrustedOfficeCandidate = ipc.OfficeDiscoveryCandidate;
export type OfficeDiscoveryView = ipc.OfficeDiscoverySnapshot;

/** Call only from a user-opened discovery screen; close on unmount. Native code
 * owns the network deadline and candidate validation. Polls never start a scan.
 * Discovery grants no trust: a new workspace still needs an invite or SAS. */
export function openOfficeDiscovery(
  onSnapshot: (snapshot: OfficeDiscoveryView) => void,
  onError: (error: unknown) => void = () => {},
): { close(): Promise<void> } {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let scanId: string | undefined;
  const started = ipc.officeDiscoveryStart();
  async function poll() {
    if (closed || !scanId) return;
    try {
      const snapshot = await ipc.officeDiscoverySnapshot(scanId);
      if (closed) return;
      onSnapshot(snapshot);
      // Continue reading expiration/removal state while the screen stays open.
      // Native sockets are closed after eight seconds; this only reads memory.
      timer = setTimeout(() => { void poll(); }, snapshot.searching ? 250 : 1_000);
    } catch (error) {
      if (!closed) onError(error);
    }
  }
  void started.then(async (id) => {
    scanId = id;
    if (closed) { await ipc.officeDiscoveryStop(id); return; }
    await poll();
  }).catch((error: unknown) => { if (!closed) onError(error); });
  return {
    async close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      // The start handler stops a scan that resolves after close.
      if (scanId) await ipc.officeDiscoveryStop(scanId);
    },
  };
}

/** Explicitly selected candidates can reconnect using an existing native pin.
 * An approval-required response must open the separate invite/SAS flow. Never
 * derive a pin or automatically approve a workspace from discovery metadata. */
export const openDiscoveredOffice = (candidate: UntrustedOfficeCandidate): Promise<ipc.OfficeLinkEndpoint> =>
  ipc.officeDiscoveryOpen(candidate.candidateId);

/** Call only after explicit consent to publish this display label. */
export const advertiseOffice = (displayName: string | null): Promise<void> =>
  ipc.officeDiscoveryAdvertise(displayName);
