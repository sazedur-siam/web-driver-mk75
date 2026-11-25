import { useRef, useState } from 'react';
import { AU75_KEYS, type KeyDef } from '../device/au75Layout';

interface Props {
  selected: Set<number>; // key indices
  onSelect: (indices: Set<number>) => void;
  fill?: (k: KeyDef) => string | undefined;
  sublabel?: (k: KeyDef) => string | undefined;
  multi?: boolean;
  highlight?: (k: KeyDef) => boolean;
}

const VB = { x: 12, y: 18, w: 610, h: 250 };

/** SVG keyboard drawn from the vendor's KB.ini key rectangles. Drag to box-select when `multi`. */
export function Keyboard({ selected, onSelect, fill, sublabel, multi, highlight }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number; additive: boolean } | null>(null);

  const toSvg = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: VB.x + ((e.clientX - r.left) / r.width) * VB.w, y: VB.y + ((e.clientY - r.top) / r.height) * VB.h };
  };

  const hit = (x0: number, y0: number, x1: number, y1: number) => {
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    return AU75_KEYS.filter((k) => k.x2 >= ax && k.x1 <= bx && k.y2 >= ay && k.y1 <= by).map((k) => k.index);
  };

  const onDown = (e: React.PointerEvent) => {
    const p = toSvg(e);
    const additive = multi ? e.shiftKey || e.metaKey || e.ctrlKey : false;
    setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, additive });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag || !multi) return;
    const p = toSvg(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (!drag) return;
    const keys = hit(drag.x0, drag.y0, drag.x1, drag.y1);
    let next: Set<number>;
    if (!multi) next = new Set(keys.slice(0, 1));
    else if (drag.additive) {
      next = new Set(selected);
      for (const k of keys) {
        if (keys.length === 1 && next.has(k)) next.delete(k);
        else next.add(k);
      }
    } else next = new Set(keys);
    setDrag(null);
    onSelect(next);
  };

  return (
    <svg
      ref={svg}
      className="kb"
      viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      role="group"
      aria-label="MK75 keyboard layout"
    >
      <rect className="kb-case" x={VB.x + 1} y={VB.y + 1} width={VB.w - 2} height={VB.h - 2} rx={10} />
      {AU75_KEYS.map((k) => {
        const sel = selected.has(k.index);
        const f = fill?.(k);
        const sub = sublabel?.(k);
        const w = k.x2 - k.x1;
        const h = k.y2 - k.y1;
        return (
          <g key={k.id} className={`key${sel ? ' sel' : ''}${highlight?.(k) ? ' hl' : ''}`}>
            <rect x={k.x1} y={k.y1} width={w} height={h} rx={4} style={f ? { fill: f } : undefined} />
            <text x={k.x1 + w / 2} y={k.y1 + (sub ? h / 2 - 2 : h / 2 + 3)} textAnchor="middle" className="kl">
              {k.label.length > 6 ? k.label.slice(0, 5) : k.label}
            </text>
            {sub && (
              <text x={k.x1 + w / 2} y={k.y1 + h - 5} textAnchor="middle" className="ks">
                {sub.length > 8 ? sub.slice(0, 7) + '…' : sub}
              </text>
            )}
          </g>
        );
      })}
      {drag && multi && (
        <rect
          className="kb-lasso"
          x={Math.min(drag.x0, drag.x1)}
          y={Math.min(drag.y0, drag.y1)}
          width={Math.abs(drag.x1 - drag.x0)}
          height={Math.abs(drag.y1 - drag.y0)}
        />
      )}
    </svg>
  );
}
