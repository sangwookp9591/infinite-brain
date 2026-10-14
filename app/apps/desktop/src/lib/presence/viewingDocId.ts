/**
 * Which id to announce as "the note I'm looking at".
 *
 * It must be the SERVER doc_id. Everyone else in the presence path speaks
 * server ids: the vault channel drops any presence frame whose docId isn't in
 * the receiver's readable set, and FileTree matches dots by
 * `registry.getMappingCi(path).docId`. A local index id is not merely useless
 * to them — it is indistinguishable from a note they can't read, so it is
 * discarded in silence.
 *
 * The two ids are equal only for notes created on this device, because the
 * server adopts the id we hand it at registration. On a device that JOINED an
 * existing vault, server-only notes are materialized locally with fresh uuids,
 * so announcing the local id made that person invisible on every teammate's
 * sidebar — while they saw everyone else perfectly. That asymmetry is the
 * signature of this bug.
 *
 * With no mapping the answer is **null**, never the local id (#125). A local id
 * is silently dropped by both ends, so announcing one is indistinguishable from
 * announcing nothing — except that it poisons the "did the id change?" check
 * that re-announces once the mapping lands. In an unsynced vault no frame is
 * sent at all, so there is nothing the fallback could have been useful for.
 * Caller-side: `SyncManager` resolves this at SEND time from the open note's
 * PATH, and re-announces whenever the registry's map changes, so a mapping that
 * arrives after the note was opened still reaches teammates.
 *
 * @param localId  the note's local index id — proof a note is open at all
 *   (null when there's nothing open)
 * @param mappedDocId  server doc_id for the note's path, if the registry has
 *   one — absent for a vault that isn't syncing, a note the reconcile hasn't
 *   reached yet, or a non-markdown file
 */
export function viewingDocId(
  localId: string | null | undefined,
  mappedDocId: string | null | undefined,
): string | null {
  if (!localId) return null;
  return mappedDocId || null;
}
