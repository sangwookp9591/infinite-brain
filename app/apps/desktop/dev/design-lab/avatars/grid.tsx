// SPDX-License-Identifier: Apache-2.0
// Development-only: ?theme=light|dark — 24 seeds x 3 avatar systems at 48/24/16px.
import { createRoot } from "react-dom/client";
import { AVATAR_STYLES, TILE_BG, avatarSvg, type AvatarStyle, type AvatarTheme } from "./generators";

const theme: AvatarTheme = new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light";
const page = theme === "dark" ? { bg: "#0d0f17", ink: "#e9ebf9", muted: "#a2a8c8" } : { bg: "#ffffff", ink: "#14162b", muted: "#555a74" };
const NAMES: Record<AvatarStyle, [string, string]> = {
  constellation: ["A · Constellation", "Members as star maps: 5–7 stars joined by a line, one brighter star."],
  orbit: ["B · Orbit", "Members as small systems: a nucleus, one or two tilted rings, planets."],
  neuron: ["C · Neuron", "Members as cells: a soma with branching dendrites and one bulb."],
};
const seeds = Array.from({ length: 24 }, (_, i) => `member-${i + 1}@vault.example`);
const Svg = ({ html, size }: { html: string; size: number }) => <span style={{ width: size, height: size, display: "inline-block" }} dangerouslySetInnerHTML={{ __html: html }} />;
document.body.style.cssText = `margin:0;background:${page.bg};color:${page.ink};font:14px system-ui,sans-serif`;
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 28, display: "grid", gap: 28, width: 1440, boxSizing: "border-box" }}>
    <h1 style={{ margin: 0, fontSize: 22 }}>Avatar systems · {theme} · same 24 seeds</h1>
    {AVATAR_STYLES.map((style) => (
      <section key={style} aria-label={NAMES[style][0]}>
        <h2 style={{ margin: "0 0 2px", fontSize: 16 }}>{NAMES[style][0]}</h2>
        <p style={{ margin: "0 0 12px", color: page.muted }}>{NAMES[style][1]}</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 14 }}>
          {seeds.map((s) => {
            const svg = avatarSvg(s, { style, theme });
            return (
              <div key={s} style={{ display: "grid", justifyItems: "center", gap: 6, padding: 8, borderRadius: 10, background: theme === "dark" ? "#151827" : "#f6f7fb" }}>
                <Svg html={svg} size={64} />
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}><Svg html={svg} size={24} /><Svg html={svg} size={16} /></span>
              </div>
            );
          })}
        </div>
      </section>
    ))}
    <p style={{ color: page.muted, margin: 0 }}>Tile {TILE_BG[theme]} · marks ≥ 4.5:1 · 64 / 24 / 16 px shown per seed.</p>
  </main>,
);
