"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Subscribes to server-sent change notifications and refreshes server-rendered data. */
export function LiveRefresh({ scope }: { scope: string }) {
  const router = useRouter();
  const last = useRef<number>(0);
  useEffect(() => {
    const es = new EventSource(`/api/live?scope=${encodeURIComponent(scope)}`);
    es.addEventListener("change", () => {
      const now = Date.now();
      if (now - last.current < 800) return;
      last.current = now;
      router.refresh();
    });
    return () => es.close();
  }, [scope, router]);
  return null;
}
