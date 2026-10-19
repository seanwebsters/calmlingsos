"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/components/client/api";
import { ErrorNote } from "@/components/client/action";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Draw a region on the image, then comment on it. Annotations are stored in 0–1 coordinates. */
export function AnnotatableImage({ assetId, src, comments, canComment }: { assetId: string; src: string; comments: { id: string; body: string; annotation: Box | null; author: string | null }[]; canComment: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ sx: number; sy: number } | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<Error | null>(null);
  const pos = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  return (
    <div>
      <div
        ref={ref}
        className="checker relative inline-block w-full cursor-crosshair select-none overflow-hidden rounded-xl"
        onMouseDown={(e) => {
          if (!canComment) return;
          const p = pos(e);
          setDrag({ sx: p.x, sy: p.y });
          setBox({ x: p.x, y: p.y, w: 0, h: 0 });
        }}
        onMouseMove={(e) => {
          if (!drag) return;
          const p = pos(e);
          setBox({ x: Math.min(drag.sx, p.x), y: Math.min(drag.sy, p.y), w: Math.abs(p.x - drag.sx), h: Math.abs(p.y - drag.sy) });
        }}
        onMouseUp={() => setDrag(null)}
      >
        <img src={src} alt="" draggable={false} className="block max-h-[72vh] w-full object-contain" />
        {comments.filter((c) => c.annotation).map((c, i) => (
          <div key={c.id} title={c.body} className="absolute border-2 border-warn/80 bg-warn/10" style={{ left: `${c.annotation!.x * 100}%`, top: `${c.annotation!.y * 100}%`, width: `${c.annotation!.w * 100}%`, height: `${c.annotation!.h * 100}%` }}>
            <span className="absolute -left-0.5 -top-5 rounded bg-warn px-1 text-[10px] font-semibold text-ink-950">{i + 1}</span>
          </div>
        ))}
        {box && box.w > 0.01 && <div className="absolute border-2 border-calm-300 bg-calm-300/10" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }} />}
      </div>
      {canComment && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            try {
              await api(`/api/assets/${assetId}/comment`, { body: { comment: text, annotation: box && box.w > 0.01 ? box : undefined } });
              setText("");
              setBox(null);
              router.refresh();
            } catch (err) {
              setError(err as Error);
            }
          }}
        >
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={box && box.w > 0.01 ? "Comment on the highlighted region…" : "Comment (drag on the image to annotate a region)"} className="field" />
          <button className="rounded-lg border border-white/10 px-3 text-sm text-mist-100">Comment</button>
        </form>
      )}
      <ErrorNote error={error} />
    </div>
  );
}
