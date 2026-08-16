import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

export default function Seeds() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [seeds, setSeeds] = useState([]);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState('');
  const detailRef = useRef(null);

  useEffect(() => {
    api.seedCategories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api
        .seeds(q, category)
        .then((list) => {
          setSeeds(list);
          setSelected((prev) => (prev && list.some((s) => s.id === prev.id) ? list.find((s) => s.id === prev.id) : null));
        })
        .catch((e) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, category]);

  useEffect(() => {
    if (!selected) return;
    detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selected]);

  const totalLabel = useMemo(() => {
    if (category) {
      const c = categories.find((x) => x.name === category);
      return c ? `${c.count} fröer` : `${seeds.length} fröer`;
    }
    const sum = categories.reduce((a, c) => a + c.count, 0);
    return sum ? `${sum} fröer` : `${seeds.length} fröer`;
  }, [categories, category, seeds.length]);

  function toggleSeed(s) {
    setSelected((prev) => (prev?.id === s.id ? null : s));
  }

  return (
    <div className="card">
      <h2>Frökatalog</h2>
      <p className="muted">Välj kategori eller sök bland Plantagen-fröer ({totalLabel}).</p>

      <div className="chips category-chips" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`chip chip-btn${category === '' ? ' active' : ''}`}
          onClick={() => setCategory('')}
        >
          Alla
        </button>
        {categories.map((c) => (
          <button
            type="button"
            key={c.name}
            className={`chip chip-btn${category === c.name ? ' active' : ''}`}
            onClick={() => setCategory(c.name)}
          >
            {c.name} ({c.count})
          </button>
        ))}
      </div>

      <div className="field">
        <label>Sök</label>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="t.ex. tomat, alfalfa, basilika…"
        />
      </div>
      {err && <p className="muted">{err}</p>}
      <div className="seed-grid">
        {seeds.map((s) => (
          <Fragment key={s.id}>
            <article
              className={`seed-card${selected?.id === s.id ? ' selected' : ''}`}
              onClick={() => toggleSeed(s)}
            >
              {s.image_path ? (
                <img src={s.image_path} alt={s.name} />
              ) : (
                <div style={{ height: 120, background: '#dfe8d8', display: 'grid', placeItems: 'center' }}>🌱</div>
              )}
              <div className="body">
                <h4>{s.name}</h4>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {s.category || 'Frö'}
                </div>
              </div>
            </article>
            {selected?.id === s.id && (
              <div className="card seed-detail seed-detail-inline" ref={detailRef}>
                <SeedDetails seed={selected} onClose={() => setSelected(null)} />
              </div>
            )}
          </Fragment>
        ))}
      </div>
      {!seeds.length && !err && <p className="muted">Inga fröer matchade.</p>}
    </div>
  );
}

function SeedDetails({ seed, onClose }) {
  return (
    <>
      <div className="seed-detail-header">
        <h2>Detaljer</h2>
        <button type="button" className="btn secondary" onClick={onClose}>
          Stäng
        </button>
      </div>
      <h3>{seed.name}</h3>
      {seed.category && <p className="muted">{seed.category}</p>}
      {seed.image_path && (
        <img src={seed.image_path} alt="" style={{ width: '100%', maxWidth: 420, borderRadius: 12, marginBottom: 12 }} />
      )}
      {seed.description && <p className="seed-description">{seed.description}</p>}
      <div className="chips" style={{ marginBottom: 12 }}>
        {(seed.icons || []).slice(0, 8).map((ic, i) => (
          <span className="chip" key={i}>
            {ic.label}
          </span>
        ))}
      </div>
      <h4 className="detail-section">Odling</h4>
      <Fact label="Sol" value={seed.sun} />
      <Fact label="Vatten" value={seed.water} />
      <Fact label="Såtid" value={seed.sow_time} />
      <Fact label="Blomningstid" value={seed.bloom_time} />
      <Fact label="Radavstånd" value={fmtCm(seed.row_spacing_cm)} />
      <Fact label="Sådjup" value={fmtCm(seed.sow_depth_cm)} />
      <Fact label="Fullvuxen" value={fmtCm(seed.mature_height_cm)} />
      <Fact label="Vetenskapligt namn" value={seed.scientific_name} />

      <h4 className="detail-section">Egenskaper</h4>
      <Fact label="EAN" value={seed.ean} />
      <Fact label="Produktnummer" value={seed.sku} />
      <Fact label="Färg" value={seed.color} />
      <Fact label="Höjd" value={fmtCm(seed.pkg_height_cm)} />
      <Fact label="Bredd" value={fmtCm(seed.pkg_width_cm)} />
      <Fact label="Längd" value={fmtCm(seed.pkg_length_cm)} />
      <Fact label="Ursprungsland" value={seed.origin_country} />
      <Fact label="Varumärke" value={seed.brand} />

      {seed.source_url && (
        <p className="muted" style={{ marginTop: 12 }}>
          Källa:{' '}
          <a href={seed.source_url} target="_blank" rel="noreferrer">
            Plantagen
          </a>
        </p>
      )}
    </>
  );
}

function fmtCm(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return `${String(n).replace('.', ',')} cm`;
}

function Fact({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="list-item">
      <strong>{label}</strong>
      <div>{value}</div>
    </div>
  );
}
