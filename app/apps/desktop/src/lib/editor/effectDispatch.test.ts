// @vitest-environment jsdom
//
// The locked-note switch crash, reduced to its mechanism.
//
// `ReactWidget.toDOM` calls `flushSync` from inside a CodeMirror update, and
// React answers by flushing the app root's pending passive effects — so an
// effect that dispatches lands inside the update CodeMirror is still running.
// The first test proves CodeMirror really does throw there (guarding the claim,
// not our code); the rest pin the fix.
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, WidgetType, Decoration } from "@codemirror/view";
import { StateField } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { dispatchAfterCommit } from "./effectDispatch";

/** A widget that re-enters the view from `toDOM`, exactly as `flushSync` does. */
function reentrantWidgetField(reenter: (view: EditorView) => void) {
  const marker = new Compartment();
  class Reentrant extends WidgetType {
    constructor(readonly ro: boolean) {
      super();
    }
    eq(other: Reentrant) {
      return other.ro === this.ro;
    }
    toDOM(view: EditorView) {
      // Stand-in for React's flushSync flushing a pending passive effect.
      reenter(view);
      return document.createElement("div");
    }
  }
  const field = StateField.define({
    create: (state) =>
      Decoration.set([
        Decoration.widget({ widget: new Reentrant(state.readOnly), block: true, side: -1 }).range(0),
      ]),
    update: (value, tr) =>
      tr.startState.readOnly !== tr.state.readOnly
        ? Decoration.set([
            Decoration.widget({
              widget: new Reentrant(tr.state.readOnly),
              block: true,
              side: -1,
            }).range(0),
          ])
        : value,
    provide: (f) => EditorView.decorations.from(f),
  });
  return { marker, field };
}

function mount(reenter: (view: EditorView) => void) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const editable = new Compartment();
  const { field } = reentrantWidgetField(reenter);
  const view = new EditorView({
    state: EditorState.create({
      doc: "body text",
      extensions: [field, editable.of([])],
    }),
    parent,
  });
  return { view, editable };
}

describe("dispatching into a live view from a React passive effect", () => {
  it("throws when the dispatch is synchronous and re-entrant (the crash)", () => {
    let inner: ((view: EditorView) => void) | null = null;
    const { view, editable } = mount((v) => inner?.(v));
    // The second, re-entrant reconfigure — what React's flushSync triggered.
    inner = (v) => {
      v.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(true)]) });
    };
    expect(() =>
      view.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(true)]) }),
    ).toThrow(/not allowed while an update is in progress/);
    view.destroy();
  });

  it("does not throw when the re-entrant dispatch goes through dispatchAfterCommit", async () => {
    let inner: ((view: EditorView) => void) | null = null;
    const { view, editable } = mount((v) => inner?.(v));
    inner = (v) => {
      dispatchAfterCommit(
        v,
        { effects: editable.reconfigure([EditorState.readOnly.of(true)]) },
        { isLive: () => true },
      );
    };
    expect(() =>
      view.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(true)]) }),
    ).not.toThrow();
    await Promise.resolve();
    expect(view.state.readOnly).toBe(true);
    view.destroy();
  });

  it("drops a queued dispatch when the view is no longer the live one", async () => {
    const { view, editable } = mount(() => {});
    let live = true;
    dispatchAfterCommit(
      view,
      { effects: editable.reconfigure([EditorState.readOnly.of(true)]) },
      { isLive: () => live },
    );
    live = false; // the note was switched before the microtask ran
    await Promise.resolve();
    expect(view.state.readOnly).toBe(false);
    view.destroy();
  });

  it("cancels on effect cleanup", async () => {
    const { view, editable } = mount(() => {});
    const cancel = dispatchAfterCommit(
      view,
      { effects: editable.reconfigure([EditorState.readOnly.of(true)]) },
      { isLive: () => true },
    );
    cancel();
    await Promise.resolve();
    expect(view.state.readOnly).toBe(false);
    view.destroy();
  });

  it("runs `then` after the transaction lands", async () => {
    const { view, editable } = mount(() => {});
    let sawReadOnly: boolean | null = null;
    dispatchAfterCommit(
      view,
      { effects: editable.reconfigure([EditorState.readOnly.of(true)]) },
      { isLive: () => true, then: (v) => (sawReadOnly = v.state.readOnly) },
    );
    await Promise.resolve();
    expect(sawReadOnly).toBe(true);
    view.destroy();
  });
});
