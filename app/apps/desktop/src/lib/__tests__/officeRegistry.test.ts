// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc", () => ({
  getVaultConfig: vi.fn(async () => null),
  setVaultConfig: vi.fn(async () => {}),
  listTree: vi.fn(async () => ({
    id: "root",
    name: "",
    path: "",
    isDir: true,
    children: [],
    childrenLoaded: true,
  })),
  listTags: vi.fn(async () => []),
  listNoteTitles: vi.fn(async () => []),
  writeNote: vi.fn(async () => {}),
  writeNoteIfMissing: vi.fn(async () => true),
}));
vi.mock("../vault/seed", () => ({ seedWelcomeContent: vi.fn(async () => {}) }));

import type { ApiClient } from "../api";
import * as ipc from "../ipc";
import { VaultRegistry } from "../sync/registry";

const ORG = "org-1";
const VAULT = { id: "vault-1", name: "V", organization_id: ORG };

function fakeApi() {
  return {
    listVaults: vi.fn(async () => [VAULT]),
    createVault: vi.fn(async () => VAULT),
    listFolders: vi.fn(async () => []),
    listFolderRegistry: vi.fn(async () => ({ folders: [], tombstones: [] })),
    createFolder: vi.fn(async (input: { path: string }) => ({ id: `folder-${input.path}` })),
    listNotes: vi.fn(async () => []),
    listNoteRegistry: vi.fn(async () => ({ notes: [], tombstones: [] as string[] })),
    // The paged twin the reconciler actually calls; identical answer.
    listNoteRegistryPaged: vi.fn(async () => ({ notes: [], tombstones: [] as string[] })),
    createNote: vi.fn(async (input: { relPath: string }) => ({
      id: `note-${input.relPath}`,
      rel_path: input.relPath,
    })),
  } as unknown as ApiClient;
}


import { seedWelcomeContent } from "../vault/seed";
beforeEach(() => { vi.clearAllMocks(); vi.mocked(ipc.getVaultConfig).mockResolvedValue(null); });
describe("explicit office vault selection", () => {
  it("selects the requested collection rather than the first collection in the organization", async () => {
    const api = fakeApi();
    vi.mocked(api.listVaults).mockResolvedValue([VAULT, { ...VAULT, id: "selected" }]);
    const registry = new VaultRegistry(api);
    await registry.reconcile({ organizationId: ORG, vaultName: "V", selectedVaultId: "selected" });
    expect(registry.vaultId).toBe("selected");
    expect(api.createVault).not.toHaveBeenCalled();
    expect(seedWelcomeContent).not.toHaveBeenCalled();
  });
  it.each([{ listing: [] }, { listing: [{ ...VAULT, id: "other" }] }])("refuses empty/incomplete access listings without creating or seeding", async ({ listing }) => {
    const api = fakeApi(); vi.mocked(api.listVaults).mockResolvedValue(listing);
    const registry = new VaultRegistry(api);
    await expect(registry.reconcile({ organizationId: ORG, vaultName: "V", selectedVaultId: "selected" })).rejects.toThrow("office:permission_missing");
    expect(api.createVault).not.toHaveBeenCalled(); expect(api.createNote).not.toHaveBeenCalled();
    expect(ipc.setVaultConfig).not.toHaveBeenCalled(); expect(ipc.writeNote).not.toHaveBeenCalled(); expect(seedWelcomeContent).not.toHaveBeenCalled();
  });
  it("does not prime or reconcile a folder stamped for a different collection in the same organization", async () => {
    vi.mocked(ipc.getVaultConfig).mockResolvedValue(JSON.stringify({ organizationId: ORG, serverVaultId: "different", docs: { "private.md": "doc-private" } }));
    const api = fakeApi(); const registry = new VaultRegistry(api);
    expect(await registry.primeLocal(ORG, VAULT.id)).toBe(false);
    await expect(registry.reconcile({ organizationId: ORG, vaultName: "V", selectedVaultId: VAULT.id })).rejects.toThrow("office:permission_missing");
    expect(api.createNote).not.toHaveBeenCalled(); expect(ipc.setVaultConfig).not.toHaveBeenCalled();
  });
});
