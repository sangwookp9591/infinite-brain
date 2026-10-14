import { afterEach, describe, expect, it, vi } from "vitest";
import { ignoreStorageKey, readIgnores, sanitize, withKey, writeIgnores } from "../ignore";

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("withKey", () => {
  it("adds once and removes cleanly, keeping order", () => {
    expect(withKey(["a"], "b", true)).toEqual(["a", "b"]);
    expect(withKey(["a", "b"], "b", true)).toEqual(["a", "b"]);
    expect(withKey(["a", "b"], "a", false)).toEqual(["b"]);
    expect(withKey(["a"], "zzz", false)).toEqual(["a"]);
  });
});

describe("readIgnores / writeIgnores", () => {
  it("is empty with no vault, no entry, or unreadable storage", () => {
    stubStorage();
    expect(readIgnores(null)).toEqual({ checks: [], issues: [] });
    expect(readIgnores("/v")).toEqual({ checks: [], issues: [] });
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readIgnores("/v")).toEqual({ checks: [], issues: [] });
  });

  it("round-trips per vault and removes the entry when both lists empty", () => {
    const store = stubStorage();
    writeIgnores("/a", { checks: ["broken-links"], issues: ["doc-1"] });
    writeIgnores("/b", { checks: [], issues: ["doc-9"] });
    expect(readIgnores("/a")).toEqual({ checks: ["broken-links"], issues: ["doc-1"] });
    expect(readIgnores("/b")).toEqual({ checks: [], issues: ["doc-9"] });
    writeIgnores("/a", { checks: [], issues: [] });
    expect(store.has(ignoreStorageKey("/a"))).toBe(false);
    expect(readIgnores("/b").issues).toEqual(["doc-9"]);
  });

  it("treats a corrupted entry as nothing ignored", () => {
    stubStorage({ [ignoreStorageKey("/v")]: "{not json" });
    expect(readIgnores("/v")).toEqual({ checks: [], issues: [] });
    stubStorage({ [ignoreStorageKey("/v")]: JSON.stringify({ checks: "x", issues: [1, "ok"] }) });
    expect(readIgnores("/v")).toEqual({ checks: [], issues: ["ok"] });
  });
});

describe("sanitize", () => {
  it("keeps only string arrays", () => {
    expect(sanitize(null)).toEqual({ checks: [], issues: [] });
    expect(sanitize(42)).toEqual({ checks: [], issues: [] });
    expect(sanitize({ checks: ["trash", 3], issues: {} })).toEqual({
      checks: ["trash"],
      issues: [],
    });
  });
});
