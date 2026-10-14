// "Remember email address" (#120): the switch, the address, and the rule that
// decides what the sign-in field opens with.
//
// `rememberedEmail` reads `localStorage` at call time, never at import time, so
// a plain object stub on `globalThis` is enough in the node environment (same
// shape as `prefs.test.ts`).
import { afterEach, describe, expect, it } from "vitest";
import {
  initialEmail,
  readRememberEmail,
  readRememberedEmail,
  REMEMBER_EMAIL_KEY,
  REMEMBERED_EMAIL_KEY,
  rememberEmailAddress,
  writeRememberEmail,
} from "../rememberedEmail";

/** The three methods this module uses, over a plain map. */
function stubStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map(Object.entries(initial));
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

/** A device with storage denied: every access throws. */
function stubThrowingStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("localStorage is not available");
    },
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("the switch", () => {
  it("is off on a device that has never answered", () => {
    stubStorage();
    expect(readRememberEmail()).toBe(false);
  });

  it("is on once ticked, and survives a reload", () => {
    const store = stubStorage();
    writeRememberEmail(true);
    expect(store.get(REMEMBER_EMAIL_KEY)).toBe("on");
    expect(readRememberEmail()).toBe(true);
  });

  it("forgets the address the moment it is unticked", () => {
    const store = stubStorage({
      [REMEMBER_EMAIL_KEY]: "on",
      [REMEMBERED_EMAIL_KEY]: "ada@example.com",
    });
    writeRememberEmail(false);
    expect(store.has(REMEMBER_EMAIL_KEY)).toBe(false);
    expect(store.has(REMEMBERED_EMAIL_KEY)).toBe(false);
    expect(readRememberedEmail()).toBe("");
  });
});

describe("the address", () => {
  it("is stored at a successful sign-in while the switch is on", () => {
    const store = stubStorage({ [REMEMBER_EMAIL_KEY]: "on" });
    rememberEmailAddress("  ada@example.com  ");
    expect(store.get(REMEMBERED_EMAIL_KEY)).toBe("ada@example.com");
    expect(readRememberedEmail()).toBe("ada@example.com");
  });

  it("is not stored while the switch is off", () => {
    const store = stubStorage();
    rememberEmailAddress("ada@example.com");
    expect(store.has(REMEMBERED_EMAIL_KEY)).toBe(false);
    expect(readRememberedEmail()).toBe("");
  });

  it("clears rather than storing a blank", () => {
    const store = stubStorage({
      [REMEMBER_EMAIL_KEY]: "on",
      [REMEMBERED_EMAIL_KEY]: "ada@example.com",
    });
    rememberEmailAddress("   ");
    expect(store.has(REMEMBERED_EMAIL_KEY)).toBe(false);
  });

  it("stays unread when a stray value outlives the switch", () => {
    stubStorage({ [REMEMBERED_EMAIL_KEY]: "ada@example.com" });
    expect(readRememberedEmail()).toBe("");
  });

  it("is never the password — only the address is ever written", () => {
    const store = stubStorage({ [REMEMBER_EMAIL_KEY]: "on" });
    rememberEmailAddress("ada@example.com");
    expect([...store.keys()].sort()).toEqual(
      [REMEMBER_EMAIL_KEY, REMEMBERED_EMAIL_KEY].sort(),
    );
  });
});

describe("a device where localStorage throws", () => {
  it("reads as off and empty instead of crashing the sign-in card", () => {
    stubThrowingStorage();
    expect(readRememberEmail()).toBe(false);
    expect(readRememberedEmail()).toBe("");
  });

  it("swallows both writes", () => {
    stubThrowingStorage();
    expect(() => writeRememberEmail(true)).not.toThrow();
    expect(() => rememberEmailAddress("ada@example.com")).not.toThrow();
  });
});

describe("initialEmail", () => {
  it("prefills the remembered address", () => {
    expect(initialEmail({ remembered: "ada@example.com" })).toBe("ada@example.com");
  });

  it("is empty when nothing is remembered", () => {
    expect(initialEmail({ remembered: "" })).toBe("");
    expect(initialEmail({})).toBe("");
  });

  it("lets an invitation outrank the remembered address", () => {
    expect(
      initialEmail({ invitedEmail: "grace@example.com", remembered: "ada@example.com" }),
    ).toBe("grace@example.com");
  });

  it("keeps the dev test account only when nothing is remembered", () => {
    expect(initialEmail({ devFallback: "test@context.local" })).toBe("test@context.local");
    expect(
      initialEmail({ remembered: "ada@example.com", devFallback: "test@context.local" }),
    ).toBe("ada@example.com");
  });
});
