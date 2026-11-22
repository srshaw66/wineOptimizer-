import {useId, useMemo, useState} from 'react';
import type {KeyboardEvent, PointerEvent} from 'react';
import type {Series} from '../lib/sensors';
import {formatTime, formatValue} from '../lib/format';

const W = 320, H = 96, PAD_X = 4, PAD_TOP = 10, PAD_BOTTOM = 14;

/** Single-series trend: 2px line, recessive baseline, hover/keyboard crosshair with tooltip. */
export default function Sparkline({series, label, timeZone}: {series: Series; label: string; timeZone: string}) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  const pts = series.points;
  const values = pts.map(p => p.v).filter((v): v is number => v !== null);
  const geom = useMemo(() => {
    if (values.length < 2) return null;
    const min = Math.min(...values), max = Math.max(...values);
    const span = max - min || 1;
    const x = (i: number) => PAD_X + (i / (pts.length - 1)) * (W - PAD_X * 2);
    const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOTTOM);
    let d = '';
    pts.forEach((p, i) => {
      if (p.v === null) return;
      const prev = i > 0 ? pts[i - 1].v : null;
      d += `${prev === null ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
    });
    return {min, max, x, y, d};
  }, [pts, values]);

  if (!geom) return <p className="empty-note">Not enough readings to draw a trend.</p>;

  const pick = (clientX: number, rect: DOMRect) => {
    const rel = ((clientX - rect.left) / rect.width) * W;
    setActive(Math.max(0, Math.min(pts.length - 1, Math.round(((rel - PAD_X) / (W - PAD_X * 2)) * (pts.length - 1)))));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => pick(e.clientX, e.currentTarget.getBoundingClientRect());
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setActive(i => Math.max(0, Math.min(pts.length - 1, (i ?? pts.length - 1) + (e.key === 'ArrowLeft' ? -1 : 1))));
  };
  const a = active !== null ? pts[active] : null;
  const last = [...pts].reverse().find(p => p.v !== null);
  const fmt = (v: number) => formatValue({value: v, unit: series.unit});

  return (
    <figure className="sparkline">
      <div className="sparkline-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          <title id={titleId}>{`${label} trend, ${pts.length} readings, range ${fmt(geom.min)} to ${fmt(geom.max)}. Use arrow keys to inspect values.`}</title>
          <line className="spark-base" x1={PAD_X} x2={W - PAD_X} y1={H - PAD_BOTTOM} y2={H - PAD_BOTTOM} />
          <path className="spark-line" d={geom.d} vectorEffect="non-scaling-stroke" />
          {a && a.v !== null && (
            <g>
              <line className="spark-cross" x1={geom.x(active!)} x2={geom.x(active!)} y1={PAD_TOP - 6} y2={H - PAD_BOTTOM} vectorEffect="non-scaling-stroke" />
            </g>
          )}
        </svg>
        {a && a.v !== null && (
          <span
            className="spark-dot"
            style={{left: `${(geom.x(active!) / W) * 100}%`, top: `${(geom.y(a.v) / H) * 100}%`}}
            aria-hidden="true"
          />
        )}
        {a && (
          <div
            className="spark-tip"
            role="status"
            style={{left: `${Math.min(78, Math.max(22, (geom.x(active!) / W) * 100))}%`}}
          >
            <b>{a.v === null ? '—' : fmt(a.v)}</b>
            <span>{formatTime(a.t, timeZone)}</span>
          </div>
        )}
      </div>
      <figcaption className="spark-caption">
        <span>Low <b>{fmt(geom.min)}</b></span>
        <span>High <b>{fmt(geom.max)}</b></span>
        <span>Last <b>{last?.v != null ? fmt(last.v) : '—'}</b></span>
      </figcaption>
    </figure>
  );
}
