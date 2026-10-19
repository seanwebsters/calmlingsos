"use client";

import { useEffect } from "react";

/**
 * On hosts without a persistent worker, keeps background jobs moving while
 * the studio is open by calling /api/jobs/tick.
 */
export function JobPump() {
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async () => {
      if (stopped) return;
      let delay = 5000;
      try {
        const res = await fetch("/api/jobs/tick", { method: "POST" });
        if (res.ok) {
          const j = (await res.json()) as { remaining: number | null };
          if (j.remaining) delay = 1000;
        } else delay = 15000;
      } catch {
        delay = 15000;
      }
      if (!stopped) timer = setTimeout(run, document.hidden ? Math.max(delay, 15000) : delay);
    };
    void run();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}
