// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
import { ExternalSharingSettings } from "../ExternalSharingSettings";
import { RevokeExternalAccess } from "../RevokeExternalAccess";
const api=vi.hoisted(()=>({getExternalSharing:vi.fn(),setExternalSharing:vi.fn(),externalAccessPreview:vi.fn(),revokeExternalAccess:vi.fn()}));
vi.mock("../../lib/auth/authManager",()=>({authManager:{api}}));
let root:Root;let host:HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.resetAllMocks();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
const button=(label:string)=>[...host.querySelectorAll("button")].find(b=>b.textContent===label)!;
it("failed policy loading never enables saving a permissive default",async()=>{
 api.getExternalSharing.mockRejectedValue(new Error("offline"));await act(async()=>root.render(createElement(ExternalSharingSettings,{organizationId:"org"})));
 expect(button("Save sharing settings").disabled).toBe(true);expect(api.setExternalSharing).not.toHaveBeenCalled();
});
it("policy changes explain what existing guests and public links can still do",async()=>{
 api.getExternalSharing.mockResolvedValue({mode:"off",domains:[]});api.setExternalSharing.mockResolvedValue({mode:"off",domains:[]});
 await act(async()=>root.render(createElement(ExternalSharingSettings,{organizationId:"org"})));
 expect(host.textContent).toContain("Existing guests keep their shared items");await act(async()=>button("Save sharing settings").click());
 expect(api.setExternalSharing).toHaveBeenCalledWith("org",{mode:"off",domains:[]});
});
it("bulk removal confirms counts and retries the same operation after partial failure",async()=>{
 api.externalAccessPreview.mockResolvedValue({guests:2,invitations:1,publicLinks:3,aiConnections:4,bootstrapSessions:0});
 api.revokeExternalAccess.mockResolvedValueOnce({id:"id",status:"partial",counts:{guests:1},errors:[{}]}).mockResolvedValueOnce({id:"id",status:"completed",counts:{guests:2},errors:[]});
 await act(async()=>root.render(createElement(RevokeExternalAccess,{organizationId:"org"})));
 await act(async()=>button("Review external access").click());expect(host.textContent).toContain("2 guests");expect(host.textContent).toContain("up to 5 minutes");expect(api.revokeExternalAccess).not.toHaveBeenCalled();
 await act(async()=>button("Remove all external access").click());expect(host.textContent).toContain("Some access couldn't be removed");
 await act(async()=>button("Try again").click());expect(api.revokeExternalAccess.mock.calls[0]).toEqual(api.revokeExternalAccess.mock.calls[1]);expect(host.textContent).toContain("External access removed.");
});
