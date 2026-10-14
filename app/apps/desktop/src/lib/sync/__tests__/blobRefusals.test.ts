import { describe, expect, it, vi } from "vitest";
import { AttachmentSync, type AttachmentSyncDeps } from "../attachments";
import { createRefusalStore, REFUSAL_TTL_MS } from "../blobRefusals";

function serverError(status: number, code?: string) {
  return Object.assign(new Error(code ?? `HTTP ${status}`), { status, code });
}

const sha = (n: number) => n.toString(16).padStart(64, "0");

/** A minimal intent-speaking vault: `files` are `attachments/` drops so no
 *  registry deps are involved, `respond` decides each intent. */
function makeSync(
  files: Array<{ relPath: string; sha256: string }>,
  respond: (relPath: string) => unknown,
  extra: Partial<AttachmentSyncDeps> = {},
) {
  const intents: string[] = [];
  const deps: AttachmentSyncDeps = {
    listLocal: async () => files.map((f) => ({ ...f, size: 10 })),
    readLocal: async () => new Uint8Array(10),
    writeLocal: async () => {},
    listServer: async () => [],
    uploadServer: async () => {},
    downloadServer: async () => new Uint8Array(),
    createIntent: async (input) => {
      intents.push(input.relPath);
      const r = respond(input.relPath);
      if (r instanceof Error) throw r;
      return r as never;
    },
    ...extra,
  } as AttachmentSyncDeps;
  return { sync: new AttachmentSync(deps, 0), intents };
}

describe("blob refusals outlive one AttachmentSync instance", () => {
  for (const [status, code] of [
    [413, "attachment_too_large"],
    [400, "invalid_size"],
    [400, "invalid_register"],
  ] as const) {
    it(`a ${status} ${code} intent is not re-asked by the next session`, async () => {
      const refusals = createRefusalStore();
      const files = [{ relPath: "attachments/huge.mp4", sha256: sha(1) }];
      const a = makeSync(files, () => serverError(status, code), { refusals });
      await a.sync.reconcile();
      await a.sync.reconcile();
      expect(a.intents).toEqual(["attachments/huge.mp4"]);

      // A fresh instance (next launch / session start) shares the store.
      const b = makeSync(files, () => serverError(status, code), { refusals });
      await b.sync.reconcile();
      expect(b.intents).toEqual([]);
    });
  }

  it("changed bytes (a new sha) are asked again at once", async () => {
    const refusals = createRefusalStore();
    const a = makeSync([{ relPath: "attachments/huge.mp4", sha256: sha(1) }], () =>
      serverError(413, "attachment_too_large"),
    { refusals });
    await a.sync.reconcile();
    const b = makeSync([{ relPath: "attachments/huge.mp4", sha256: sha(2) }], () =>
      serverError(413, "attachment_too_large"),
    { refusals });
    await b.sync.reconcile();
    expect(b.intents).toEqual(["attachments/huge.mp4"]);
  });

  it("a 403 on a tree file stays a session-only skip (access can change)", async () => {
    const refusals = createRefusalStore();
    const files = [{ relPath: "Team/a.pdf", sha256: sha(3) }];
    const a = makeSync(files, () => serverError(403, "no_write_access"), { refusals });
    await a.sync.reconcile();
    await a.sync.reconcile();
    expect(a.intents).toEqual(["Team/a.pdf"]);
    const b = makeSync(files, () => serverError(403, "no_write_access"), { refusals });
    await b.sync.reconcile();
    expect(b.intents).toEqual(["Team/a.pdf"]);
  });

  it("a 413 from the byte route itself (legacy upload) is skipped from then on", async () => {
    const refusals = createRefusalStore();
    const uploadServer = vi.fn(async () => {
      throw serverError(413);
    });
    const files = [{ relPath: "attachments/huge.mp4", sha256: sha(4) }];
    const a = makeSync(files, () => null, { refusals, createIntent: undefined, uploadServer });
    await a.sync.reconcile();
    await a.sync.reconcile();
    expect(uploadServer).toHaveBeenCalledTimes(1);
  });
});

describe("createRefusalStore", () => {
  it("expires entries after the TTL and persists through its backing", () => {
    let t = 1000;
    let saved: Record<string, number> | null = null;
    const backing = { load: () => saved, save: (e: Record<string, number>) => (saved = e) };
    const s = createRefusalStore(backing, () => t);
    s.add("bytes:x");
    expect(s.has("bytes:x")).toBe(true);
    // A new store over the same backing (next launch) still knows it.
    expect(createRefusalStore(backing, () => t).has("bytes:x")).toBe(true);
    t += REFUSAL_TTL_MS + 1;
    expect(s.has("bytes:x")).toBe(false);
  });

  it("deletePrefix forgets only matching keys", () => {
    const s = createRefusalStore();
    s.add("text:a");
    s.add("bytes:b");
    s.deletePrefix("text:");
    expect(s.has("text:a")).toBe(false);
    expect(s.has("bytes:b")).toBe(true);
  });
});
