// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { folderPagePose } from "../FolderCard";
it("keeps a closed stack and fans opened pages symmetrically", () => {
  expect(folderPagePose(0, 3, false).x).toBe(0);
  expect(folderPagePose(0, 3, true).x).toBe(-folderPagePose(2, 3, true).x);
  expect(folderPagePose(0, 3, true).rotate).toBe(-folderPagePose(2, 3, true).rotate);
  expect(folderPagePose(0, 1, true).rotate).toBe(0);
});
