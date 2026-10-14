// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { createDashboardBridge, DASHBOARD_PROTOCOL, dashboardExternalUrl, dashboardPath, dashboardUrl, type DashboardReply } from "../bridge";

describe("dashboard boundary", () => {
  it("only dispatches messages from the active opaque frame", async () => {
    const source = {}, replies: DashboardReply[] = [];
    let calls = 0;
    const bridge = createDashboardBridge({ source: () => source, current: () => true, methods: { "notes.list": () => { calls++; return []; } }, reply: (reply) => replies.push(reply) });
    const data = { channel: DASHBOARD_PROTOCOL, id: "1", method: "notes.list" };
    await bridge.handle({ source: {}, origin: "null", data });
    await bridge.handle({ source, origin: "https://example.com", data });
    expect(calls).toBe(0);
    await bridge.handle({ source, origin: "null", data });
    expect(calls).toBe(1); expect(replies[0].result).toEqual([]);
    await bridge.handle({ source, origin: "null", data: { ...data, method: "__proto__" } });
    expect(replies[1].error).toBe("Unknown dashboard method");
  });
  it("drops an in-flight answer after a vault switch", async () => {
    const source = {}, replies: DashboardReply[] = []; let current = true;
    let done!: (result: string) => void;
    const bridge = createDashboardBridge({ source: () => source, current: () => current, methods: { read: () => new Promise<string>((resolve) => { done = resolve; }) }, reply: (reply) => replies.push(reply) });
    const running = bridge.handle({ source, origin: "null", data: { channel: DASHBOARD_PROTOCOL, id: "1", method: "read" } });
    current = false; done("private"); await running; expect(replies).toEqual([]);
  });
  it("drops an old frame's reply after the frame is replaced", async () => {
    let source: object = {};
    const old = source, replies: DashboardReply[] = [];
    let done!: (result: string) => void;
    const bridge = createDashboardBridge({ source: () => source, current: () => true, methods: { read: () => new Promise<string>((resolve) => { done = resolve; }) }, reply: (reply) => replies.push(reply) });
    const running = bridge.handle({ source: old, origin: "null", data: { channel: DASHBOARD_PROTOCOL, id: "1", method: "read" } });
    source = {}; done("old private response"); await running;
    expect(replies).toEqual([]);
  });
  it("does not trust null sources before a frame mounts", async () => {
    let calls = 0;
    const bridge = createDashboardBridge({ source: () => null, current: () => true, methods: { read: () => { calls++; } }, reply: () => {} });
    await bridge.handle({ source: null, origin: "null", data: { channel: DASHBOARD_PROTOCOL, id: "1", method: "read" } });
    expect(calls).toBe(0);
  });
  it("refuses oversized requests before dispatch and stops after disposal", async () => {
    const source = {}, replies: DashboardReply[] = []; let calls = 0;
    const bridge = createDashboardBridge({ source: () => source, current: () => true, methods: { read: () => { calls++; } }, reply: (reply) => replies.push(reply) });
    const data = { channel: DASHBOARD_PROTOCOL, id: "1", method: "read", params: "x".repeat(65537) };
    await bridge.handle({ source, origin: "null", data });
    expect(replies[0].error).toBe("Request is too large"); expect(calls).toBe(0);
    bridge.dispose(); await bridge.handle({ source, origin: "null", data: { ...data, params: null } });
    expect(replies).toHaveLength(1);
  });
  it("rejects filesystem and navigation escapes", () => {
    for (const path of ["../x.md", "/x.md", ".context/config.json", "a/.secret.md", "a\\x.md", "https://evil/x.html", "x.png", "node_modules/x.md", "x\u0000.md"]) expect(() => dashboardPath(path)).toThrow();
    for (const url of ["javascript:alert(1)", "http://example.com", "https://user:pass@example.com", "baalda://x"]) expect(() => dashboardExternalUrl(url)).toThrow();
    expect(dashboardUrl("Projects/My Home.html", 4, "windows")).toBe("http://baalda-view.localhost/__baalda/vault/4/Projects/My%20Home.html");
    expect(() => dashboardUrl("Home.html", NaN, "windows")).toThrow();
  });
});
