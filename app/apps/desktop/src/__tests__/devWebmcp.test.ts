// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDevTools } from "../../dev/webmcp";

const tool = (name: string) => ({ name, description: `${name} tool`, execute: () => ({ ok: true }) });

describe("development WebMCP registration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers every tool on document.modelContext", () => {
    const registerTool = vi.fn();
    vi.stubGlobal("document", { modelContext: { registerTool } });
    vi.stubGlobal("navigator", {});
    registerDevTools([tool("one"), tool("two")]);
    expect(registerTool.mock.calls.map(([entry]) => entry.name)).toEqual(["one", "two"]);
  });

  it("falls back to navigator.modelContext", () => {
    const registerTool = vi.fn();
    vi.stubGlobal("document", {});
    vi.stubGlobal("navigator", { modelContext: { registerTool } });
    registerDevTools([tool("one")]);
    expect(registerTool).toHaveBeenCalledTimes(1);
  });

  it("does nothing when WebMCP is unavailable", () => {
    vi.stubGlobal("document", {});
    vi.stubGlobal("navigator", {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const registerTool = vi.fn();
    registerDevTools([tool("one")]);
    expect(info).toHaveBeenCalledTimes(1);
    expect(registerTool).not.toHaveBeenCalled();
  });

  it("continues after an individual registration fails", () => {
    const registerTool = vi.fn().mockImplementationOnce(() => { throw new Error("duplicate"); });
    vi.stubGlobal("document", { modelContext: { registerTool } });
    vi.stubGlobal("navigator", {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    registerDevTools([tool("duplicate"), tool("registered")]);
    expect(registerTool.mock.calls.map(([entry]) => entry.name)).toEqual(["duplicate", "registered"]);
  });
});
