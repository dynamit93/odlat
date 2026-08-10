import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import GardenMap, { autofillPoints } from '../components/GardenMap';

export default function Beds() {
  const [garden, setGarden] = useState({ width_cm: 1200, length_cm: 800 });
  const [beds, setBeds] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [plantingsByBed, setPlantingsByBed] = useState({});
  const [seeds, setSeeds] = useState([]);
  const [seedCategory, setSeedCategory] = useState('');
  const [seedCategories, setSeedCategories] = useState([]);
  const [plantMode, setPlantMode] = useState(true);
  const [form, setForm] = useState({ name: '', width_cm: 80, length_cm: 120 });
  const [plantForm, setPlantForm] = useState({
    seed_id: '',
    planted_at: new Date().toISOString().slice(0, 10),
    spacing_cm: '',
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState(null);

  const bed = useMemo(() => beds.find((b) => b.id === selectedId) || null, [beds, selectedId]);
  const plantings = plantingsByBed[selectedId] || [];
  const activeSeed = useMemo(
    () => seeds.find((s) => String(s.id) === String(plantForm.seed_id)) || null,
    [seeds, plantForm.seed_id]
  );
  const spacing =
    plantForm.spacing_cm !== ''
      ? Number(plantForm.spacing_cm)
      : activeSeed?.row_spacing_cm ?? 25;

  const seedsByCategory = useMemo(() => {
    const filtered = seedCategory
      ? seeds.filter((s) => s.category === seedCategory)
      : seeds;
    const map = new Map();
    for (const s of filtered) {
      const key = s.category || 'Övrigt';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'sv'));
  }, [seeds, seedCategory]);

  async function reload() {
    const g = await api.garden();
    setGarden({ width_cm: g.width_cm, length_cm: g.length_cm });
    setBeds(g.beds || []);
    const map = {};
    await Promise.all(
      (g.beds || []).map(async (b) => {
        map[b.id] = await api.plantings(b.id);
      })
    );
    setPlantingsByBed(map);
    if (selectedId && !(g.beds || []).some((b) => b.id === selectedId)) {
      setSelectedId(null);
    }
  }

  useEffect(() => {
    reload().catch((e) => setMsg(e.message));
    api.seedCategories().then(setSeedCategories).catch(() => {});
    api.seeds().then((list) => {
      setSeeds(list);
      if (list[0] && !plantForm.seed_id) {
        setPlantForm((f) => ({
          ...f,
          seed_id: String(list[0].id),
          spacing_cm: list[0].row_spacing_cm ?? '',
        }));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!plantForm.seed_id || !plantForm.planted_at) {
      setAdvice(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .plantingAdvice(plantForm.seed_id, plantForm.planted_at)
        .then(setAdvice)
        .catch(() => setAdvice(null));
    }, 250);
    return () => clearTimeout(t);
  }, [plantForm.seed_id, plantForm.planted_at]);

  async function createBed(e) {
    e.preventDefault();
    const b = await api.createBed({
      name: form.name,
      width_cm: Number(form.width_cm) || 80,
      length_cm: Number(form.length_cm) || 120,
    });
    setForm({ name: '', width_cm: 80, length_cm: 120 });
    await reload();
    setSelectedId(b.id);
    setMsg('Bädd skapad');
  }

  function onChangeBed(patch) {
    setBeds((list) => list.map((b) => (b.id === patch.id ? { ...b, ...patch } : b)));
  }

  async function onCommitBed(patch) {
    await api.updateBed(patch.id, {
      x_cm: patch.x_cm,
      y_cm: patch.y_cm,
      width_cm: patch.width_cm,
      length_cm: patch.length_cm,
    });
    await reload();
  }

  async function onPlantTap(point) {
    if (!plantForm.seed_id) {
      setMsg('Välj ett frö först');
      return;
    }
    setSelectedId(point.bedId);
    setBusy(true);
    try {
      await api.createPlanting({
        bed_id: point.bedId,
        seed_id: Number(plantForm.seed_id),
        planted_at: plantForm.planted_at,
        x_cm: point.x,
        y_cm: point.y,
        spacing_cm: spacing,
      });
      await reload();
      setMsg('Frö tillagt');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onRemovePlanting(id) {
    setBusy(true);
    try {
      await api.deletePlanting(id);
      await reload();
      setMsg('Frö borttaget');
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function autoFill() {
    if (!bed) {
      setMsg('Välj en bädd först');
      return;
    }
    if (!plantForm.seed_id) {
      setMsg('Välj ett frö först');
      return;
    }
    const pts = autofillPoints(bed, spacing);
    if (!confirm(`Fylla "${bed.name}" med ${pts.length} × ${activeSeed?.name || 'frö'} (avstånd ${spacing} cm)? Befintliga planteringar behålls.`)) {
      return;
    }
    setBusy(true);
    try {
      for (const pt of pts) {
        // skip if too close to existing
        const existing = plantingsByBed[bed.id] || [];
        const tooClose = existing.some(
          (p) => Math.hypot(p.x_cm - pt.x, p.y_cm - pt.y) < spacing * 0.85
        );
        if (tooClose) continue;
        await api.createPlanting({
          bed_id: bed.id,
          seed_id: Number(plantForm.seed_id),
          planted_at: plantForm.planted_at,
          x_cm: pt.x,
          y_cm: pt.y,
          spacing_cm: spacing,
        });
      }
      await reload();
      setMsg(`Autofyll klar (${pts.length} punkter)`);
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function clearBedPlantings() {
    if (!bed) return;
    const list = plantingsByBed[bed.id] || [];
    if (!list.length) return;
    if (!confirm(`Ta bort alla ${list.length} planteringar i "${bed.name}"?`)) return;
    setBusy(true);
    try {
      for (const p of list) await api.deletePlanting(p.id);
      await reload();
      setMsg('Bädden tömdes');
    } finally {
      setBusy(false);
    }
  }

  async function markWatered(id) {
    await api.updatePlanting(id, { last_watered_at: new Date().toISOString().slice(0, 10) });
    await reload();
  }

  async function removeBed() {
    if (!bed) return;
    if (!confirm(`Ta bort bädden "${bed.name}"?`)) return;
    await api.deleteBed(bed.id);
    setSelectedId(null);
    await reload();
  }

  return (
    <div className="grid beds-page">
      <div className="card garden-card">
        <div className="row beds-toolbar">
          <h2 style={{ margin: 0, flex: 1 }}>Trädgårdskarta</h2>
          <button
            type="button"
            className={`btn touch ${plantMode ? '' : 'secondary'}`}
            onClick={() => setPlantMode((v) => !v)}
          >
            {plantMode ? 'Plantera: PÅ' : 'Flytta bäddar'}
          </button>
        </div>
        <p className="muted">
          {plantMode
            ? 'Varje tryck i en bädd planterar valt frö. Dubbeltryck på ett frö för att ta bort.'
            : 'Dra och ändra storlek på bäddar. Slå på Plantera för att sätta fröer.'}
        </p>
        <GardenMap
          garden={garden}
          beds={beds}
          plantingsByBed={plantingsByBed}
          selectedId={selectedId}
          plantMode={plantMode}
          onSelectBed={setSelectedId}
          onChangeBed={onChangeBed}
          onCommitBed={onCommitBed}
          onPlantTap={onPlantTap}
          onRemovePlanting={onRemovePlanting}
        />
        {msg && <p className="muted">{msg}</p>}
      </div>

      <div className="grid beds-side">
        <div className="card">
          <h3>Aktivt frö</h3>
          <div className="field">
            <label>Kategori</label>
            <select
              className="touch-input"
              value={seedCategory}
              onChange={(e) => setSeedCategory(e.target.value)}
            >
              <option value="">Alla kategorier</option>
              {seedCategories.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Frö att plantera</label>
            <select
              className="touch-input"
              value={plantForm.seed_id}
              onChange={(e) => {
                const seed = seeds.find((s) => String(s.id) === e.target.value);
                setPlantForm({
                  ...plantForm,
                  seed_id: e.target.value,
                  spacing_cm: seed?.row_spacing_cm ?? '',
                });
                setPlantMode(true);
              }}
            >
              <option value="">Välj frö…</option>
              {seedsByCategory.map(([cat, list]) => (
                <optgroup key={cat} label={cat}>
                  {list.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.row_spacing_cm != null ? ` · ${s.row_spacing_cm} cm` : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Planteringsdatum</label>
            <input
              className="touch-input"
              type="date"
              value={plantForm.planted_at}
              onChange={(e) => setPlantForm({ ...plantForm, planted_at: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Rekommenderat avstånd (cm)</label>
            <input
              className="touch-input"
              type="number"
              inputMode="numeric"
              value={plantForm.spacing_cm}
              onChange={(e) => setPlantForm({ ...plantForm, spacing_cm: e.target.value })}
            />
          </div>
          {activeSeed && (
            <div className="chips">
              {activeSeed.sun && <span className="chip">{activeSeed.sun}</span>}
              {activeSeed.water && <span className="chip">{activeSeed.water}</span>}
            </div>
          )}
          {advice?.alert && (
            <div className={`alert alert-${advice.alert.level}`} role="status">
              <strong>{advice.alert.title}</strong>
              <p>{advice.alert.message}</p>
              <p className="muted" style={{ marginBottom: 0, fontSize: '0.85rem' }}>
                Plats: {advice.placeName}
                {advice.climate?.frostDate ? ` · första frost ca ${advice.climate.frostDate}` : ''}
                {advice.alert.harvestFrom
                  ? ` · skörd ${advice.alert.harvestFrom}–${advice.alert.harvestTo}`
                  : ''}
              </p>
            </div>
          )}
        </div>

        <form className="card" onSubmit={createBed}>
          <h3>Ny odlingsbädd</h3>
          <div className="field">
            <label>Namn</label>
            <input
              className="touch-input"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="t.ex. Tomater"
            />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Bredd (cm)</label>
              <input
                className="touch-input"
                type="number"
                inputMode="numeric"
                value={form.width_cm}
                onChange={(e) => setForm({ ...form, width_cm: e.target.value })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Längd (cm)</label>
              <input
                className="touch-input"
                type="number"
                inputMode="numeric"
                value={form.length_cm}
                onChange={(e) => setForm({ ...form, length_cm: e.target.value })}
              />
            </div>
          </div>
          <button className="btn touch" type="submit">Lägg till bädd</button>
        </form>

        {bed && (
          <div className="card">
            <h3>{bed.name}</h3>
            <p className="muted">
              {Math.round(bed.width_cm)} × {Math.round(bed.length_cm)} cm · {plantings.length} fröer
            </p>
            <div className="row" style={{ marginBottom: 8 }}>
              <button type="button" className="btn touch" disabled={busy || !plantForm.seed_id} onClick={autoFill}>
                Autofyll bädd
              </button>
              <button type="button" className="btn secondary touch" disabled={busy || !plantings.length} onClick={clearBedPlantings}>
                Töm fröer
              </button>
            </div>
            <p className="muted" style={{ fontSize: '0.9rem' }}>
              Autofyll använder rekommenderat avstånd ({spacing} cm) i ett rutnät.
            </p>
            <button type="button" className="btn danger touch" onClick={removeBed}>
              Ta bort bädd
            </button>
          </div>
        )}

        <div className="card">
          <h3>Planteringar {bed ? `i ${bed.name}` : ''}</h3>
          {!bed && <p className="muted">Välj en bädd på kartan.</p>}
          {bed && !plantings.length && <p className="muted">Inga ännu — tryck i bädden eller autofyll.</p>}
          {plantings.map((p) => (
            <div className="list-item" key={p.id}>
              <strong>{p.seed?.name || p.custom_name}</strong>
              <div className="muted">
                Planterad {p.planted_at} · avstånd {p.spacing_cm ?? '–'} cm
              </div>
              {p.harvest && (
                <div className="muted">Skörd ca {p.harvest.from} – {p.harvest.to}</div>
              )}
              {p.frostAlert && p.frostAlert.level !== 'ok' && (
                <div className={`alert alert-${p.frostAlert.level}`} style={{ marginTop: 8 }}>
                  <strong>{p.frostAlert.title}</strong>
                </div>
              )}
              <div className={`status-${p.watering?.status}`}>{p.watering?.message}</div>
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="btn secondary touch" onClick={() => markWatered(p.id)}>
                  Vattnad
                </button>
                <button type="button" className="btn danger touch" onClick={() => onRemovePlanting(p.id)}>
                  Ta bort
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
