const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { spawn } = require('child_process');
const { MEDIA_DIR, getSetting, setSetting, db } = require('./db');
const { refreshWeather, getCachedWeather } = require('./weather');
const { refreshClimate, getCachedClimate, ensureClimate } = require('./climate');
const api = require('./routes');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/media', express.static(MEDIA_DIR));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'Odlat' }));

app.get('/api/settings', (_req, res) => {
  const climate = getCachedClimate();
  res.json({
    weather_lat: getSetting('weather_lat'),
    weather_lon: getSetting('weather_lon'),
    weather_place: getSetting('weather_place'),
    weather_last_fetch: getSetting('weather_last_fetch'),
    climate_last_fetch: getSetting('climate_last_fetch'),
    frost_date: climate?.climate?.frost_date_this_year || null,
    winter_avg_min_c: climate?.climate?.winter_avg_min_c ?? null,
  });
});

app.put('/api/settings', async (req, res) => {
  const { weather_lat, weather_lon, weather_place } = req.body || {};
  if (weather_lat != null) setSetting('weather_lat', weather_lat);
  if (weather_lon != null) setSetting('weather_lon', weather_lon);
  if (weather_place != null) setSetting('weather_place', weather_place);
  try {
    await refreshWeather({ force: true });
  } catch (e) {
    console.error('weather refresh after settings', e.message);
  }
  try {
    await refreshClimate({ force: true });
  } catch (e) {
    console.error('climate refresh after settings', e.message);
  }
  const climate = getCachedClimate();
  res.json({
    weather_lat: getSetting('weather_lat'),
    weather_lon: getSetting('weather_lon'),
    weather_place: getSetting('weather_place'),
    weather_last_fetch: getSetting('weather_last_fetch'),
    climate_last_fetch: getSetting('climate_last_fetch'),
    frost_date: climate?.climate?.frost_date_this_year || null,
    winter_avg_min_c: climate?.climate?.winter_avg_min_c ?? null,
  });
});

app.get('/api/weather', (_req, res) => {
  const w = getCachedWeather();
  if (!w) return res.status(404).json({ error: 'Ingen vädercache ännu' });
  res.json(w);
});

app.post('/api/weather/refresh', async (_req, res) => {
  try {
    const w = await refreshWeather({ force: true });
    let climate = null;
    try {
      climate = await refreshClimate({ force: true });
    } catch (e) {
      console.warn('climate refresh:', e.message);
      climate = getCachedClimate();
    }
    res.json({ ...w, climate });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/seeds/import', (_req, res) => {
  const script = path.join(__dirname, '..', 'scripts', 'import-plantagen.js');
  const child = spawn(process.execPath, [script], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (out += d.toString()));
  child.on('close', (code) => {
    const count = db.prepare('SELECT COUNT(*) AS c FROM seeds').get().c;
    res.json({ ok: code === 0, code, seedCount: count, log: out.slice(-4000) });
  });
});

app.use('/api', api);

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/media')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Daily weather + climate at 03:00 Europe/Stockholm
cron.schedule(
  '0 3 * * *',
  async () => {
    try {
      console.log('[cron] refreshing weather…');
      await refreshWeather({ force: true });
      console.log('[cron] weather ok');
    } catch (e) {
      console.error('[cron] weather failed', e.message);
    }
    try {
      console.log('[cron] refreshing climate/frost…');
      await refreshClimate({ force: true });
      console.log('[cron] climate ok');
    } catch (e) {
      console.error('[cron] climate failed', e.message);
    }
  },
  { timezone: 'Europe/Stockholm' }
);

async function boot() {
  const seedCount = db.prepare('SELECT COUNT(*) AS c FROM seeds').get().c;
  if (seedCount === 0) {
    console.log('No seeds — loading fallback catalog…');
    require('../scripts/seed-fallback').loadFallback();
  }
  if (!getCachedWeather()) {
    try {
      await refreshWeather({ force: true });
    } catch (e) {
      console.warn('Initial weather fetch failed:', e.message);
    }
  }
  // Climate in background so boot is not blocked by archive API
  ensureClimate().catch((e) => console.warn('Initial climate fetch failed:', e.message));
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Odlat lyssnar på :${PORT}`);
  });
}

boot();
