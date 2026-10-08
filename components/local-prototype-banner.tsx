"use client";

import { Info } from "lucide-react";

/** Sprint 7: Content OS V1 runtime lives only in this browser tab's memory. */
export function LocalPrototypeBanner() {
  return (
    <div role="status" className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 pl-12 text-[11px] font-semibold text-amber-900 lg:pl-5">
      <Info className="size-3.5 shrink-0" /> Local prototype — refresh resets runtime data
    </div>
  );
}
