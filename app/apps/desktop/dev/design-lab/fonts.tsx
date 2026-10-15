// SPDX-License-Identifier: Apache-2.0
import { useEffect } from "react";

export function DisplayType() {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700&family=Inter:opsz,wght@32,400;32,600;32,700&display=swap";
    document.head.append(link);
    return () => link.remove();
  }, []);
  return <section className="lab-section" aria-labelledby="display-type"><h2 id="display-type" className="lab-h2">Display type</h2><div className="lab-fonts">{[
    { name: "Radio Canada Big", family: "var(--font-display)", note: "Current · bundled" },
    { name: "Inter Display", family: '"Inter", sans-serif', note: "Candidate · Inter at display optical size 32" },
    { name: "Geist", family: '"Geist", sans-serif', note: "Candidate · Google Fonts" },
  ].map(font => <article className="lab-font-sample" key={font.name}><span className="scene-eyebrow">{font.name} · {font.note}</span><div style={{ fontFamily: font.family, fontOpticalSizing: "auto", fontVariationSettings: font.name === "Inter Display" ? '"opsz" 32' : undefined }}><h3>A little space to think.</h3><p>Connect your notes. Find your next idea.</p></div></article>)}</div></section>;
}
