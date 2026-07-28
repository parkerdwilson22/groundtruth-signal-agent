'use client';

import { useState } from 'react';

/**
 * Header brand lock-up. Uses the Smoove Visuals mark from /public/logo.png
 * when present, and falls back to a typographic mark if the file is missing,
 * so the app never renders a broken image.
 */
export function BrandMark() {
  const [logoOk, setLogoOk] = useState(true);

  return (
    <div className="flex items-center gap-3">
      {logoOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/logo.png"
          alt="Smoove Visuals"
          width={34}
          height={34}
          className="h-[34px] w-[34px] object-contain"
          onError={() => setLogoOk(false)}
          // A missing file can resolve as "loaded" with zero dimensions
          // (and onError may be missed during hydration), so check the
          // decoded size too rather than trusting onError alone.
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth === 0) setLogoOk(false);
          }}
          ref={(el) => {
            if (el?.complete && el.naturalWidth === 0) setLogoOk(false);
          }}
        />
      ) : (
        <div
          aria-hidden
          className="flex h-[34px] w-[34px] items-center justify-center rounded-md"
          style={{ background: 'var(--gt-black)' }}
        >
          <span className="gt-title text-[15px] text-white">S</span>
        </div>
      )}

      <div className="leading-tight">
        <div className="gt-title text-[17px]">GroundTruth</div>
        <div className="gt-mono text-[10px] tracking-wide text-[var(--gt-muted-soft)]">
          SMOOVE VISUALS · FAA PART 107
        </div>
      </div>
    </div>
  );
}
