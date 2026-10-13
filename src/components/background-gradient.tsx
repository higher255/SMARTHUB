import { ReactNode } from "react";

/**
 * BackgroundGradient: Reusable background layer with accent glow effects.
 * Creates a proper z-index stacking context for consistent visual appearance.
 * 
 * Props:
 * - children: Content to render above the background
 * - showHeroImage: Include the hero image with mask (default: false)
 * - className: Additional classes for the container
 */
export function BackgroundGradient({
  children,
  showHeroImage = false,
  className = "",
}: {
  children: ReactNode;
  showHeroImage?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      {/* Background layer with explicit z-index management */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        {/* Top-right accent glow */}
        <div className="absolute -top-40 right-[-15%] h-[420px] w-[420px] rounded-full bg-accent/20 blur-3xl" />
        
        {/* Bottom-left accent glow */}
        <div className="absolute -bottom-32 left-[-10%] h-[360px] w-[360px] rounded-full bg-accent/10 blur-3xl" />

        {/* Optional hero image with radial mask fade */}
        {showHeroImage && (
          <>
            <img
              src="/hero.jpg"
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover"
              style={{
                maskImage:
                  "radial-gradient(65% 60% at 50% 0%, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 78%)",
                WebkitMaskImage:
                  "radial-gradient(65% 60% at 50% 0%, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.45) 45%, rgba(0,0,0,0) 78%)",
              }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            
            {/* Gradient overlay to fade image into background */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-bg/70 to-bg" />
          </>
        )}
      </div>

      {/* Content layer with explicit z-index to sit above background */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
