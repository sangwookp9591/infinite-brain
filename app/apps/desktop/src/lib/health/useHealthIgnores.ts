import { useCallback, useEffect, useMemo, useState } from "react";
import { readIgnores, withKey, writeIgnores, type HealthIgnores } from "./ignore";
import type { VaultCheckId } from "./types";

export interface HealthIgnoreState {
  checks: ReadonlySet<VaultCheckId>;
  issues: ReadonlySet<string>;
  ignoreCheck(id: VaultCheckId): void;
  restoreCheck(id: VaultCheckId): void;
  dismissIssue(key: string): void;
  restoreIssue(key: string): void;
}

/**
 * The page's ignore list for one vault: loaded when the vault changes, written
 * through on every change. See `ignore.ts` for what is remembered and why it
 * is per device.
 */
export function useHealthIgnores(vaultPath: string | null): HealthIgnoreState {
  const [ignores, setIgnores] = useState<HealthIgnores>(() => readIgnores(vaultPath));

  // A vault switch is a different list; re-read rather than carry one vault's
  // ignores into another's page.
  useEffect(() => {
    setIgnores(readIgnores(vaultPath));
  }, [vaultPath]);

  const update = useCallback(
    (fn: (prev: HealthIgnores) => HealthIgnores) => {
      setIgnores((prev) => {
        const next = fn(prev);
        writeIgnores(vaultPath, next);
        return next;
      });
    },
    [vaultPath],
  );

  return useMemo<HealthIgnoreState>(
    () => ({
      checks: new Set(ignores.checks),
      issues: new Set(ignores.issues),
      ignoreCheck: (id) => update((p) => ({ ...p, checks: withKey(p.checks, id, true) })),
      restoreCheck: (id) => update((p) => ({ ...p, checks: withKey(p.checks, id, false) })),
      dismissIssue: (key) => update((p) => ({ ...p, issues: withKey(p.issues, key, true) })),
      restoreIssue: (key) => update((p) => ({ ...p, issues: withKey(p.issues, key, false) })),
    }),
    [ignores, update],
  );
}
