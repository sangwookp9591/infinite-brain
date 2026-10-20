// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { FEATURE_HELP } from "../../components/FeatureHelp";
import { ko } from "../i18n/ko";

describe("settings feature help", () => {
  it("covers the features whose team scope is unclear", () => {
    expect(Object.keys(FEATURE_HELP).sort()).toEqual(["mcp", "members", "smart-search", "versioning"]);
  });

  it("has Korean for every line and a guide in the repository", () => {
    for (const [tab, help] of Object.entries(FEATURE_HELP)) {
      for (const line of [help!.what, help!.where, help!.team]) {
        expect(ko[line], `${tab}: ${line}`).toBeTruthy();
      }
      expect(help!.doc).toMatch(/^(docs\/[A-Z-]+\.md|README\.md#-[a-z-]+)$/);
    }
  });
});
