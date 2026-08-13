import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const HANDLE = 28;
const PLANT_HIT_CM = 22;
const HOVER_HIT_CM = 40;
const DBL_MS = 350;
const TAP_PX = 22;
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function touchPoint(t) {
  return { x: t.clientX, y: t.clientY };
}

/**
 * Whole-garden map. Pinch-zoom uses native touch + SVG viewBox (Samsung-safe).
 * Plant mode: tap adds a seed; double-tap a seed removes it.
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
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const liveRef = useRef(null);
  const lastPlantTap = useRef({ id: null, t: 0 });
  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const tapRef = useRef(null);
  const ignoreTapRef = useRef(false);
  const pinnedRef = useRef(false);
  const viewRef = useRef({ k: 1, x: 0, y: 0 });
  const [live, setLive] = useState(null);
  const [hover, setHover] = useState(null);
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });

  const scale = useMemo(() => {
    const maxW = typeof window !== 'undefined' ? Math.min(window.innerWidth - 32, 920) : 900;
    return Math.min(maxW / garden.width_cm, 1.1);
  }, [garden.width_cm]);

  const W = garden.width_cm * scale;
  const H = garden.length_cm * scale;
  const handleCm = HANDLE / scale;
  const vbW = W / view.k;
  const vbH = H / view.k;

  const displayBeds = useMemo(() => {
    return beds.map((b) => (live && live.id === b.id ? { ...b, ...live } : b));
  }, [beds, live]);

  const layoutRef = useRef({ W, H, scale, garden });
  layoutRef.current = { W, H, scale, garden };

  const actionRef = useRef({});
  actionRef.current = {
    plantMode,
    displayBeds,
    plantingsByBed,
    handleCm,
    onSelectBed,
    onChangeBed,
    onCommitBed,
    onPlantTap,
    onRemovePlanting,
  };

  const toGardenCm = useCallback(
    (clientX, clientY) => {
      const svg = svgRef.current;
      const { W: w, H: h, scale: sc, garden: g } = layoutRef.current;
      const cam = viewRef.current;
      if (!svg) return { x: 0, y: 0 };
      const box = svg.getBoundingClientRect();
      if (!box.width || !box.height) return { x: 0, y: 0 };
      const userX = cam.x + ((clientX - box.left) / box.width) * (w / cam.k);
      const userY = cam.y + ((clientY - box.top) / box.height) * (h / cam.k);
      return {
        x: Math.min(g.width_cm, Math.max(0, userX / sc)),
        y: Math.min(g.length_cm, Math.max(0, userY / sc)),
      };
    },
    []
  );

  function clampCam(next) {
    const { W: w, H: h } = layoutRef.current;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.k));
    const vw = w / k;
    const vh = h / k;
    return {
      k,
      x: Math.min(Math.max(0, next.x), Math.max(0, w - vw)),
      y: Math.min(Math.max(0, next.y), Math.max(0, h - vh)),
    };
  }

  function commitView(next) {
    const clamped = clampCam(next);
    viewRef.current = clamped;
    setView(clamped);
  }

  function clientToUser(clientX, clientY, cam) {
    const svg = svgRef.current;
    const { W: w, H: h } = layoutRef.current;
    if (!svg) return { x: 0, y: 0 };
    const box = svg.getBoundingClientRect();
    if (!box.width || !box.height) return { x: 0, y: 0 };
    return {
      x: cam.x + ((clientX - box.left) / box.width) * (w / cam.k),
      y: cam.y + ((clientY - box.top) / box.height) * (h / cam.k),
    };
  }

  function hitHandle(bed, p, near) {
    const right = bed.x_cm + bed.width_cm;
    const bottom = bed.y_cm + bed.length_cm;
    const onRight = Math.abs(p.x - right) <= near && p.y >= bed.y_cm - near && p.y <= bottom + near;
    const onBottom = Math.abs(p.y - bottom) <= near && p.x >= bed.x_cm - near && p.x <= right + near;
    if (onRight && onBottom) return 'se';
    if (onRight) return 'e';
    if (onBottom) return 's';
    if (p.x >= bed.x_cm && p.x <= right && p.y >= bed.y_cm && p.y <= bottom) return 'move';
    return null;
  }

  function findBedAt(p) {
    const near = actionRef.current.handleCm * 1.1;
    const list = actionRef.current.displayBeds;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      const h = hitHandle(b, p, near);
      if (h) return { bed: b, handle: h };
    }
    return null;
  }

  function findPlantingAt(bed, localX, localY, radius = PLANT_HIT_CM) {
    const list = actionRef.current.plantingsByBed[bed.id] || [];
    let best = null;
    let bestD = radius;
    for (const pl of list) {
      const d = Math.hypot(pl.x_cm - localX, pl.y_cm - localY);
      if (d <= bestD) {
        bestD = d;
        best = pl;
      }
    }
    return best;
  }

  function findPlantingInGarden(p, radius = HOVER_HIT_CM) {
    const list = actionRef.current.displayBeds;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (
        p.x < b.x_cm - radius ||
        p.x > b.x_cm + b.width_cm + radius ||
        p.y < b.y_cm - radius ||
        p.y > b.y_cm + b.length_cm + radius
      ) {
        continue;
      }
      const hit = findPlantingAt(b, p.x - b.x_cm, p.y - b.y_cm, radius);
      if (hit) return { planting: hit, bed: b };
    }
    return null;
  }

  function tooltipPos(planting, bed) {
    const svg = svgRef.current;
    const cam = viewRef.current;
    const { W: w, H: h, scale: sc } = layoutRef.current;
    if (!svg) return { left: 8, top: 8, flipDown: false };
    const box = svg.getBoundingClientRect();
    const userX = (bed.x_cm + planting.x_cm) * sc;
    const userY = (bed.y_cm + planting.y_cm) * sc;
    const px = box.left + ((userX - cam.x) / (w / cam.k)) * box.width;
    const py = box.top + ((userY - cam.y) / (h / cam.k)) * box.height;
    return {
      left: Math.max(8, Math.min(window.innerWidth - 248, px + 10)),
      top: py,
      flipDown: py < 120,
    };
  }

  function pinTooltip(planting, bed) {
    pinnedRef.current = true;
    setHover({ planting, pinned: true, ...tooltipPos(planting, bed) });
  }

  function clearTooltip() {
    pinnedRef.current = false;
    setHover(null);
  }

  function setHoverFromPoint(p) {
    if (pinnedRef.current) return;
    const hit = findPlantingInGarden(p);
    setHover((prev) => {
      if (!hit) return prev ? null : prev;
      if (prev?.planting?.id === hit.planting.id) return prev;
      return { planting: hit.planting, ...tooltipPos(hit.planting, hit.bed) };
    });
  }

  function beginPinch(a, b) {
    dragRef.current = null;
    panRef.current = null;
    tapRef.current = null;
    ignoreTapRef.current = true;
    pinnedRef.current = false;
    setHover(null);
    const m = mid(a, b);
    const cam = viewRef.current;
    pinchRef.current = {
      d0: Math.max(8, dist(a, b)),
      k0: cam.k,
      user0: clientToUser(m.x, m.y, cam),
    };
  }

  function movePinch(a, b) {
    const pinch = pinchRef.current;
    if (!pinch) return;
    const d = dist(a, b);
    if (d < 8) return;
    const m = mid(a, b);
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.k0 * (d / pinch.d0)));
    const { W: w, H: h } = layoutRef.current;
    const svg = svgRef.current;
    if (!svg) return;
    const box = svg.getBoundingClientRect();
    const vw = w / k;
    const vh = h / k;
    commitView({
      k,
      x: pinch.user0.x - ((m.x - box.left) / box.width) * vw,
      y: pinch.user0.y - ((m.y - box.top) / box.height) * vh,
    });
  }

  function zoomBy(factor) {
    const cam = viewRef.current;
    const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.k * factor));
    const { W: w, H: h } = layoutRef.current;
    const cx = cam.x + w / cam.k / 2;
    const cy = cam.y + h / cam.k / 2;
    commitView({ k, x: cx - w / k / 2, y: cy - h / k / 2 });
  }

  function resetZoom() {
    commitView({ k: 1, x: 0, y: 0 });
  }

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const onTouchStart = (e) => {
      if (e.touches.length >= 2) {
        beginPinch(touchPoint(e.touches[0]), touchPoint(e.touches[1]));
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length >= 2) {
        e.preventDefault();
        if (!pinchRef.current) {
          beginPinch(touchPoint(e.touches[0]), touchPoint(e.touches[1]));
        }
        movePinch(touchPoint(e.touches[0]), touchPoint(e.touches[1]));
      } else if (pinchRef.current) {
        e.preventDefault();
      }
    };

    const onTouchEnd = (e) => {
      if (e.touches.length < 2) pinchRef.current = null;
      if (e.touches.length !== 0) return;
      panRef.current = null;
      const skipped = ignoreTapRef.current;
      ignoreTapRef.current = false;
      if (skipped) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const start = tapRef.current;
      if (start && dist({ x: t.clientX, y: t.clientY }, start) > TAP_PX) return;
      const p = toGardenCm(t.clientX, t.clientY);
      const hit = findBedAt(p);
      if (!hit) {
        clearTooltip();
        return;
      }
      const localX = Math.max(0, Math.min(hit.bed.width_cm, p.x - hit.bed.x_cm));
      const localY = Math.max(0, Math.min(hit.bed.length_cm, p.y - hit.bed.y_cm));
      const existing = findPlantingAt(hit.bed, localX, localY, HOVER_HIT_CM);
      if (existing) pinTooltip(existing, hit.bed);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  function onPointerDown(evt) {
    if (pinchRef.current || (evt.pointerType === 'touch' && evt.isPrimary === false)) return;

    tapRef.current = { x: evt.clientX, y: evt.clientY, pointerId: evt.pointerId };
    const p = toGardenCm(evt.clientX, evt.clientY);
    const hit = findBedAt(p);
    if (!hit) {
      clearTooltip();
      actionRef.current.onSelectBed?.(null);
      if (viewRef.current.k > 1.02) {
        panRef.current = {
          startX: evt.clientX,
          startY: evt.clientY,
          cam0: { ...viewRef.current },
        };
      }
      return;
    }
    const { bed, handle } = hit;
    actionRef.current.onSelectBed?.(bed.id);

    const localX = Math.max(0, Math.min(bed.width_cm, p.x - bed.x_cm));
    const localY = Math.max(0, Math.min(bed.length_cm, p.y - bed.y_cm));
    const existing = findPlantingAt(bed, localX, localY, HOVER_HIT_CM);
    if (existing) {
      pinTooltip(existing, bed);
      tapRef.current = { ...tapRef.current, type: 'seed', planting: existing, bed };
      return;
    }

    if (actionRef.current.plantMode && handle === 'move') {
      clearTooltip();
      tapRef.current = { ...tapRef.current, type: 'plant', bedId: bed.id, x: localX, y: localY };
      return;
    }

    if (handle === 'move' && actionRef.current.plantMode) return;

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
    clearTooltip();
  }

  function onPointerMove(evt) {
    if (pinchRef.current) return;
    if (evt.pointerType === 'touch' && evt.isPrimary === false) return;

    const tap = tapRef.current;
    if (tap && dist({ x: evt.clientX, y: evt.clientY }, tap) > TAP_PX) {
      if (viewRef.current.k > 1.02) {
        panRef.current = {
          startX: tap.x,
          startY: tap.y,
          cam0: { ...viewRef.current },
        };
        tapRef.current = null;
      } else if (tap.type === 'plant') {
        tapRef.current = null;
      }
    }

    const pan = panRef.current;
    if (pan) {
      ignoreTapRef.current = true;
      const svg = svgRef.current;
      if (svg) {
        const box = svg.getBoundingClientRect();
        const { W: w, H: h } = layoutRef.current;
        const k = pan.cam0.k;
        commitView({
          k,
          x: pan.cam0.x - ((evt.clientX - pan.startX) / box.width) * (w / k),
          y: pan.cam0.y - ((evt.clientY - pan.startY) / box.height) * (h / k),
        });
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag) {
      if (evt.pointerType !== 'touch') setHoverFromPoint(toGardenCm(evt.clientX, evt.clientY));
      return;
    }
    if (!pinnedRef.current) setHover(null);
    const p = toGardenCm(evt.clientX, evt.clientY);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const next = { ...drag.orig };
    const { garden: g } = layoutRef.current;

    if (drag.handle === 'move') {
      next.x_cm = Math.max(0, Math.min(g.width_cm - next.width_cm, drag.orig.x_cm + dx));
      next.y_cm = Math.max(0, Math.min(g.length_cm - next.length_cm, drag.orig.y_cm + dy));
    } else {
      if (drag.handle.includes('e')) {
        next.width_cm = Math.max(40, Math.min(g.width_cm - drag.orig.x_cm, drag.orig.width_cm + dx));
      }
      if (drag.handle.includes('s')) {
        next.length_cm = Math.max(40, Math.min(g.length_cm - drag.orig.y_cm, drag.orig.length_cm + dy));
      }
    }
    const patch = { id: drag.id, ...next };
    liveRef.current = patch;
    setLive(patch);
    actionRef.current.onChangeBed?.(patch);
  }

  function onPointerLeave() {
    if (dragRef.current || pinchRef.current || pinnedRef.current) return;
    setHover(null);
  }

  function finishDrag() {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    const cur = liveRef.current;
    liveRef.current = null;
    setLive(null);
    if (cur && cur.id === drag.id) actionRef.current.onCommitBed?.(cur);
  }

  function onPointerCancel() {
    finishDrag();
    panRef.current = null;
  }

  function onPointerUp(evt) {
    if (evt.pointerType === 'touch' && evt.isPrimary === false) return;
    panRef.current = null;
    finishDrag();

    const tap = tapRef.current;
    tapRef.current = null;
    const skip = ignoreTapRef.current || !!pinchRef.current;
    if (skip || !tap || tap.pointerId !== evt.pointerId) return;
    if (dist({ x: evt.clientX, y: evt.clientY }, tap) > TAP_PX) return;

    if (tap.type === 'seed' && tap.planting) {
      const now = Date.now();
      const same = lastPlantTap.current.id === tap.planting.id && now - lastPlantTap.current.t < DBL_MS;
      if (same) {
        lastPlantTap.current = { id: null, t: 0 };
        clearTooltip();
        actionRef.current.onRemovePlanting?.(tap.planting.id);
      } else {
        lastPlantTap.current = { id: tap.planting.id, t: now };
        const bed = tap.bed || findBedForPlanting(tap.planting);
        if (bed) pinTooltip(tap.planting, bed);
      }
      return;
    }

    if (tap.type === 'plant') {
      lastPlantTap.current = { id: null, t: 0 };
      actionRef.current.onPlantTap?.({ bedId: tap.bedId, x: tap.x, y: tap.y });
    }
  }

  function findBedForPlanting(planting) {
    return actionRef.current.displayBeds.find((b) => b.id === planting.bed_id) || null;
  }

  const hovered = hover?.planting;
  const frost = hovered?.frostAlert;
  const zoomed = view.k > 1.05;

  return (
    <div className="garden-map-wrap" onPointerLeave={onPointerLeave}>
      <div
        className="garden-map-viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <svg
          ref={svgRef}
          className="garden-svg"
          width={W}
          height={H}
          viewBox={`${view.x} ${view.y} ${vbW} ${vbH}`}
          style={{ cursor: hovered ? 'pointer' : undefined }}
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
                  const active = hovered?.id === pl.id;
                  const warn = pl.frostAlert && pl.frostAlert.level !== 'ok';
                  const fill = warn ? '#c45c26' : '#2f6b3a';
                  const cx = x + pl.x_cm * scale;
                  const cy = y + pl.y_cm * scale;
                  return (
                    <g key={pl.id}>
                      <circle cx={cx} cy={cy} r={Math.max(16, Math.min(r, 22))} fill="transparent" />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={Math.min(r, 18)}
                        fill={warn ? 'rgba(196,92,38,0.16)' : 'rgba(47,107,58,0.15)'}
                        stroke={active ? fill : warn ? 'rgba(196,92,38,0.55)' : 'rgba(47,107,58,0.45)'}
                        strokeDasharray="3 2"
                      />
                      <circle
                        cx={cx}
                        cy={cy}
                        r={active ? 8 : 6}
                        fill={fill}
                        stroke="#fff"
                        strokeWidth={active ? 2.5 : 1.5}
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
      </div>
      <div className="garden-zoom-bar">
        <button type="button" className="garden-zoom-btn" onClick={() => zoomBy(1 / 1.4)} aria-label="Zooma ut">
          −
        </button>
        <button type="button" className="garden-zoom-btn" onClick={() => zoomBy(1.4)} aria-label="Zooma in">
          +
        </button>
        {zoomed && (
          <button type="button" className="garden-zoom-reset" onClick={resetZoom}>
            Återställ zoom
          </button>
        )}
      </div>
      {hovered && (
        <div
          className={`planting-tooltip${frost && frost.level !== 'ok' ? ` alert-${frost.level}` : ''}`}
          role="status"
          style={{
            left: hover.left,
            top: hover.top,
            transform: hover.flipDown ? 'translateY(12px)' : 'translateY(calc(-100% - 12px))',
          }}
        >
          <strong>{hovered.seed?.name || hovered.custom_name || `Frö #${hovered.id}`}</strong>
          <p>Sådd {fmtDate(hovered.planted_at)}</p>
          {hovered.harvest?.from && (
            <p>
              Skörd ca {fmtDate(hovered.harvest.from)} – {fmtDate(hovered.harvest.to)}
            </p>
          )}
          {hovered.watering?.message && (
            <p className={`status-${hovered.watering.status}`}>{hovered.watering.message}</p>
          )}
          {frost && <p className="planting-tooltip-alert">{frost.title}</p>}
        </div>
      )}
      <p className="garden-hint muted">
        {plantMode
          ? 'Nyp eller +/− för att zooma · tryck på ett frö för info · dubbeltryck för att ta bort'
          : 'Nyp eller +/− för att zooma · dra bädden för att flytta'}
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
  if (!pts.length) {
    pts.push({ x: bed.width_cm / 2, y: bed.length_cm / 2 });
  }
  return pts;
}
