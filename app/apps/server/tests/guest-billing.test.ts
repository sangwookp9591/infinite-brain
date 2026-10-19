// SPDX-License-Identifier: Apache-2.0
import { afterAll,expect,it } from "vitest";
import { pool } from "./helpers/db.js";
import { guestFixture } from "./helpers/guest.js";
import { seatCount } from "../src/billing/entitlements.js";
afterAll(()=>pool.end());
it("Q10 pending: guest keeps the existing seat counting behavior",async()=>{const f=await guestFixture();expect(await seatCount(f.org)).toEqual({members:3,pendingInvitations:0});});
