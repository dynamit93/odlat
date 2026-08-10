import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

export default function Seeds() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState([]);
  const [seeds, setSeeds] = useState([]);
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState('');

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

  const totalLabel = useMemo(() => {
    if (category) {
      const c = categories.find((x) => x.name === category);
      return c ? `${c.count} fröer` : `${seeds.length} fröer`;
    }
    const sum = categories.reduce((a, c) => a + c.count, 0);
    return sum ? `${sum} fröer` : `${seeds.length} fröer`;
  }, [categories, category, seeds.length]);

  return (
    <div className="layout-split">
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
            <article
              className={`seed-card${selected?.id === s.id ? ' selected' : ''}`}
              key={s.id}
              onClick={() => setSelected(s)}
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
          ))}
        </div>
        {!seeds.length && !err && <p className="muted">Inga fröer matchade.</p>}
      </div>

      <div className="card seed-detail">
        <h2>Detaljer</h2>
        {!selected && <p className="muted">Välj ett frö för att se odlingsfakta.</p>}
        {selected && (
          <>
            <h3>{selected.name}</h3>
            {selected.category && <p className="muted">{selected.category}</p>}
            {selected.image_path && (
              <img src={selected.image_path} alt="" style={{ width: '100%', borderRadius: 12, marginBottom: 12 }} />
            )}
            {selected.description && <p className="seed-description">{selected.description}</p>}
            <div className="chips" style={{ marginBottom: 12 }}>
              {(selected.icons || []).slice(0, 8).map((ic, i) => (
                <span className="chip" key={i}>
                  {ic.label}
                </span>
              ))}
            </div>
            <h4 className="detail-section">Odling</h4>
            <Fact label="Sol" value={selected.sun} />
            <Fact label="Vatten" value={selected.water} />
            <Fact label="Såtid" value={selected.sow_time} />
            <Fact label="Blomningstid" value={selected.bloom_time} />
            <Fact label="Radavstånd" value={fmtCm(selected.row_spacing_cm)} />
            <Fact label="Sådjup" value={fmtCm(selected.sow_depth_cm)} />
            <Fact label="Fullvuxen" value={fmtCm(selected.mature_height_cm)} />
            <Fact label="Vetenskapligt namn" value={selected.scientific_name} />

            <h4 className="detail-section">Egenskaper</h4>
            <Fact label="EAN" value={selected.ean} />
            <Fact label="Produktnummer" value={selected.sku} />
            <Fact label="Färg" value={selected.color} />
            <Fact label="Höjd" value={fmtCm(selected.pkg_height_cm)} />
            <Fact label="Bredd" value={fmtCm(selected.pkg_width_cm)} />
            <Fact label="Längd" value={fmtCm(selected.pkg_length_cm)} />
            <Fact label="Ursprungsland" value={selected.origin_country} />
            <Fact label="Varumärke" value={selected.brand} />

            {selected.source_url && (
              <p className="muted" style={{ marginTop: 12 }}>
                Källa:{' '}
                <a href={selected.source_url} target="_blank" rel="noreferrer">
                  Plantagen
                </a>
              </p>
            )}
          </>
        )}
      </div>
    </div>
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
