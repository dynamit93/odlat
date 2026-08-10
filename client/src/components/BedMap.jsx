import { useMemo, useRef } from 'react';

function dist(a, b) {
  const dx = a.x_cm - b.x_cm;
  const dy = a.y_cm - b.y_cm;
  return Math.sqrt(dx * dx + dy * dy);
}

export default function BedMap({ bed, plantings, pendingPoint, onClickMap, onMove }) {
  const svgRef = useRef(null);
  const scale = useMemo(() => {
    const maxDim = Math.max(bed.width_cm, bed.length_cm);
    return Math.min(900 / maxDim, 4);
  }, [bed]);

  const width = bed.width_cm * scale;
  const height = bed.length_cm * scale;

  function toCm(evt) {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());
    return {
      x: Math.min(bed.width_cm, Math.max(0, cursor.x / scale)),
      y: Math.min(bed.length_cm, Math.max(0, cursor.y / scale)),
    };
  }

  function tooClose(p) {
    const spacing = p.spacing_cm || 20;
    return plantings.some((other) => other.id !== p.id && dist(p, other) < Math.min(spacing, other.spacing_cm || spacing) * 0.9);
  }

  function startDrag(planting, evt) {
    evt.stopPropagation();
    const move = (e) => {
      const p = toCm(e);
      // live visual only via parent update after mouseup for simplicity
      planting._drag = p;
      // force re-render by updating via onMove throttled? We'll update on mouseup only.
    };
    const up = (e) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const p = toCm(e);
      onMove?.(planting.id, p.x, p.y);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div className="bed-map-wrap">
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        onClick={(e) => onClickMap?.(toCm(e))}
        role="img"
        aria-label={`Karta för ${bed.name}`}
      >
        <rect x="0" y="0" width={width} height={height} fill="#eef6ea" stroke="#2f6b3a" strokeWidth="2" />
        {plantings.map((p) => {
          const r = ((p.spacing_cm || 20) / 2) * scale;
          const cx = p.x_cm * scale;
          const cy = p.y_cm * scale;
          const warn = tooClose(p);
          return (
            <g key={p.id} onPointerDown={(e) => startDrag(p, e)} style={{ cursor: 'grab' }}>
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={warn ? 'rgba(163,59,43,0.12)' : 'rgba(47,107,58,0.12)'}
                stroke={warn ? '#a33b2b' : '#2f6b3a'}
                strokeDasharray="4 3"
                className={warn ? 'marker-warn' : ''}
              />
              <circle cx={cx} cy={cy} r={8} fill={warn ? '#a33b2b' : '#2f6b3a'} />
              <text x={cx + 12} y={cy + 4} fontSize="12" fill="#1c2a1a">
                {(p.seed?.name || p.custom_name || '').slice(0, 18)}
              </text>
            </g>
          );
        })}
        {pendingPoint && (
          <g>
            <circle
              cx={pendingPoint.x * scale}
              cy={pendingPoint.y * scale}
              r={10}
              fill="#c45c26"
              stroke="#fff"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
    </div>
  );
}
