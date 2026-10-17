/* Preset vault icons: generated Orbit marks (see `../lib/avatar/vaultMark`).

   No longer heavy, but it stays behind the `React.lazy` boundary in
   `./VaultSwitcher` (`VaultTile`) so the startup graph is unchanged. */
import { useMemo } from "react";
import { ITEM_COLORS } from "../lib/appearance";
import { vaultMarkSvg } from "../lib/avatar/vaultMark";
import { NO_COLOR, type VaultIconName } from "../lib/vaultIcon";

/**
 * The SVG for one preset: the pastel tile under the deeper mark of the same
 * hue, so a vault icon reads like the coloured folders in the tree. "None" has
 * no tile and draws in the surrounding text colour (`currentColor`).
 */
export function vaultIconSvg(icon: VaultIconName, colorId: string): string {
  if (colorId === NO_COLOR) return vaultMarkSvg(icon, null);
  const color = ITEM_COLORS.find((c) => c.id === colorId) ?? ITEM_COLORS[0];
  return vaultMarkSvg(icon, { fill: color.fill, ink: color.value });
}

export default function VaultIconSvg({
  icon,
  color,
}: {
  icon: VaultIconName;
  color: string;
}) {
  const svg = useMemo(() => vaultIconSvg(icon, color), [icon, color]);
  return <span className="vault-icon-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}
