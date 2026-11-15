"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/**
 * One AdSense unit. Policy rules this component enforces:
 * - renders nothing at all until both the client id and this slot's id are
 *   configured, so there are never empty ad boxes;
 * - always labelled "Advertisement";
 * - reserves its height up front so the page does not jump when the ad loads;
 * - carries its own vertical margin to stay clear of links and buttons.
 * Only place it on pages with real article content (blog index, articles).
 */
export function AdSlot({
  slot,
  minHeight = 280,
  className = "",
}: {
  slot: string;
  minHeight?: number;
  className?: string;
}) {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

  const ref = useRef<HTMLModElement>(null);

  useEffect(() => {
    if (!client || !slot) return;
    // A slot that is hidden at this screen size (the sidebar on phones) has no
    // width; asking AdSense to fill it throws, so leave it alone.
    if (!ref.current || ref.current.offsetWidth === 0) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Ad blocked or script not loaded: leave the reserved space empty.
    }
  }, [client, slot]);

  if (!client || !slot) return null;

  return (
    <aside aria-label="Advertisement" className={`my-10 ${className}`}>
      <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-slate">Advertisement</p>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: "block", minHeight }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
