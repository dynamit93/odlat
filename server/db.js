const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.ODLAT_DATA || path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'odlat.db');
const MEDIA_DIR = path.join(DATA_DIR, 'media');

fs.mkdirSync(MEDIA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  image_path TEXT,
  icons_json TEXT,
  sun TEXT,
  water TEXT,
  sow_time TEXT,
  bloom_time TEXT,
  row_spacing_cm REAL,
  sow_depth_cm REAL,
  mature_height_cm REAL,
  sku TEXT,
  ean TEXT,
  brand TEXT,
  origin_country TEXT,
  color TEXT,
  pkg_height_cm REAL,
  pkg_width_cm REAL,
  pkg_length_cm REAL,
  source_url TEXT,
  water_interval_days INTEGER DEFAULT 3,
  harvest_days_min INTEGER,
  harvest_days_max INTEGER,
  raw_json TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS beds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  width_cm REAL NOT NULL,
  length_cm REAL NOT NULL,
  x_cm REAL NOT NULL DEFAULT 40,
  y_cm REAL NOT NULL DEFAULT 40,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plantings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bed_id INTEGER NOT NULL REFERENCES beds(id) ON DELETE CASCADE,
  seed_id INTEGER REFERENCES seeds(id),
  custom_name TEXT,
  planted_at TEXT NOT NULL,
  x_cm REAL NOT NULL,
  y_cm REAL NOT NULL,
  spacing_cm REAL,
  notes TEXT,
  last_watered_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weather_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fetched_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  place_name TEXT,
  payload_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plantings_bed ON plantings(bed_id);
CREATE INDEX IF NOT EXISTS idx_seeds_name ON seeds(name);
`);

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

// Defaults
if (!getSetting('weather_lat')) setSetting('weather_lat', '59.3293');
if (!getSetting('weather_lon')) setSetting('weather_lon', '18.0686');
if (!getSetting('weather_place')) setSetting('weather_place', 'Stockholm');
if (!getSetting('garden_width_cm')) setSetting('garden_width_cm', '1200');
if (!getSetting('garden_length_cm')) setSetting('garden_length_cm', '800');

// Migrations for older DBs
try {
  const cols = db.prepare('PRAGMA table_info(beds)').all().map((c) => c.name);
  if (!cols.includes('x_cm')) db.exec('ALTER TABLE beds ADD COLUMN x_cm REAL NOT NULL DEFAULT 40');
  if (!cols.includes('y_cm')) db.exec('ALTER TABLE beds ADD COLUMN y_cm REAL NOT NULL DEFAULT 40');
} catch (e) {
  console.warn('beds migration', e.message);
}

try {
  const seedCols = db.prepare('PRAGMA table_info(seeds)').all().map((c) => c.name);
  if (!seedCols.includes('description')) {
    db.exec('ALTER TABLE seeds ADD COLUMN description TEXT');
  }
  if (!seedCols.includes('sku')) db.exec('ALTER TABLE seeds ADD COLUMN sku TEXT');
  if (!seedCols.includes('ean')) db.exec('ALTER TABLE seeds ADD COLUMN ean TEXT');
  if (!seedCols.includes('brand')) db.exec('ALTER TABLE seeds ADD COLUMN brand TEXT');
  if (!seedCols.includes('origin_country')) db.exec('ALTER TABLE seeds ADD COLUMN origin_country TEXT');
  if (!seedCols.includes('color')) db.exec('ALTER TABLE seeds ADD COLUMN color TEXT');
  if (!seedCols.includes('pkg_height_cm')) db.exec('ALTER TABLE seeds ADD COLUMN pkg_height_cm REAL');
  if (!seedCols.includes('pkg_width_cm')) db.exec('ALTER TABLE seeds ADD COLUMN pkg_width_cm REAL');
  if (!seedCols.includes('pkg_length_cm')) db.exec('ALTER TABLE seeds ADD COLUMN pkg_length_cm REAL');
} catch (e) {
  console.warn('seeds migration', e.message);
}

db.exec('CREATE INDEX IF NOT EXISTS idx_seeds_category ON seeds(category)');

module.exports = { db, DATA_DIR, MEDIA_DIR, DB_PATH, getSetting, setSetting };
