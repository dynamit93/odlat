const express = require('express');
const { db, getSetting, setSetting } = require('./db');
const { estimateHarvestWindow, wateringAdvice, plantingFrostAlert } = require('./calc');
const { getCachedWeather, rainNextDaysMm } = require('./weather');
const { getCachedClimate, ensureClimate } = require('./climate');

const router = express.Router();

function enrichPlanting(p) {
  const seed = p.seed_id
    ? db.prepare('SELECT * FROM seeds WHERE id = ?').get(p.seed_id)
    : null;
  const weather = getCachedWeather();
  const climateRow = getCachedClimate();
  const rainMm = rainNextDaysMm(weather, 2);
  const harvest = seed ? estimateHarvestWindow(seed, p.planted_at) : null;
  const water = wateringAdvice({ seed, planting: p, weather, rainMm });
  const frostAlert =
    seed && climateRow
      ? plantingFrostAlert({
          seed,
          plantedAt: p.planted_at,
          climate: climateRow.climate,
          placeName: climateRow.placeName || getSetting('weather_place'),
        })
      : null;
  return {
    ...p,
    seed,
    harvest,
    watering: water,
    frostAlert,
  };
}

function enrichSeed(s) {
  let raw = {};
  try {
    raw = s.raw_json ? JSON.parse(s.raw_json) : {};
  } catch {
    raw = {};
  }
  const f = raw.filterable || {};
  const ean =
    s.ean ||
    (Array.isArray(raw.ean) ? String(raw.ean[0]) : raw.ean ? String(raw.ean) : null);
  const description = s.description || raw.description || null;
  return {
    ...s,
    description,
    sku: s.sku || raw.sku || null,
    ean,
    brand: s.brand || raw.brand || (String(s.external_id || '').startsWith('plantagen_') ? 'Plantagen' : null),
    origin_country: s.origin_country || raw.origin_country || null,
    color: s.color || f.colour || f.color || (f.dominant_size === 'N/A' ? 'N/A' : f.dominant_size) || null,
    pkg_height_cm: s.pkg_height_cm ?? f.height ?? null,
    pkg_width_cm: s.pkg_width_cm ?? f.width ?? null,
    pkg_length_cm: s.pkg_length_cm ?? f.length ?? null,
    scientific_name: raw.scientific_name || f.scientific_name || null,
    icons: s.icons_json ? JSON.parse(s.icons_json) : [],
  };
}

