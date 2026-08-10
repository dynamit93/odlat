/**
 * Climate / frost estimates from Open-Meteo historical archive.
 * Cached once per day per place (lat/lon) so we do not hit the API constantly.
 */
const fetch = require('node-fetch');
const { db, getSetting, setSetting } = require('./db');

const FROST_THRESHOLD_C = 2; // first cool night that risks tomatoes / tender crops
const HISTORY_YEARS = 10;

db.exec(`
CREATE TABLE IF NOT EXISTS climate_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  place_name TEXT,
  payload_json TEXT NOT NULL
);
`);

function roundCoord(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function medianDateOfYear(isoDates) {
  if (!isoDates.length) return null;
  const doys = isoDates
    .map((iso) => {
      const d = new Date(`${iso}T12:00:00`);
      const start = new Date(d.getFullYear(), 0, 0);
      return Math.round((d - start) / 86400000);
    })
    .sort((a, b) => a - b);
  const mid = doys[Math.floor(doys.length / 2)];
  const year = new Date().getFullYear();
  const d = new Date(year, 0, mid);
  return d.toISOString().slice(0, 10);
}

function firstAutumnFrost(dates, mins, year) {
  // Sept 1 – Dec 31
  for (let i = 0; i < dates.length; i++) {
    const iso = dates[i];
    if (!iso.startsWith(String(year))) continue;
    const month = Number(iso.slice(5, 7));
    if (month < 9) continue;
    const t = Number(mins[i]);
    if (Number.isFinite(t) && t <= FROST_THRESHOLD_C) return iso;
  }
  return null;
}

async function fetchHistoricalMins(lat, lon) {
  const endYear = new Date().getFullYear() - 1;
  const startYear = endYear - (HISTORY_YEARS - 1);
  const url =
    `https://archive-api.open-meteo.com/v1/archive` +
    `?latitude=${lat}&longitude=${lon}` +
    `&start_date=${startYear}-01-01&end_date=${endYear}-12-31` +
    `&daily=temperature_2m_min&timezone=Europe%2FStockholm`;
  const res = await fetch(url, { timeout: 60000 });
  if (!res.ok) throw new Error(`Open-Meteo archive HTTP ${res.status}`);
  return res.json();
}

function buildClimatePayload(archive, place) {
  const dates = archive?.daily?.time || [];
  const mins = archive?.daily?.temperature_2m_min || [];
  const endYear = new Date().getFullYear() - 1;
  const startYear = endYear - (HISTORY_YEARS - 1);
  const yearly = [];
  for (let y = startYear; y <= endYear; y++) {
    const frost = firstAutumnFrost(dates, mins, y);
    if (frost) yearly.push({ year: y, first_frost: frost });
  }
  const frostDates = yearly.map((y) => y.first_frost);
  const frost_date_this_year = medianDateOfYear(frostDates);
  const frost_mmdd = frost_date_this_year
    ? frost_date_this_year.slice(5)
    : '10-14';

  // Simple winter outlook: avg Dec–Feb min over history
  let winterSum = 0;
  let winterN = 0;
  for (let i = 0; i < dates.length; i++) {
    const m = Number(dates[i].slice(5, 7));
    if (m === 12 || m === 1 || m === 2) {
      const t = Number(mins[i]);
      if (Number.isFinite(t)) {
        winterSum += t;
        winterN++;
      }
    }
  }
  const winter_avg_min_c = winterN ? Math.round((winterSum / winterN) * 10) / 10 : null;

  return {
    place_name: place,
    frost_threshold_c: FROST_THRESHOLD_C,
    history_years: HISTORY_YEARS,
    yearly_first_frost: yearly,
    frost_date_median_mmdd: frost_mmdd,
    frost_date_this_year: frost_date_this_year || `${new Date().getFullYear()}-10-14`,
    winter_avg_min_c,
    source: 'open-meteo-archive',
  };
}

function getCachedClimate() {
  const row = db.prepare('SELECT * FROM climate_cache WHERE id = 1').get();
  if (!row) return null;
  return {
    fetchedAt: row.fetched_at,
    latitude: row.latitude,
    longitude: row.longitude,
    placeName: row.place_name,
    climate: JSON.parse(row.payload_json),
  };
}

function cacheIsFresh(row, lat, lon) {
  if (!row) return false;
  if (roundCoord(row.latitude) !== roundCoord(lat)) return false;
  if (roundCoord(row.longitude) !== roundCoord(lon)) return false;
  const ageMs = Date.now() - new Date(row.fetched_at).getTime();
  return ageMs < 20 * 60 * 60 * 1000; // ~once per day
}

async function refreshClimate({ force = false } = {}) {
  const lat = parseFloat(getSetting('weather_lat', '59.3293'));
  const lon = parseFloat(getSetting('weather_lon', '18.0686'));
  const place = getSetting('weather_place', 'Stockholm');
  const existing = db.prepare('SELECT * FROM climate_cache WHERE id = 1').get();
  if (!force && cacheIsFresh(existing, lat, lon)) {
    return getCachedClimate();
  }

  const archive = await fetchHistoricalMins(lat, lon);
  const payload = buildClimatePayload(archive, place);
  const fetchedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO climate_cache(id, fetched_at, latitude, longitude, place_name, payload_json)
     VALUES(1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       fetched_at=excluded.fetched_at,
       latitude=excluded.latitude,
       longitude=excluded.longitude,
       place_name=excluded.place_name,
       payload_json=excluded.payload_json`
  ).run(fetchedAt, lat, lon, place, JSON.stringify(payload));
  setSetting('climate_last_fetch', fetchedAt);
  return getCachedClimate();
}

async function ensureClimate() {
  try {
    return await refreshClimate({ force: false });
  } catch (e) {
    console.warn('climate refresh failed, using cache:', e.message);
    return getCachedClimate();
  }
}

module.exports = {
  refreshClimate,
  getCachedClimate,
  ensureClimate,
  FROST_THRESHOLD_C,
  addDays,
};
