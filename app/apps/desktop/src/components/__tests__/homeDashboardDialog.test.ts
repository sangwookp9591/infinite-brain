// SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as ipc from "../../lib/ipc";
import { HomeDashboardDialog } from "../HomeDashboardDialog";
const mocks = vi.hoisted(() => ({ state: {} as any, write: vi.fn(), detect: vi.fn(), launch: vi.fn() }));
vi.mock("../../store", () => ({ useStore: Object.assign((selector: any) => selector(mocks.state), { getState: () => mocks.state, setState: vi.fn() }) }));
vi.mock("../../lib/dashboard/agent", () => ({ detectInstalledAgents: mocks.detect }));
vi.mock("../../lib/dashboard/agentLaunch", () => ({ requestDashboardAgent: mocks.launch }));
vi.mock("../../lib/ipc", () => ({ writeNoteIfMissing: mocks.write, ensureFolder: vi.fn(async()=>false), folderExists: vi.fn(async()=>true) }));
vi.mock("../../lib/dashboard/templates", () => ({ DASHBOARD_TEMPLATES: [{ id: "daily", name: "Daily", description: "Daily", html: "daily" }], copyDashboardPrompt: vi.fn() }));
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
 vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
 vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
 vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
 mocks.state = { vault: { path: "/fixture", epoch: 1 }, titles: [{path:"Dashboards/HOME.html"}], tree: null, rootFrozen: false, refreshTree: vi.fn(async()=>{}), refreshTitles: vi.fn(async()=>{}), openNoteByPath: vi.fn(async()=>{}), setHome: vi.fn(async()=>{}), openHome: vi.fn(async()=>true) };
 mocks.detect.mockResolvedValue([]); mocks.launch.mockReset();
 mocks.write.mockReset(); host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);
 await act(async()=>root.render(createElement(HomeDashboardDialog)));
 await act(async()=>window.dispatchEvent(new CustomEvent("baalda:new-dashboard", { detail: { templateId:"daily" } })));
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.unstubAllGlobals();});
const input=()=>document.querySelector<HTMLInputElement>(".dashboard-name-input input")!;
async function name(value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input(),value);input().dispatchEvent(new Event("input",{bubbles:true}));});}
async function create(){await act(async()=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>["Add to vault", "Set as Home"].includes(b.textContent ?? ""))!.click());}
it("suggests an available name without overwriting an existing case variant",async()=>{expect(input().value).toBe("Home 2");await name("Home");await create();expect(document.querySelector('[role="alert"]')?.textContent).toContain("already exists");expect(mocks.write).not.toHaveBeenCalled();});
it.each([" .hidden", ".html", "\u007fInvalid"])("rejects invalid normalized name %j without writing",async value=>{await name(value);await create();expect(document.querySelector('[role="alert"]')).not.toBeNull();expect(mocks.write).not.toHaveBeenCalled();expect(document.activeElement).toBe(input());});
it("focuses the editable name after an atomic create collision",async()=>{mocks.write.mockResolvedValue(false);await create();expect(mocks.write).toHaveBeenCalledOnce();expect(input().disabled).toBe(false);expect(document.activeElement).toBe(input());expect(document.querySelector('[role="alert"]')?.textContent).toContain("already exists");});

