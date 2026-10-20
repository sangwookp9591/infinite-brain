// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { explainUnreachable, isNetworkFailure, unreachableAuthMessage } from "../auth/unreachable";
import { ApiError } from "../api";
import { translate } from "../i18n";

describe("sign-in / sign-up with no server", () => {
  it("recognises what fetch throws when nothing answers, in both webviews", () => {
    expect(isNetworkFailure(new TypeError("Load failed"))).toBe(true);      // WebKit
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);  // Chromium
    expect(isNetworkFailure(new Error("User already exists"))).toBe(false);
  });

  it("replaces the raw error with a sentence naming the server", () => {
    const e = explainUnreachable(new TypeError("Load failed"), "http://localhost:3010");
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toContain("localhost:3010");
    expect((e as Error).message).not.toContain("Load failed");
    expect((e as Error).message).toMatch(/without one/);
  });

  it("leaves a server's own answer alone (wrong password, address taken)", () => {
    const fromServer = new ApiError(422, "User already exists. Use another email.");
    expect(explainUnreachable(fromServer, "http://localhost:3010")).toBe(fromServer);
  });

  it("copes with a server value that is not a URL", () => {
    expect(unreachableAuthMessage("not a url")).toContain("not a url");
  });

  it("has a Korean version with the host placeholder intact", () => {
    const en = "Couldn't reach the server at {host}. An account is for working with a team and needs an Infinite Brain server. You can keep using your notes on this computer without one.";
    const ko = translate("ko", en, { host: "localhost:3010" });
    expect(ko).toContain("localhost:3010");
    expect(ko).not.toBe(en);
  });
});
