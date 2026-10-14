import { describe, expect, it } from "vitest";
import { parseBillingLink } from "../billingLink";

describe("parseBillingLink", () => {
  it("accepts both foldings, with and without a vault", () => {
    expect(parseBillingLink("infinitebrain://billing/upgraded")).toEqual({ orgId: null });
    expect(parseBillingLink("infinitebrain:///billing/upgraded/")).toEqual({ orgId: null });
    expect(parseBillingLink("infinitebrain://billing/upgraded?org=WmpuI6BO")).toEqual({
      orgId: "WmpuI6BO",
    });
    expect(parseBillingLink("infinitebrain:///billing/upgraded?org=abc%2Fdef")).toEqual({
      orgId: "abc/def",
    });
  });

  it("accepts the Staging and dev builds' schemes too", () => {
    expect(parseBillingLink("infinitebrain-staging://billing/upgraded?org=x")).toEqual({ orgId: "x" });
    expect(parseBillingLink("infinitebrain-dev://billing/upgraded?org=x")).toEqual({ orgId: "x" });
  });

  it("treats an empty org as absent", () => {
    expect(parseBillingLink("infinitebrain://billing/upgraded?org=")).toEqual({ orgId: null });
    expect(parseBillingLink("infinitebrain://billing/upgraded?org=%20")).toEqual({ orgId: null });
  });

  it("refuses anything else", () => {
    for (const bad of [
      "infinitebrain://billing",
      "infinitebrain://billing/canceled",
      "infinitebrain://billing/upgraded/extra",
      "infinitebrain://upgraded",
      "infinitebrain://verified",
      "https://example.com/billing/upgraded",
      "not a url",
      "infinitebrain://",
    ]) {
      expect(parseBillingLink(bad)).toBeNull();
    }
  });
});
