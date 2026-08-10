import { useCallback, useMemo, useRef, useState } from 'react';

const HANDLE = 28;
const PLANT_HIT_CM = 12; // hit radius for selecting/removing a seed
const DBL_MS = 350;

/**
 * Whole-garden map. Plant mode: each tap adds a seed; double-tap a seed removes it.
 * Outside plant mode: move/resize beds like windows.
 */
export default function GardenMap({
  garden,
  beds,
  plantingsByBed = {},
  selectedId,
  plantMode,
  onSelectBed,
  onChangeBed,
  onCommitBed,
  onPlantTap,
  onRemovePlanting,
}) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const liveRef = useRef(null);
  const lastPlantTap = useRef({ id: null, t: 0 });
  const [live, setLive] = useState(null);

  const scale = useMemo(() => {
    const maxW = typeof window !== 'undefined' ? Math.min(window.innerWidth - 32, 920) : 900;
    return Math.min(maxW / garden.width_cm, 1.1);
  }, [garden.width_cm]);

  const W = garden.width_cm * scale;
  const H = garden.length_cm * scale;
  const handleCm = HANDLE / scale;

  const displayBeds = useMemo(() => {
    return beds.map((b) => (live && live.id === b.id ? { ...b, ...live } : b));
  }, [beds, live]);

  const toGardenCm = useCallback(
    (evt) => {
      const svg = svgRef.current;
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const c = pt.matrixTransform(svg.getScreenCTM().inverse());
      return {
        x: Math.min(garden.width_cm, Math.max(0, c.x / scale)),
        y: Math.min(garden.length_cm, Math.max(0, c.y / scale)),
      };
    },
    [garden.width_cm, garden.length_cm, scale]
  );

  function hitHandle(bed, p) {
    const right = bed.x_cm + bed.width_cm;
    const bottom = bed.y_cm + bed.length_cm;
    const near = handleCm * 1.1;
    const onRight = Math.abs(p.x - right) <= near && p.y >= bed.y_cm - near && p.y <= bottom + near;
    const onBottom = Math.abs(p.y - bottom) <= near && p.x >= bed.x_cm - near && p.x <= right + near;
    if (onRight && onBottom) return 'se';
    if (onRight) return 'e';
    if (onBottom) return 's';
    if (p.x >= bed.x_cm && p.x <= right && p.y >= bed.y_cm && p.y <= bottom) return 'move';
    return null;
  }

  function findBedAt(p) {
    for (let i = displayBeds.length - 1; i >= 0; i--) {
      const b = displayBeds[i];
      const h = hitHandle(b, p);
      if (h) return { bed: b, handle: h };
    }
    return null;
  }

  function findPlantingAt(bed, localX, localY) {
    const list = plantingsByBed[bed.id] || [];
    let best = null;
    let bestD = PLANT_HIT_CM;
    for (const pl of list) {
      const d = Math.hypot(pl.x_cm - localX, pl.y_cm - localY);
      if (d <= bestD) {
        bestD = d;
        best = pl;
      }
    }
    return best;
  }

  function onPointerDown(evt) {
    evt.preventDefault();
    const p = toGardenCm(evt);
    const hit = findBedAt(p);
    if (!hit) {
      onSelectBed?.(null);
      return;
    }
    const { bed, handle } = hit;
    onSelectBed?.(bed.id);

    const localX = Math.max(0, Math.min(bed.width_cm, p.x - bed.x_cm));
    const localY = Math.max(0, Math.min(bed.length_cm, p.y - bed.y_cm));

    if (plantMode && handle === 'move') {
      const existing = findPlantingAt(bed, localX, localY);
      const now = Date.now();
      if (existing) {
        const same =
          lastPlantTap.current.id === existing.id &&
          now - lastPlantTap.current.t < DBL_MS;
        if (same) {
          lastPlantTap.current = { id: null, t: 0 };
          onRemovePlanting?.(existing.id);
        } else {
          lastPlantTap.current = { id: existing.id, t: now };
        }
        return;
      }
      lastPlantTap.current = { id: null, t: 0 };
      onPlantTap?.({ bedId: bed.id, x: localX, y: localY });
      return;
    }

    // resize handles always; move only when not planting
    if (handle === 'move' && plantMode) return;

    dragRef.current = {
      id: bed.id,
      handle,
      start: p,
      orig: {
        x_cm: bed.x_cm,
        y_cm: bed.y_cm,
        width_cm: bed.width_cm,
        length_cm: bed.length_cm,
      },
    };
    evt.currentTarget.setPointerCapture?.(evt.pointerId);
  }

  function onPointerMove(evt) {
    const drag = dragRef.current;
    if (!drag) return;
    const p = toGardenCm(evt);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const next = { ...drag.orig };

    if (drag.handle === 'move') {
      next.x_cm = Math.max(0, Math.min(garden.width_cm - next.width_cm, drag.orig.x_cm + dx));
      next.y_cm = Math.max(0, Math.min(garden.length_cm - next.length_cm, drag.orig.y_cm + dy));
    } else {
      if (drag.handle.includes('e')) {
        next.width_cm = Math.max(40, Math.min(garden.width_cm - drag.orig.x_cm, drag.orig.width_cm + dx));
      }
      if (drag.handle.includes('s')) {
        next.length_cm = Math.max(40, Math.min(garden.length_cm - drag.orig.y_cm, drag.orig.length_cm + dy));
      }
    }
    const patch = { id: drag.id, ...next };
    liveRef.current = patch;
    setLive(patch);
    onChangeBed?.(patch);
  }

  function onPointerUp() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const cur = liveRef.current;
    liveRef.current = null;
    setLive(null);
    if (cur && cur.id === drag.id) onCommitBed?.(cur);
  }

  return (
    <div className="garden-map-wrap">
      <svg
        ref={svgRef}
        className="garden-svg"
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{ touchAction: 'none' }}
      >
        <defs>
          <pattern id="grass" width="24" height="24" patternUnits="userSpaceOnUse">
            <rect width="24" height="24" fill="#d7e8cf" />
            <path d="M4 20c2-6 4-10 4-16M12 22c2-7 3-12 5-18M20 20c1-5 2-9 3-14" stroke="#b7cfa8" strokeWidth="1.5" fill="none" />
          </pattern>
        </defs>
        <rect x="0" y="0" width={W} height={H} fill="url(#grass)" stroke="#2f6b3a" strokeWidth="2" />

        {displayBeds.map((bed) => {
          const selected = bed.id === selectedId;
          const x = bed.x_cm * scale;
          const y = bed.y_cm * scale;
          const w = bed.width_cm * scale;
          const h = bed.length_cm * scale;
          const hs = Math.max(14, HANDLE * 0.55);
          const plantings = plantingsByBed[bed.id] || [];
          return (
            <g key={bed.id}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                rx="6"
                fill={selected ? 'rgba(196,92,38,0.22)' : 'rgba(92,64,40,0.28)'}
                stroke={selected ? '#c45c26' : '#5c4028'}
                strokeWidth={selected ? 3 : 2}
              />
              <text x={x + 8} y={y + 18} fontSize="13" fontWeight="700" fill="#1c2a1a" style={{ pointerEvents: 'none' }}>
                {bed.name}
              </text>
              <text x={x + 8} y={y + 34} fontSize="11" fill="#5a6b57" style={{ pointerEvents: 'none' }}>
                {Math.round(bed.width_cm)}×{Math.round(bed.length_cm)} cm
              </text>

              {plantings.map((pl) => {
                const r = Math.max(4, ((pl.spacing_cm || 20) / 2) * scale * 0.35);
                return (
                  <g key={pl.id} style={{ pointerEvents: 'none' }}>
                    <circle
                      cx={x + pl.x_cm * scale}
                      cy={y + pl.y_cm * scale}
                      r={Math.min(r, 18)}
                      fill="rgba(47,107,58,0.15)"
                      stroke="rgba(47,107,58,0.45)"
                      strokeDasharray="3 2"
                    />
                    <circle
                      cx={x + pl.x_cm * scale}
                      cy={y + pl.y_cm * scale}
                      r={6}
                      fill="#2f6b3a"
                      stroke="#fff"
                      strokeWidth="1.5"
                    />
                  </g>
                );
              })}

              <rect x={x + w - hs / 2} y={y + h / 2 - hs / 2} width={hs} height={hs} rx="4" fill={selected ? '#c45c26' : '#5c4028'} opacity="0.9" />
              <rect x={x + w / 2 - hs / 2} y={y + h - hs / 2} width={hs} height={hs} rx="4" fill={selected ? '#c45c26' : '#5c4028'} opacity="0.9" />
              <rect x={x + w - hs / 2} y={y + h - hs / 2} width={hs} height={hs} rx="4" fill={selected ? '#c45c26' : '#2f6b3a'} />
            </g>
          );
        })}
      </svg>
      <p className="garden-hint muted">
        {plantMode
          ? 'Tryck för att plantera · dubbeltryck på ett frö för att ta bort'
          : 'Dra bädden för att flytta · handtag för storlek'}
      </p>
    </div>
  );
}

/** Generate grid points for autofill based on recommended spacing. */
export function autofillPoints(bed, spacingCm) {
  const spacing = Math.max(10, Number(spacingCm) || 25);
  const margin = spacing / 2;
  const pts = [];
  for (let y = margin; y <= bed.length_cm - margin + 0.01; y += spacing) {
    for (let x = margin; x <= bed.width_cm - margin + 0.01; x += spacing) {
      pts.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
    }
  }
  // If bed too small for margin grid, put one in center
  if (!pts.length) {
    pts.push({ x: bed.width_cm / 2, y: bed.length_cm / 2 });
  }
  return pts;
}
