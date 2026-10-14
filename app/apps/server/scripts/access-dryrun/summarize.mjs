// Turns a run.ts JSON report (partial or complete) into a Markdown summary.
//   node scripts/access-dryrun/summarize.mjs <report.json> [stdout-file]
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2], "utf8"));
const stdoutFile = process.argv[3];
const out = [];
const p = (s = "") => out.push(s);
const t = r.totals;
p(`# Access dry run: ${r.database}`);
p();
p(`Status: ${r.complete ? "complete" : "PARTIAL"}, ${t.orgs} of ${r.orgsTotal} orgs (most shares, then most members, first). Elapsed ${Math.round(r.elapsedMs / 1000)} s. Generated ${r.generatedAt}.`);
p();
p("| | pairs | same | lost (new < old) | gained |");
p("| --- | --- | --- | --- | --- |");
p(`| all | ${t.all.pairs} | ${t.all.same} | ${t.all.lost} | ${t.all.gained} |`);
for (const k of ["note", "file", "folder"]) p(`| ${k} | ${t.byKind[k].pairs} | ${t.byKind[k].same} | ${t.byKind[k].lost} | ${t.byKind[k].gained} |`);
p(`| folder edit gate | ${t.folderEditGate.pairs} | ${t.folderEditGate.same} | ${t.folderEditGate.lost} | ${t.folderEditGate.gained} |`);
p();
p(`Transitions: \`${JSON.stringify(t.all.transitions)}\``);
p();
p("## Self-checks");
p(`- Indexed vs effectivePermission: old ${t.indexVsExactMismatches.old}, new ${t.indexVsExactMismatches.new} mismatches of ${t.indexVsExactMismatches.checked}.`);
p(`- Readable set vs resolver: old ${t.readableSet.oldDisagree}, new ${t.readableSet.newDisagree} of ${t.readableSet.checked}. Readable-set lost ${t.readableSet.setLost}, gained ${t.readableSet.setGained}.`);
p();
p("## Orgs with any lost or gained pair");
const diff = r.orgs.filter((o) => o.comparison.all.lost || o.comparison.all.gained || o.comparison.folderEditGate.lost || o.comparison.folderEditGate.gained);
if (!diff.length) p("None.");
for (const o of diff) {
  const whys = {};
  for (const e of o.examples) {
    const k = e.why.replace(/rows=\[.*\]/, "").trim();
    whys[k] = (whys[k] ?? 0) + 1;
  }
  const top = Object.entries(whys).sort((a, b) => b[1] - a[1])[0];
  p(`- **${o.orgId}**: members ${o.members}, lost ${o.comparison.all.lost}, gained ${o.comparison.all.gained}, transitions \`${JSON.stringify(o.comparison.all.transitions)}\`, folder edit gate lost ${o.comparison.folderEditGate.lost} / gained ${o.comparison.folderEditGate.gained}. Dominant why (of ${o.examples.length} examples): \`${top ? top[0] : "-"}\`.`);
}
p();
p("## Orgs with per-user vault rows (now absolute levels)");
for (const o of r.orgs.filter((o) => o.perUserVaultRows.total > 0))
  p(`- **${o.orgId}**: rows \`${JSON.stringify(o.perUserVaultRows.byPermissionAndRole)}\`, Everyone row ${o.everyoneRowNewUi} (posture ${o.posture}), members ${o.members}, lost ${o.comparison.all.lost}, gained ${o.comparison.all.gained}.`);
p();
p("## Delete policy (new creator-only rule)");
const d = t.deletePolicy;
p(`- Checks: ${d.checked} (plain member x item they can edit under old or new). Allowed ${d.allowed}, refused not-creator ${d.refusedNotCreator}, refused folder_has_others_items ${d.refusedFolderHasOthers}.`);
p(`- Items refused for at least one plain member who can edit them today: ${d.itemsRefusedForSomeCurrentEditor}.`);
p(`  - created_by null: ${d.itemsRefusedByCreatedByNull}; someone else's: ${d.itemsRefusedByOtherCreator}; folder_has_others_items: ${d.itemsRefusedByFolderContents}.`);
p(`  - by kind and reason: \`${JSON.stringify(t.deleteByKindReason ?? {})}\``);
p(`- Plain members refused at least one delete on an item they can edit today: ${t.deleteAffectedPlainMembers ?? "n/a"} (org, user) pairs, of ${r.orgs.reduce((s, o) => s + (o.members - (o.roles.owner ?? 0) - (o.roles.admin ?? 0)), 0)} plain memberships in the orgs covered.`);
p();
p("## Org facts");
const ev = {};
let orgItemRows = 0, orgsWithOrgItemRows = 0;
for (const o of r.orgs) {
  ev[o.everyoneRowNewUi] = (ev[o.everyoneRowNewUi] ?? 0) + 1;
  orgItemRows += o.orgPrincipalItemRows.total;
  if (o.orgPrincipalItemRows.total) orgsWithOrgItemRows++;
}
p(`- Everyone row in the new UI: \`${JSON.stringify(ev)}\`.`);
p(`- Per-folder/per-file org-principal rows (hidden in the new UI, cleared by an Everyone change): ${orgItemRows} across ${orgsWithOrgItemRows} orgs.`);
if (stdoutFile) {
  p();
  p("## Harness stdout");
  p("```");
  p(readFileSync(stdoutFile, "utf8").trim());
  p("```");
}
console.log(out.join("\n"));
