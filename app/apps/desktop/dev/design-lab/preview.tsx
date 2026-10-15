// SPDX-License-Identifier: Apache-2.0
// Development-only: the next visual language (spec §6) on one page.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/assets/fonts/fonts.css";
import "@fontsource/radio-canada-big/400.css";
import "@fontsource/radio-canada-big/600.css";
import "@fontsource/radio-canada-big/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "../../src/styles/tokens.css";
import "../../src/App.css";
import "./lab.css";
import { demosA } from "./demosA";
import { demosB } from "./demosB";
import { scenes, ACCENTS, LabAppearanceContext, type LabTheme } from "./scenes";
import { DisplayType } from "./fonts";
import type { Demo } from "./types";
import { registerDevTools } from "../webmcp";
import { applyAccent } from "../../src/lib/theme";
import { validAppearanceValue } from "../../src/lib/appearanceSettings";

const params = new URLSearchParams(location.search);
type Theme = "light" | "dark";

function Section({ title, items }: { title: string; items: Demo[] }) {
  if (!items.length) return null;
  return (
    <section className="lab-section">
      <h2 className="lab-h2">{title}</h2>
      <div className="lab-grid">
        {items.map((d) => (
          <article key={d.id} className="lab-card" data-demo={d.id} data-wide={d.wide || undefined}>
            <header>
              <h3>{d.title}</h3>
              <p>{d.usage}</p>
            </header>
            <div className="lab-stage">{d.render()}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Lab() {
  const [theme, setTheme] = useState<LabTheme>(params.get("theme") === "dark" ? "dark" : "light");
  const [accent, setAccent] = useState<string | null>(params.get("accent"));
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = theme === "system" ? media.matches ? "dark" : "light" : theme; };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => { applyAccent(validAppearanceValue("accent", accent) ?? "ink"); }, [accent]);
  useEffect(() => {
    Object.assign(window, { designLab: { setTheme, setAccent } });
  }, []);
  return (
    <main className="lab">
      <header className="lab-top">
        <div>
          <span className="lab-eyebrow">INFINITE BRAIN · DESIGN LAB</span>
          <h1 className="lab-h1">The next visual language.</h1>
        </div>
        <div className="lab-controls">
          <button type="button" className="lab-pill" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "Dark" : "Light"}
          </button>
          {ACCENTS.map((a) => (
            <button key={a.name} type="button" className="lab-swatch" aria-label={`Accent ${a.name}`}
              aria-pressed={accent === a.value} data-ink={a.value === null || undefined}
              style={a.value ? { background: a.value } : undefined} onClick={() => setAccent(a.value)} />
          ))}
        </div>
      </header>
      <Section title="Components" items={[...demosA, ...demosB]} />
      <LabAppearanceContext.Provider value={{ theme, accent, setTheme, setAccent }}><Section title="Scenes" items={scenes} /></LabAppearanceContext.Provider>
      <DisplayType />
    </main>
  );
}

document.documentElement.dataset.theme = params.get("theme") === "dark" ? "dark" : "light";
createRoot(document.getElementById("root")!).render(<StrictMode><Lab /></StrictMode>);

requestAnimationFrame(() => registerDevTools([
  {
    name: "lab_state",
    description: "Read the design lab theme, accent and demo ids.",
    execute: () => ({
      theme: document.documentElement.dataset.theme,
      accent: getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
      demos: [...document.querySelectorAll<HTMLElement>("[data-demo]")].map((e) => e.dataset.demo),
    }),
  },
  {
    name: "set_theme",
    description: "Switch the design lab between light and dark.",
    inputSchema: { type: "object", properties: { theme: { type: "string", enum: ["light", "dark"] } }, required: ["theme"], additionalProperties: false },
    execute: (input) => {
      const theme = (input as { theme?: unknown } | null)?.theme;
      if (theme !== "light" && theme !== "dark") return { error: "theme must be light or dark" };
      (window as unknown as { designLab: { setTheme: (t: Theme) => void } }).designLab.setTheme(theme);
      return { theme };
    },
  },
  {
    name: "set_accent",
    description: "Set the accent to ink (null) or a #rrggbb colour.",
    inputSchema: { type: "object", properties: { accent: { type: ["string", "null"] } }, required: ["accent"], additionalProperties: false },
    execute: (input) => {
      const accent = (input as { accent?: unknown } | null)?.accent;
      if (accent !== null && (typeof accent !== "string" || !/^#[0-9a-f]{6}$/i.test(accent))) return { error: "accent must be null or #rrggbb" };
      (window as unknown as { designLab: { setAccent: (a: string | null) => void } }).designLab.setAccent(accent);
      return { accent };
    },
  },
]));