it("assigns and opens Home directly for an explicit Set a home request", async () => {
 await act(async()=>window.dispatchEvent(new CustomEvent("baalda:new-dashboard", { detail: { setAsHome: true, templateId:"daily" } })));
 mocks.write.mockResolvedValue(true);
 await create();
 expect(mocks.state.setHome).toHaveBeenCalledWith("Dashboards/Home 2.html", "personal");
 expect(mocks.state.openHome).not.toHaveBeenCalled();
 expect(mocks.state.openNoteByPath).toHaveBeenCalledWith("Dashboards/Home 2.html");
 expect(document.querySelector(".dashboard-dialog")).toBeNull();
});
it("retries assignment without writing the created file again", async () => {
 await act(async()=>window.dispatchEvent(new CustomEvent("baalda:new-dashboard", { detail: { setAsHome: true, templateId:"daily" } })));
 mocks.write.mockResolvedValue(true);
 mocks.state.setHome.mockRejectedValueOnce(new Error("Try again"));
 await create();
 expect(document.querySelector('[role="alert"]')?.textContent).toContain("Try again");
 await act(async()=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Retry setting Home")!.click());
 expect(mocks.write).toHaveBeenCalledOnce();
 expect(mocks.state.setHome).toHaveBeenCalledTimes(2);
 expect(mocks.state.openHome).not.toHaveBeenCalled();
 expect(mocks.state.openNoteByPath).toHaveBeenCalledWith("Dashboards/Home 2.html");
});
it("keeps ordinary dashboard creation optional and does not assign Home", async () => {
 mocks.write.mockResolvedValue(true);
 await create();
 expect(mocks.state.setHome).not.toHaveBeenCalled();
 expect(mocks.state.openNoteByPath).toHaveBeenCalledWith("Dashboards/Home 2.html");
 expect(document.querySelector(".dashboard-dialog")?.textContent).toContain("Set as my home");
});
it("does not assign Home after the captured vault changes", async () => {
 await act(async()=>window.dispatchEvent(new CustomEvent("baalda:new-dashboard", { detail: { setAsHome: true, templateId:"daily" } })));
 mocks.write.mockImplementation(async()=>{mocks.state.vault={path:"/other",epoch:2};return true;});
 await create();
 expect(mocks.state.setHome).not.toHaveBeenCalled();
 expect(mocks.state.openHome).not.toHaveBeenCalled();
});

it("offers installed provider actions and launches the exact created file", async () => {
 mocks.detect.mockResolvedValue([{agent:"claude",runnable:true},{agent:"codex",runnable:true}]);
 await act(async()=>window.dispatchEvent(new CustomEvent("baalda:new-dashboard", {detail:{kind:"link"}})));
 await act(async()=>window.dispatchEvent(new CustomEvent("baalda:new-dashboard", { detail: { templateId:"daily" } })));
 mocks.write.mockResolvedValue(true);
 await create();
 expect(document.querySelector(".dashboard-dialog")?.textContent).not.toContain("Copy agent prompt");
 await act(async()=>[...document.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent==="Update with Claude")!.click());
 expect(mocks.launch).toHaveBeenCalledWith({agent:"claude",path:"Dashboards/Home 2.html",expectedEpoch:1});
 expect(document.querySelector(".dashboard-dialog")).toBeNull();
});

it("opens a newly added link without a success modal", async () => {
 await act(async()=>window.dispatchEvent(new CustomEvent("baalda:new-dashboard", { detail: { kind: "link" } })));
 const url = document.querySelector<HTMLInputElement>('.dashboard-url-field input')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(url,"https://baalda.com");url.dispatchEvent(new Event("input",{bubbles:true}));});
 mocks.write.mockResolvedValue(true);
 await create();
 expect(mocks.state.openNoteByPath).toHaveBeenCalledWith("Dashboards/Home.url");
 expect(document.querySelector(".dashboard-dialog")).toBeNull();
});

it("creates the default Dashboards destination before writing", async () => {
 vi.mocked(ipc.ensureFolder).mockClear();
 mocks.write.mockResolvedValue(true);
 await create();
 expect(ipc.ensureFolder).toHaveBeenCalledWith("Dashboards", 1);
 expect(mocks.write.mock.calls[mocks.write.mock.calls.length - 1]?.[0]).toBe("Dashboards/Home 2.html");
});
it("reuses the existing root folder spelling", async () => {
 mocks.state.tree = {path:"",isDir:true,children:[{path:"dashboards",isDir:true,children:[]}]};
 await act(async()=>window.dispatchEvent(new CustomEvent("baalda:new-dashboard", { detail: { templateId:"daily" } })));
 mocks.write.mockResolvedValue(true);
 await create();
 expect(ipc.ensureFolder).toHaveBeenCalledWith("dashboards", 1);
 expect(mocks.state.openNoteByPath).toHaveBeenCalledWith("dashboards/Home 2.html");
});
