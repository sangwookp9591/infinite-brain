// SPDX-License-Identifier: Apache-2.0
// Development-only: ?dir=orbit|synapse|folio &screen=welcome|main|settings|share &theme=light|dark
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import "./directions.css";
import { Main, Settings, Share, Welcome } from "./screens";
import { TOKENS, cssVars, type DirectionId, type Mode } from "./tokens";

const q = new URLSearchParams(location.search);
const dir = (["orbit", "synapse", "folio"].includes(q.get("dir") ?? "") ? q.get("dir") : "orbit") as DirectionId;
const mode: Mode = q.get("theme") === "dark" ? "dark" : "light";
const screen = q.get("screen") ?? "welcome";
const Screen = { welcome: Welcome, main: Main, settings: Settings, share: Share }[screen] ?? Welcome;
document.documentElement.dataset.dir = dir;
document.documentElement.dataset.theme = mode;
Object.entries(cssVars(TOKENS[dir][mode])).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
createRoot(document.getElementById("root")!).render(<StrictMode><div className="stage" data-screen={screen}><Screen dir={dir} mode={mode} /></div></StrictMode>);
