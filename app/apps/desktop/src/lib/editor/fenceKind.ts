// What a fenced code block's info string asks to be RENDERED as.
//
// One authority, three consumers: live preview's block field (which replaces
// the fence with a widget), live preview's inline plugin (which must skip the
// children of a fence that is not on screen), and codeFence.ts (which must not
// hang a Copy button off a fence line nobody can see). The `html` test used to
// be spelled out in all three; a fourth rendered language would have meant
// finding all of them again.
//
// A fence's info string can carry more than the language (` ```mermaid
// {theme:dark} `, ` ```html title=… `), so only the first word decides.

export type FenceRender = "html" | "mermaid";

/** The rendered form this fence's info string asks for, or null for plain code. */
export function fenceRenderKind(info: string): FenceRender | null {
  const lang = info.trim().toLowerCase().split(/\s+/, 1)[0] ?? "";
  if (lang === "html" || lang === "htm") return "html";
  if (lang === "mermaid" || lang === "mmd") return "mermaid";
  return null;
}