router.get('/seed-categories', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT category AS name, COUNT(*) AS count
       FROM seeds
       WHERE category IS NOT NULL AND category != ''
       GROUP BY category
       ORDER BY count DESC, category COLLATE NOCASE`
    )
    .all();
  res.json(rows);
});

router.get('/seeds', (req, res) => {
  const q = (req.query.q || '').trim();
  const category = (req.query.category || '').trim();
  let sql = 'SELECT * FROM seeds WHERE 1=1';
  const params = [];
  if (q) {
    sql += " AND (name LIKE ? OR IFNULL(description, '') LIKE ? OR IFNULL(sku, '') LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  sql += ' ORDER BY name COLLATE NOCASE LIMIT 2000';
  const rows = db.prepare(sql).all(...params).map(enrichSeed);
  res.json(rows);
});

router.get('/seeds/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM seeds WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(enrichSeed(s));
});

router.get('/beds', (_req, res) => {
  const beds = db.prepare('SELECT * FROM beds ORDER BY name COLLATE NOCASE').all();
  res.json(beds);
});

router.post('/beds', (req, res) => {
  const { name, width_cm, length_cm, x_cm, y_cm, notes } = req.body || {};
  if (!name || !width_cm || !length_cm) {
    return res.status(400).json({ error: 'name, width_cm, length_cm krävs' });
  }
  const count = db.prepare('SELECT COUNT(*) AS c FROM beds').get().c;
  const ox = x_cm != null ? Number(x_cm) : 40 + (count % 5) * 30;
  const oy = y_cm != null ? Number(y_cm) : 40 + (count % 5) * 30;
  const info = db
    .prepare(
      'INSERT INTO beds(name, width_cm, length_cm, x_cm, y_cm, notes) VALUES(?,?,?,?,?,?)'
    )
    .run(name, Number(width_cm), Number(length_cm), ox, oy, notes || null);
  const bed = db.prepare('SELECT * FROM beds WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(bed);
});

router.put('/beds/:id', (req, res) => {
  const bed = db.prepare('SELECT * FROM beds WHERE id = ?').get(req.params.id);
  if (!bed) return res.status(404).json({ error: 'Not found' });
  const name = req.body.name ?? bed.name;
  const width_cm = req.body.width_cm ?? bed.width_cm;
  const length_cm = req.body.length_cm ?? bed.length_cm;
  const x_cm = req.body.x_cm ?? bed.x_cm;
  const y_cm = req.body.y_cm ?? bed.y_cm;
  const notes = req.body.notes ?? bed.notes;
  db.prepare(
    'UPDATE beds SET name=?, width_cm=?, length_cm=?, x_cm=?, y_cm=?, notes=? WHERE id=?'
  ).run(
    name,
    Number(width_cm),
    Number(length_cm),
    Number(x_cm),
    Number(y_cm),
    notes,
    bed.id
  );
  res.json(db.prepare('SELECT * FROM beds WHERE id = ?').get(bed.id));
});

router.get('/garden', (_req, res) => {
  res.json({
    width_cm: Number(getSetting('garden_width_cm', '1200')),
    length_cm: Number(getSetting('garden_length_cm', '800')),
    beds: db.prepare('SELECT * FROM beds ORDER BY id').all(),
  });
});

router.put('/garden', (req, res) => {
  if (req.body.width_cm != null) setSetting('garden_width_cm', req.body.width_cm);
  if (req.body.length_cm != null) setSetting('garden_length_cm', req.body.length_cm);
  res.json({
    width_cm: Number(getSetting('garden_width_cm', '1200')),
    length_cm: Number(getSetting('garden_length_cm', '800')),
  });
});

router.delete('/beds/:id', (req, res) => {
  db.prepare('DELETE FROM beds WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/beds/:id/plantings', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM plantings WHERE bed_id = ? ORDER BY id')
    .all(req.params.id)
    .map(enrichPlanting);
  res.json(rows);
});

router.post('/plantings', (req, res) => {
  const {
    bed_id,
    seed_id,
    custom_name,
    planted_at,
    x_cm,
    y_cm,
    spacing_cm,
    notes,
  } = req.body || {};
  if (!bed_id || !planted_at || x_cm == null || y_cm == null) {
    return res.status(400).json({ error: 'bed_id, planted_at, x_cm, y_cm krävs' });
  }
  let spacing = spacing_cm;
  if (spacing == null && seed_id) {
    const seed = db.prepare('SELECT row_spacing_cm FROM seeds WHERE id = ?').get(seed_id);
    spacing = seed?.row_spacing_cm ?? 20;
  }
  const info = db
    .prepare(
      `INSERT INTO plantings(bed_id, seed_id, custom_name, planted_at, x_cm, y_cm, spacing_cm, notes)
       VALUES(?,?,?,?,?,?,?,?)`
    )
    .run(
      bed_id,
      seed_id || null,
      custom_name || null,
      planted_at,
      Number(x_cm),
      Number(y_cm),
      spacing != null ? Number(spacing) : null,
      notes || null
    );
  const row = db.prepare('SELECT * FROM plantings WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(enrichPlanting(row));
});

router.put('/plantings/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM plantings WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const fields = [
    'seed_id',
    'custom_name',
    'planted_at',
    'x_cm',
    'y_cm',
    'spacing_cm',
    'notes',
    'last_watered_at',
  ];
  const next = { ...p };
  for (const f of fields) {
    if (req.body[f] !== undefined) next[f] = req.body[f];
  }
  db.prepare(
    `UPDATE plantings SET seed_id=?, custom_name=?, planted_at=?, x_cm=?, y_cm=?, spacing_cm=?, notes=?, last_watered_at=?
     WHERE id=?`
  ).run(
    next.seed_id,
    next.custom_name,
    next.planted_at,
    Number(next.x_cm),
    Number(next.y_cm),
    next.spacing_cm != null ? Number(next.spacing_cm) : null,
    next.notes,
    next.last_watered_at,
    p.id
  );
  res.json(enrichPlanting(db.prepare('SELECT * FROM plantings WHERE id = ?').get(p.id)));
});

router.delete('/plantings/:id', (req, res) => {
  db.prepare('DELETE FROM plantings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/overview', async (_req, res) => {
  const weather = getCachedWeather();
  const climate = await ensureClimate();
  const plantings = db.prepare('SELECT * FROM plantings').all().map(enrichPlanting);
  const waterSoon = plantings.filter(
    (p) => p.watering?.status === 'water_today' || p.watering?.status === 'scheduled'
  );
  const harvestSoon = plantings.filter((p) => {
    if (!p.harvest?.from) return false;
    const from = new Date(p.harvest.from);
    const now = new Date();
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    return from <= in30 && from >= new Date(now.getFullYear() - 1, 0, 1);
  });
  const frostRisks = plantings.filter(
    (p) => p.frostAlert && (p.frostAlert.level === 'danger' || p.frostAlert.level === 'warning')
  );
  res.json({
    weather,
    climate,
    placeName: getSetting('weather_place'),
    plantings,
    waterSoon,
    harvestSoon,
    frostRisks,
  });
});

router.get('/planting-advice', async (req, res) => {
  const seedId = Number(req.query.seed_id);
  const plantedAt = (req.query.planted_at || new Date().toISOString().slice(0, 10)).trim();
  if (!seedId) return res.status(400).json({ error: 'seed_id krävs' });
  const seed = db.prepare('SELECT * FROM seeds WHERE id = ?').get(seedId);
  if (!seed) return res.status(404).json({ error: 'Frö hittades inte' });
  const climate = await ensureClimate();
  const alert = plantingFrostAlert({
    seed,
    plantedAt,
    climate: climate?.climate,
    placeName: climate?.placeName || getSetting('weather_place'),
  });
  res.json({
    seed: { id: seed.id, name: seed.name, category: seed.category },
    plantedAt,
    placeName: climate?.placeName || getSetting('weather_place'),
    climate: climate
      ? {
          fetchedAt: climate.fetchedAt,
          frostDate: climate.climate?.frost_date_this_year,
          frostMedian: climate.climate?.frost_date_median_mmdd,
          winterAvgMinC: climate.climate?.winter_avg_min_c,
          historyYears: climate.climate?.history_years,
        }
      : null,
    alert,
  });
});

router.get('/climate', async (_req, res) => {
  try {
    const climate = await ensureClimate();
    if (!climate) return res.status(404).json({ error: 'Ingen klimatcache ännu' });
    res.json(climate);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
