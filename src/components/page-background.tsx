import { useState } from "react";

/**
 * Ambient photo behind a page. Put your picture at public/hero.jpg.
 *
 * variant "hero" (landing, sign-in): the photo is clearly visible. Text must sit on its own panel
 * (see index.tsx) so it stays readable.
 * variant "subtle" (app pages): the photo is only a faint hint, so working screens stay crisp.
 */
export function PageBackground({ variant = "hero" }: { variant?: "hero" | "subtle" }) {
  const [imageOk, setImageOk] = useState(true);
  const hero = variant === "hero";

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -top-40 right-[-15%] h-[420px] w-[420px] rounded-full bg-accent/15 blur-3xl" />
      <div className="absolute -bottom-32 left-[-10%] h-[360px] w-[360px] rounded-full bg-accent/10 blur-3xl" />

      {imageOk ? (
        <img
          src="/hero.jpg"
          alt=""
          className={`h-full w-full object-cover ${hero ? "opacity-80" : "opacity-[0.12]"}`}
          onError={() => setImageOk(false)}
        />
      ) : null}

      {/* Light tint so the photo blends into the page colour without hiding it */}
      <div className={`absolute inset-0 bg-gradient-to-b ${hero ? "from-bg/5 via-bg/15 to-bg/40" : "from-bg/60 via-bg/70 to-bg/80"}`} />
    </div>
  );
}
