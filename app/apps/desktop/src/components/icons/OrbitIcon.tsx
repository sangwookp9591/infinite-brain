// SPDX-License-Identifier: Apache-2.0
// Orbit line-icon set: 24px grid, 1.5px round-cap strokes in currentColor.
// Paths come from the approved design-lab direction (dev/design-lab/directions).
// Existing inline icons keep their own markup; the global rule in App.css
// normalises their stroke to the same weight.

const ORBIT_PATHS = {
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4-4",
  file: "M7 3h7l4 4v14H7zM14 3v4h4",
  folder: "M3 6h6l2 2h10v11H3z",
  plus: "M12 5v14M5 12h14",
  settings: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1",
  share: "M18 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM8 11l8-5M8 13l8 5",
  users: "M9 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 6a3 3 0 0 1 0 5M18 14c2 .6 3 2.6 3 6",
  graph: "M6 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM18 8a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM10 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4ZM8 9l8 1.5M7 10l3 6M17 12l-5 5",
  chevron: "M8 10l4 4 4-4",
  close: "M6 6l12 12M18 6L6 18",
  spark: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z",
  home: "M4 11l8-7 8 7v9H4zM10 20v-6h4v6",
  link: "M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3A4 4 0 0 0 11 18.6l1-1",
  check: "M5 12.5l4.5 4.5L19 7.5",
  brand: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM4.5 12c3-5 12-5 15 0M4.5 12c3 5 12 5 15 0",
};
export type OrbitIconName = keyof typeof ORBIT_PATHS;
export const ORBIT_ICON_NAMES = Object.keys(ORBIT_PATHS) as OrbitIconName[];

export function OrbitIcon({ name, size = 18, className }: { name: OrbitIconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ? `orbit-icon ${className}` : "orbit-icon"}
    >
      <path d={ORBIT_PATHS[name]} />
    </svg>
  );
}
