/* Avatar wrappers for the first-screen call sites (sidebar presence faces, the
   identity bar, the version list). They used to lazy-load `./Avatar` because
   the old generator weighed ~300 KB; the neuron generator is tiny, so they now render
   synchronously — no monogram flash — and keep their names so callers are
   unchanged. */
import { Avatar, FaceSvg, type FaceProps } from "./Avatar";

/** Same span the caller used to render, with the generated face or photo inside. */
export function Face(props: FaceProps) {
  return <FaceSvg {...props} />;
}

/** Photo-or-generated avatar for eager call sites (the sidebar identity bar). */
export function LazyAvatar(props: { label: string; image?: string | null; userId?: string | null }) {
  return <Avatar {...props} />;
}
