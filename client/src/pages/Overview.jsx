import { useEffect, useState } from 'react';
import { api } from '../api';

const WMO = {
  0: 'Klart',
  1: 'Mestadels klart',
  2: 'Delvis molnigt',
  3: 'Mulet',
  45: 'Dimma',
  48: 'Dimma',
  51: 'Duggregn',
  61: 'Regn',
  63: 'Regn',
  65: 'Kraftigt regn',
  71: 'Snö',
  80: 'Skurar',
  95: 'Åska',
};

export default function Overview() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.overview().then(setData).catch((e) => setErr(e.message));
  }, []);

  if (err) return <div className="card">Kunde inte ladda översikt: {err}</div>;
  if (!data) return <div className="card">Laddar…</div>;

  const daily = data.weather?.forecast?.daily;
  const days = daily?.time?.map((t, i) => ({
    date: t,
    max: daily.temperature_2m_max?.[i],
    min: daily.temperature_2m_min?.[i],
    rain: daily.precipitation_sum?.[i],
    code: daily.weathercode?.[i],
  })) || [];

  const frostDate = data.climate?.climate?.frost_date_this_year;
  const place = data.placeName || data.weather?.placeName || 'okänd plats';

  return (
    <div className="grid">
      <section className="hero-panel">
        <h1>Din trädgård idag</h1>
        <p>
          Väder för {place}
          {data.weather?.fetchedAt
            ? ` · uppdaterat ${new Date(data.weather.fetchedAt).toLocaleString('sv-SE')}`
            : ' · ingen cache ännu'}
          {frostDate ? ` · första frost ca ${frostDate}` : ''}
        </p>
      </section>

      <div className="grid two">
        <div className="card">
          <h2>Väder (7 dagar)</h2>
          {!days.length && <p className="muted">Ingen väderdata. Uppdatera under Inställningar.</p>}
          {days.map((d) => (
            <div className="list-item" key={d.date}>
              <strong>{new Date(d.date).toLocaleDateString('sv-SE', { weekday: 'short', day: 'numeric', month: 'short' })}</strong>
              <div className="muted">
                {WMO[d.code] || 'Väder'} · {Math.round(d.min)}–{Math.round(d.max)}°C · regn {d.rain ?? 0} mm
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Frost & skörd</h2>
          {frostDate ? (
            <p>
              I <strong>{place}</strong> brukar första höstfrosten komma ca{' '}
              <strong>{new Date(`${frostDate}T12:00:00`).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long' })}</strong>
              {data.climate?.climate?.winter_avg_min_c != null
                ? ` · vintermedel min ${data.climate.climate.winter_avg_min_c}°C`
                : ''}
              .
            </p>
          ) : (
            <p className="muted">Klimatdata hämtas… Spara din plats under Inställningar.</p>
          )}
          {!!data.frostRisks?.length && (
            <>
              <h3 style={{ marginTop: 12 }}>Varningar</h3>
              {data.frostRisks.slice(0, 6).map((p) => (
                <div className={`alert alert-${p.frostAlert.level}`} key={p.id} style={{ marginTop: 8 }}>
                  <strong>{p.seed?.name || p.custom_name}</strong>
                  <p>{p.frostAlert.title}</p>
                </div>
              ))}
            </>
          )}
          {!data.frostRisks?.length && <p className="muted">Inga frostvarningar för dina planteringar.</p>}
        </div>

        <div className="card">
          <h2>Vattna snart</h2>
          {!data.waterSoon?.length && <p className="muted">Inga planteringar ännu.</p>}
          {data.waterSoon?.slice(0, 8).map((p) => (
            <div className="list-item" key={p.id}>
              <strong>{p.seed?.name || p.custom_name || `Plantering #${p.id}`}</strong>
              <div className={`status-${p.watering?.status}`}>{p.watering?.message}</div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Skördefönster</h2>
          {!data.harvestSoon?.length && <p className="muted">Inga skördedatum beräknade ännu.</p>}
          {data.harvestSoon?.slice(0, 8).map((p) => (
            <div className="list-item" key={p.id}>
              <strong>{p.seed?.name || p.custom_name || `Plantering #${p.id}`}</strong>
              <div className="muted">
                Ca {p.harvest?.from} – {p.harvest?.to}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
