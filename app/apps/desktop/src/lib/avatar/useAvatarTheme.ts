// SPDX-License-Identifier: Apache-2.0
// The theme a generated avatar should be drawn for: `<html data-theme>` when
// the toggle has stamped it, else the OS preference (pre-hydration frame).
import { useSyncExternalStore } from "react";
import type { AvatarTheme } from "./neuron";

function read(): AvatarTheme {
  const stamped = document.documentElement.getAttribute("data-theme");
  if (stamped === "dark" || stamped === "light") return stamped;
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const query = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  query?.addEventListener?.("change", onChange);
  return () => {
    observer.disconnect();
    query?.removeEventListener?.("change", onChange);
  };
}

export function useAvatarTheme(): AvatarTheme {
  return useSyncExternalStore(subscribe, read, () => "light");
}
