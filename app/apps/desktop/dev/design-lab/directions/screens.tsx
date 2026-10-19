// SPDX-License-Identifier: Apache-2.0
import { avatarSvg } from "../avatars/generators";
import { Icon } from "./icons";
import { DIRECTIONS, type DirectionId, type Mode } from "./tokens";

interface P { dir: DirectionId; mode: Mode }
export function Avatar({ dir, mode, seed, size = 28 }: P & { seed: string; size?: number }) {
  const svg = avatarSvg(seed, { style: DIRECTIONS[dir].avatar, theme: mode, circle: dir !== "synapse" });
  return <span className="av" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
const Logo = ({ dir }: { dir: DirectionId }) => <span className="logo"><Icon name="brand" dir={dir} size={20} /><b>Infinite Brain</b></span>;

export function Welcome({ dir, mode }: P) {
  const copy = { orbit: ["Every idea has an orbit.", "Pick a vault and pick up where you left off."], synapse: ["Open a vault.", "Jump back in. Press ⌘K to search anything."], folio: ["Welcome back to your notebook.", "Choose a vault, or start a fresh one."] }[dir];
  return (
    <div className="welcome">
      <Logo dir={dir} />
      <h1>{copy[0]}</h1>
      <p className="lede">{copy[1]}</p>
      <div className="vaults">
        {[["Product team", "42 notes · 4 people", "pt@team.io"], ["Personal", "128 notes · just you", "me@home.io"], ["Research", "17 notes · 2 people", "lab@uni.edu"]].map(([n, m, s]) => (
          <button key={n} className="vault-card">
            <Avatar dir={dir} mode={mode} seed={s} size={36} />
            <span><b>{n}</b><small>{m}</small></span>
            <Icon name="chevron" dir={dir} />
          </button>
        ))}
        <button className="vault-card create"><span className="plus"><Icon name="plus" dir={dir} /></span><span><b>Create a vault</b><small>A fresh space for your next idea.</small></span></button>
      </div>
      <div className="join"><label htmlFor="code">Have an invitation?</label><div className="field"><Icon name="link" dir={dir} /><input id="code" placeholder="Enter your code" /><button className="btn primary">Join</button></div></div>
    </div>
  );
}

const TREE: [string, string, number?][] = [["folder", "Weekly notes", 0], ["file", "Mon 14 – planning", 1], ["file", "Mon 21 – planning", 1], ["folder", "Customers", 0], ["file", "Interview – Hana", 1], ["file", "Launch plan", 0], ["file", "Design principles", 0], ["file", "Reading list", 0]];
export function Main({ dir, mode }: P) {
  return (
    <div className="app">
      <nav className="rail" aria-label="Sections">
        <Icon name="brand" dir={dir} size={22} />
        {(["home", "search", "graph", "users", "settings"] as const).map((n) => <button key={n} className="icon-btn" aria-label={n}><Icon name={n} dir={dir} /></button>)}
        <Avatar dir={dir} mode={mode} seed="me@home.io" size={28} />
      </nav>
      <aside className="sb">
        <button className="vault-switch"><Avatar dir={dir} mode={mode} seed="pt@team.io" size={24} /><b>Product team</b><Icon name="chevron" dir={dir} size={16} /></button>
        <div className="search"><Icon name="search" dir={dir} size={16} /><span>Search notes</span><kbd>⌘K</kbd></div>
        <span className="eyebrow">Notes</span>
        <ul className="tree">{TREE.map(([ic, name, depth], i) => <li key={name} data-depth={depth} aria-current={name === "Launch plan" || undefined} className={name === "Launch plan" ? "on" : ""}><Icon name={ic as "file"} dir={dir} size={16} /><span>{name}</span>{i === 4 && <em className="chip">AI edit</em>}</li>)}</ul>
        <div className="sb-foot"><Icon name="spark" dir={dir} size={16} /><span>Claude is editing 2 notes</span></div>
      </aside>
      <section className="main">
        <div className="tabs" role="tablist">{["Launch plan", "Design principles", "Reading list"].map((t, i) => <span key={t} role="tab" aria-selected={i === 0}>{t}</span>)}<button className="icon-btn" aria-label="New tab"><Icon name="plus" dir={dir} size={16} /></button></div>
        <div className="crumb"><span>Product team</span><span>/</span><b>Launch plan</b><span className="presence"><Avatar dir={dir} mode={mode} seed="hana@team.io" size={22} /><Avatar dir={dir} mode={mode} seed="joon@team.io" size={22} /><button className="btn">Share</button></span></div>
        <article className="sheet">
          <span className="eyebrow">Product team / Planning</span>
          <h2>Launch plan</h2>
          <div className="props"><span>Owner</span><b><Avatar dir={dir} mode={mode} seed="hana@team.io" size={18} /> Hana</b><span>Status</span><b className="chip on">In progress</b><span>Updated</span><b>2 min ago</b></div>
          <p>Good work starts with a little space to think. This week we connect what we learned from customers with the next version of the product.</p>
          <p>Keep decisions next to the ideas that shaped them. Every note is a plain file your team and your AI tools can build on together.</p>
          <ul className="tasks">{[["Gather interview notes", true], ["Review the new workspace", false], ["Share a first draft", false]].map(([t, d]) => <li key={t as string} data-done={d || undefined}><span className="box">{d && <Icon name="check" dir={dir} size={14} />}</span>{t}</li>)}</ul>
          <blockquote>“The best notes are the ones you can find again.” — Hana</blockquote>
        </article>
      </section>
      <aside className="insp">
        <span className="eyebrow">Linked notes</span>
        <ul><li>Interview – Hana</li><li>Design principles</li><li>Weekly notes</li></ul>
        <span className="eyebrow">People here</span>
        <div className="row"><Avatar dir={dir} mode={mode} seed="hana@team.io" size={24} /> Hana <Avatar dir={dir} mode={mode} seed="joon@team.io" size={24} /> Joon</div>
      </aside>
      <footer className="status"><span>● Synced</span><span>Markdown</span><span>212 words</span></footer>
    </div>
  );
}

function Dialog({ title, sub, dir, children, wide }: { title: string; sub: string; dir: DirectionId; children: React.ReactNode; wide?: boolean }) {
  return <div className="scrim"><div className="dialog" role="dialog" aria-label={title} data-wide={wide || undefined}><header><div><h3>{title}</h3><p>{sub}</p></div><button className="icon-btn" aria-label="Close"><Icon name="close" dir={dir} /></button></header>{children}</div></div>;
}
export function Settings({ dir, mode }: P) {
  const rows: [string, string, React.ReactNode][] = [
    ["Theme", "Follow your system or pick a mood.", <div className="seg" key="t">{["System", "Light", "Dark"].map((t) => <span key={t} data-on={t.toLowerCase() === mode || undefined}>{t}</span>)}</div>],
    ["Accent", "A little colour, where it matters.", <div className="swatches" key="a">{[0, 1, 2, 3].map((i) => <i key={i} data-on={i === 0 || undefined} style={{ background: ["var(--accent)", "#2f7d5b", "#c0562f", "#3b6fd1"][i] }} />)}</div>],
    ["Text size", "Find your reading rhythm.", <div className="slider" key="s"><i style={{ width: "46%" }} /><b>16 px</b></div>],
    ["Show line numbers", "A quiet guide while writing.", <span className="switch" key="l" />],
    ["Let Claude suggest edits", "You review every change before it lands.", <span className="switch" data-on key="c" />],
  ];
  return (
    <div className="dimwrap"><Main dir={dir} mode={mode} />
      <Dialog dir={dir} title="Settings" sub="Make the workspace yours." wide>
        <div className="dlg-body"><nav className="dlg-nav">{["Account", "Appearance", "Notifications", "AI connections", "Vault"].map((n, i) => <span key={n} data-on={i === 1 || undefined}>{n}</span>)}</nav>
          <div className="dlg-pane"><div className="profile"><Avatar dir={dir} mode={mode} seed="me@home.io" size={48} /><div><b>Minji Park</b><small>me@home.io</small></div></div>{rows.map(([l, h, c]) => <div className="srow" key={l}><div><b>{l}</b><small>{h}</small></div>{c}</div>)}</div></div>
      </Dialog>
    </div>
  );
}
export function Share({ dir, mode }: P) {
  const people: [string, string, string][] = [["Minji Park", "me@home.io", "Owner"], ["Hana Lee", "hana@team.io", "Can edit"], ["Joon Kim", "joon@team.io", "Can comment"], ["Sora Han", "sora@lab.io", "Can view"]];
  return (
    <div className="dimwrap"><Main dir={dir} mode={mode} />
      <Dialog dir={dir} title="Share “Launch plan”" sub="Invite people to think with you.">
        <div className="dlg-pane solo">
          <div className="field"><input placeholder="Add people by email" /><button className="btn primary">Invite</button></div>
          <span className="eyebrow">People with access</span>
          {people.map(([n, e, r]) => <div className="member" key={e}><Avatar dir={dir} mode={mode} seed={e} size={32} /><div><b>{n}</b><small>{e}</small></div><span className="role">{r} <Icon name="chevron" dir={dir} size={14} /></span></div>)}
          <div className="srow"><div><b>Anyone with the link</b><small>Can view this note. No sign-in needed.</small></div><span className="switch" /></div>
          <footer className="dlg-foot"><button className="btn"><Icon name="link" dir={dir} size={16} /> Copy link</button><button className="btn primary">Done</button></footer>
        </div>
      </Dialog>
    </div>
  );
}
