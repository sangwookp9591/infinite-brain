// SPDX-License-Identifier: Apache-2.0
// Original typographic SVG; CSS selects ink or silver for the current theme.

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark ${className ?? ""}`} role="img" aria-label="Infinite Brain" />
  );
}
