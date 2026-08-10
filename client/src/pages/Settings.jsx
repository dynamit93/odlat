import { useEffect, useState } from 'react';
import { api } from '../api';

const PRESETS = [
  { name: 'Stockholm', lat: 59.3293, lon: 18.0686 },
  { name: 'Göteborg', lat: 57.7089, lon: 11.9746 },
  { name: 'Malmö', lat: 55.605, lon: 13.0038 },
  { name: 'Uppsala', lat: 59.8586, lon: 17.6389 },
  { name: 'Västerås', lat: 59.6099, lon: 16.5448 },
  { name: 'Hallstahammar', lat: 59.6137, lon: 16.2285 },
  { name: 'Enköping', lat: 59.6356, lon: 17.0778 },
  { name: 'Umeå', lat: 63.8258, lon: 20.263 },
];

export default function Settings() {
  const [form, setForm] = useState({
    weather_place: 'Stockholm',
    weather_lat: '59.3293',
    weather_lon: '18.0686',
    weather_last_fetch: '',
  });
  const [log, setLog] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.settings().then((s) => setForm((f) => ({ ...f, ...s }))).catch((e) => setLog(e.message));
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await api.saveSettings({
        weather_place: form.weather_place,
        weather_lat: form.weather_lat,
        weather_lon: form.weather_lon,
      });
      setForm((f) => ({ ...f, ...s }));
      setLog('Inställningar sparade och väder uppdaterat.');
    } catch (err) {
      setLog(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshWeather() {
    setBusy(true);
    try {
      const w = await api.refreshWeather();
      setForm((f) => ({
        ...f,
        weather_last_fetch: w.fetchedAt,
        climate_last_fetch: w.climate?.fetchedAt || f.climate_last_fetch,
        frost_date: w.climate?.climate?.frost_date_this_year || f.frost_date,
        winter_avg_min_c: w.climate?.climate?.winter_avg_min_c ?? f.winter_avg_min_c,
      }));
      setLog(`Väder & frost uppdaterat ${new Date(w.fetchedAt).toLocaleString('sv-SE')}`);
    } catch (err) {
      setLog(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function importSeeds() {
    setBusy(true);
    setLog('Importerar frökatalog från Plantagen…');
    try {
      const r = await api.importSeeds();
      setLog(`Import klar. Fröer i katalog: ${r.seedCount}\n${r.log || ''}`);
    } catch (err) {
      setLog(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid two">
      <form className="card" onSubmit={save}>
        <h2>Väderplats</h2>
        <p className="muted">
          Din sparade plats styr väder, frostberäkning och planteringsvarningar. Väder och klimat
          hämtas från Open-Meteo högst en gång per dygn (kl 03:00) och sparas lokalt.
        </p>
        <div className="field">
          <label>Förval</label>
          <select
            value={PRESETS.some((p) => p.name === form.weather_place) ? form.weather_place : ''}
            onChange={(e) => {
              const p = PRESETS.find((x) => x.name === e.target.value);
              if (!p) return;
              setForm({
                ...form,
                weather_place: p.name,
                weather_lat: String(p.lat),
                weather_lon: String(p.lon),
              });
            }}
          >
            <option value="">Välj stad…</option>
            {PRESETS.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Platsnamn</label>
          <input value={form.weather_place || ''} onChange={(e) => setForm({ ...form, weather_place: e.target.value })} />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Latitud</label>
            <input value={form.weather_lat || ''} onChange={(e) => setForm({ ...form, weather_lat: e.target.value })} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Longitud</label>
            <input value={form.weather_lon || ''} onChange={(e) => setForm({ ...form, weather_lon: e.target.value })} />
          </div>
        </div>
        <p className="muted">
          Senaste väderhämtning:{' '}
          {form.weather_last_fetch
            ? new Date(form.weather_last_fetch).toLocaleString('sv-SE')
            : 'aldrig'}
          {form.climate_last_fetch
            ? ` · klimat ${new Date(form.climate_last_fetch).toLocaleString('sv-SE')}`
            : ''}
        </p>
        {form.frost_date && (
          <p>
            Första höstfrost (beräknad för {form.weather_place}):{' '}
            <strong>
              {new Date(`${form.frost_date}T12:00:00`).toLocaleDateString('sv-SE', {
                day: 'numeric',
                month: 'long',
              })}
            </strong>
            {form.winter_avg_min_c != null ? ` · vintermedel min ${form.winter_avg_min_c}°C` : ''}
          </p>
        )}
        <div className="row">
          <button className="btn" type="submit" disabled={busy}>Spara plats</button>
          <button className="btn secondary" type="button" disabled={busy} onClick={refreshWeather}>
            Uppdatera väder & frost nu
          </button>
        </div>
      </form>

      <div className="card">
        <h2>Frökatalog</h2>
        <p className="muted">
          Importera fakta, bilder och ikoner från Plantagen frö-sidor till lokal cache.
        </p>
        <button className="btn" type="button" disabled={busy} onClick={importSeeds}>
          Uppdatera frökatalog
        </button>
        {log && (
          <pre style={{ whiteSpace: 'pre-wrap', marginTop: 16, fontSize: 13, color: 'var(--muted)' }}>
            {log}
          </pre>
        )}
      </div>
    </div>
  );
}
