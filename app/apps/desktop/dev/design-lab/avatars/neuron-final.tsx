// SPDX-License-Identifier: Apache-2.0
// Development-only: ?theme=light|dark — the product Neuron generator, 24 seeds at 64/24/16px.
import { createRoot } from "react-dom/client";
import { TILE_BG, neuronSvg, type AvatarTheme } from "../../../src/lib/avatar/neuron";

const theme: AvatarTheme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
const page = theme === "dark" ? { bg: "#14122b", card: "#1d1a3a", ink: "#ece9ff", muted: "#aaa6cf" } : { bg: "#ffffff", card: "#f6f4ff", ink: "#1c1840", muted: "#5b5880" };
const seeds = Array.from({ length: 24 }, (_, i) => `member-${i + 1}@vault.example`);
const Svg = ({ html, size }: { html: string; size: number }) => <span style={{ width: size, height: size, display: "inline-block" }} dangerouslySetInnerHTML={{ __html: html }} />;
document.body.style.cssText = `margin:0;background:${page.bg};color:${page.ink};font:14px system-ui,sans-serif`;
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 28, width: 1440, boxSizing: "border-box" }}>
    <h1 style={{ margin: "0 0 4px", fontSize: 22 }}>Neuron avatars · {theme} · 24 seeds</h1>
    <p style={{ margin: "0 0 16px", color: page.muted }}>Tile {TILE_BG[theme]} · 64 / 24 / 16 px per seed.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
      {seeds.map((s) => {
        const svg = neuronSvg(s, theme);
        return (
          <div key={s} style={{ display: "grid", justifyItems: "center", gap: 6, padding: 8, borderRadius: 10, background: page.card }}>
            <Svg html={svg} size={64} />
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Svg html={svg} size={24} /><Svg html={svg} size={16} /></span>
          </div>
        );
      })}
    </div>
  </main>,
);
