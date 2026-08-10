const fetch = require('node-fetch');
const { db, getSetting, setSetting } = require('./db');

async function fetchOpenMeteo(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weathercode` +
    `&timezone=Europe%2FStockholm&forecast_days=7`;
  const res = await fetch(url, { timeout: 20000 });
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
  return res.json();
}

async function refreshWeather({ force = false } = {}) {
  const lat = parseFloat(getSetting('weather_lat', '59.3293'));
  const lon = parseFloat(getSetting('weather_lon', '18.0686'));
  const place = getSetting('weather_place', 'Stockholm');
  const payload = await fetchOpenMeteo(lat, lon);
  const fetchedAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO weather_cache(id, fetched_at, latitude, longitude, place_name, payload_json)
     VALUES(1, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       fetched_at=excluded.fetched_at,
       latitude=excluded.latitude,
       longitude=excluded.longitude,
       place_name=excluded.place_name,
       payload_json=excluded.payload_json`
  ).run(fetchedAt, lat, lon, place, JSON.stringify(payload));
  setSetting('weather_last_fetch', fetchedAt);
  return getCachedWeather();
}

function getCachedWeather() {
  const row = db.prepare('SELECT * FROM weather_cache WHERE id = 1').get();
  if (!row) return null;
  return {
    fetchedAt: row.fetched_at,
    latitude: row.latitude,
    longitude: row.longitude,
    placeName: row.place_name,
    forecast: JSON.parse(row.payload_json),
  };
}

function rainNextDaysMm(weather, days = 2) {
  if (!weather?.forecast?.daily?.precipitation_sum) return 0;
  return weather.forecast.daily.precipitation_sum
    .slice(0, days)
    .reduce((a, b) => a + (Number(b) || 0), 0);
}

module.exports = { refreshWeather, getCachedWeather, rainNextDaysMm, fetchOpenMeteo };
