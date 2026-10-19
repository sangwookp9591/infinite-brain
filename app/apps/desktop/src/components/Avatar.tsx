/* ============================================================
   Generated avatars — every person without a photo gets a "neuron": a soma,
   a few dendrites ending in bulbs, and one thicker axon, drawn on a lavender
   tile (`lib/avatar/neuron.ts`). It is seeded from their id/email/name, built
   as pure SVG on-device (no network, no external avatar service that would
   break local-first and leak identity), and the same seed renders the same
   neuron on every machine. People differ by shape as well as hue.

   EAGER-SAFE. The old third-party generator was ~300 KB, so it had to stay
   behind a lazy boundary. The neuron generator is ~3 KB
   with no dependencies, so it is imported statically everywhere (`./Face`
   is now a thin re-export) and no first-screen monogram swap is needed.
   ============================================================ */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useResolvedAvatar, type AvatarIdentity } from "../lib/avatarIdentity";
import { neuronSvg, type AvatarTheme } from "../lib/avatar/neuron";
import { useAvatarTheme } from "../lib/avatar/useAvatarTheme";

/** Build the generated-avatar SVG for a seed. */
export function characterSvg(seed: string, theme: AvatarTheme = "light"): string {
  return neuronSvg(seed, theme);
}

export interface FaceProps extends AvatarIdentity {
  className?: string;
  style?: CSSProperties;
  title?: string;
  ariaHidden?: boolean;
}

/** Photo-or-character markup for a resolved avatar, inside the caller's span. */
function useAvatarMarkup(identity: AvatarIdentity) {
  const { photo, seed } = useResolvedAvatar(identity);
  const theme = useAvatarTheme();
  // The SVG has no ids, so identical avatars can share a page without clashes.
  const svg = useMemo(() => characterSvg(seed, theme), [seed, theme]);
  // Prefer the person's photo; fall back to the generated avatar if it
  // fails to load.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => setImgFailed(false), [photo]);
  return { photo: photo && !imgFailed ? photo : null, svg, onError: () => setImgFailed(true) };
}

function PhotoImg({ src, onError }: { src: string; onError: () => void }) {
  // Google's lh3.googleusercontent.com can 403 when a referrer is sent.
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={onError} />;
}

/**
 * The face span every small avatar uses (presence stack, roster, sidebar
 * presence, version rows): the person's stored picture, else the character
 * seeded by their user id (`lib/avatarIdentity.ts`).
 */
export function FaceSvg({ className, style, title, ariaHidden, ...identity }: FaceProps) {
  const { photo, svg, onError } = useAvatarMarkup(identity);
  const common = {
    className: `glass-face${className ? ` ${className}` : ""}`,
    style,
    title,
    "aria-hidden": ariaHidden || undefined,
  };
  if (photo) {
    return (
      <span {...common}>
        <PhotoImg src={photo} onError={onError} />
      </span>
    );
  }
  return <span {...common} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * The account-sized avatar (account bar, Members and access, profile page,
 * settings). `label` is the display name, used as the seed only when no user
 * id is known (an invitation row, say).
 */
export function Avatar({
  label,
  image,
  userId,
}: {
  label: string;
  image?: string | null;
  userId?: string | null;
}) {
  const { photo, svg, onError } = useAvatarMarkup({ userId, name: label, image });
  if (photo) {
    return (
      <span className="avatar glass-face" aria-hidden="true">
        <PhotoImg src={photo} onError={onError} />
      </span>
    );
  }
  return (
    <span
      className="avatar glass-face"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
