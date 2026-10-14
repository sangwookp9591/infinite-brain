/**
 * Dispatching into a live `EditorView` from a React **passive effect**.
 *
 * Never do it synchronously. `ReactWidget.toDOM`/`updateDOM` call `flushSync`
 * from inside a CodeMirror DOM update (that is deliberate — it is what makes
 * CM6 measure a widget's real height on the first frame, see `reactWidget.ts`),
 * and React answers a `flushSync` by flushing every pending passive effect on
 * the app root, not just the widget's own tree. So an effect that calls
 * `view.dispatch` can be re-entered in the middle of the very update that is
 * building the widget, and CodeMirror throws
 *
 *     Calls to EditorView.update are not allowed while an update is in progress
 *
 * which unmounts the editor — and, with no error boundary above it, the whole
 * app.
 *
 * That is the locked-note switch crash. Opening a locked note populates the
 * `locks` store, so the NEXT locked note is built read-only from frame one; the
 * teardown's transient "synced" then flips `readOnly` false and the token
 * verdict flips it back. Each flip runs the `[readOnly]` effect, which
 * reconfigures the editable Compartment; the reconfigure rebuilds the
 * note-header widgets (their decorations key off `state.readOnly`); `toDOM`
 * flushes React; and the same effect runs again inside the update.
 *
 * A microtask is the smallest delay guaranteed to run after the update has
 * unwound, and it still lands before paint — so nothing flickers. The returned
 * function is the effect's cleanup: it cancels a dispatch that has not run yet,
 * so a note switch can never push the old note's transaction into the new
 * note's view.
 */

import type { TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export interface EffectDispatchOptions {
  /**
   * Is `view` still the one the component is bound to? Read at dispatch time,
   * never captured: between the effect and the microtask the user may have
   * switched notes, which destroys this view and builds another.
   */
  isLive: () => boolean;
  /** Run after the transaction lands (e.g. restoring focus). */
  then?: (view: EditorView) => void;
}

export function dispatchAfterCommit(
  view: EditorView,
  spec: TransactionSpec,
  opts: EffectDispatchOptions,
): () => void {
  let cancelled = false;
  queueMicrotask(() => {
    if (cancelled || !opts.isLive()) return;
    view.dispatch(spec);
    opts.then?.(view);
  });
  return () => {
    cancelled = true;
  };
}
