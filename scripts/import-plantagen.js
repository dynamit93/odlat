/**
 * Import all Plantagen seed products (Odla > Fröer) into local SQLite + media.
 * Primary source: Plantagen Meilisearch index. Retries on timeout/rate-limit
 * with a 1 minute wait until every seed is imported.
 */
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { db, MEDIA_DIR } = require('../server/db');
const { waterIntervalFromText } = require('../server/calc');
const { loadFallback } = require('./seed-fallback');

const MEILI_HOST = 'https://ms-a6530e77c471-12443.lon.meilisearch.io';
const MEILI_KEY = 'a2159774cf867351b1195f0a05a4fb9f4693c781bd3e89a3ff5e856637710594';
const MEILI_INDEX = 'products_sv-SE';
const SEED_FILTER = 'categories.lvl1 = "Odla > Fröer"';
const PAGE_SIZE = 50;
const RETRY_WAIT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const PROGRESS_FILE = path.join(
  process.env.ODLAT_DATA || path.join(__dirname, '..', 'data'),
  'import-progress.json'
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(err, status) {
  if (status === 429 || status === 503 || status === 502 || status === 504) return true;
  const msg = String(err?.message || err || '').toLowerCase();
  return /timeout|timed out|econnreset|enotfound|network|socket|429|too many|fetch failed/.test(msg);
}

async function fetchWithRetry(url, options = {}, label = url) {
  for (;;) {
    try {
      const res = await fetch(url, {
        timeout: REQUEST_TIMEOUT_MS,
        ...options,
        headers: {
          'User-Agent': 'OdlatPersonalCatalog/1.0 (+local LAN)',
          ...(options.headers || {}),
        },
      });
      if (isRetryable(null, res.status)) {
        console.warn(`  rate/unavailable HTTP ${res.status} for ${label} — wait 1 min…`);
        await sleep(RETRY_WAIT_MS);
        continue;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${label} ${body.slice(0, 120)}`);
      }
      return res;
    } catch (e) {
      if (isRetryable(e)) {
        console.warn(`  retryable error for ${label}: ${e.message} — wait 1 min…`);
        await sleep(RETRY_WAIT_MS);
        continue;
      }
      throw e;
    }
  }
}

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  } catch {
    return { doneIds: [], failed: [] };
  }
}

function saveProgress(progress) {
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function monthList(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr.join(', ');
}

function formatSowTime(f) {
  const a = f.plant_planting_month_start?.[0] || f.plant_precultivating_month_start?.[0];
  const b = f.plant_planting_month_stop?.[0] || f.plant_precultivating_month_stop?.[0];
  if (a && b && a !== b) return `${a} - ${b}`;
  return a || b || null;
}

function formatSun(level) {
  const v = Array.isArray(level) ? level[0] : level;
  if (!v) return null;
  const t = String(v).toLowerCase();
  if (/sol/.test(t) && !/skugg/.test(t)) return 'Behöver soliga förhållanden';
  if (/halv/.test(t)) return 'Trivs i halvskugga';
  if (/skugg/.test(t)) return 'Trivs i skugga';
  return String(v);
}

function formatWater(needs) {
  const v = Array.isArray(needs) ? needs[0] : needs;
  if (!v) return null;
  const t = String(v).toLowerCase();
  if (/måttligt|mattligt/.test(t)) return 'Kräver måttligt med vatten';
  if (/mycket|rikligt/.test(t)) return 'Kräver mycket vatten';
  if (/lite|sparsamt|torr/.test(t)) return 'Kräver lite vatten';
  return `Kräver ${String(v).toLowerCase()} med vatten`;
}

function parseDepth(val) {
  if (val == null || val === '') return null;
  const n = parseFloat(String(val).replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function categoryName(hit) {
  const lvl2 = hit.categories?.lvl2?.[0] || '';
  const m = lvl2.match(/Fröer\s*>\s*(.+)$/i) || lvl2.match(/Froer\s*>\s*(.+)$/i);
  return m ? m[1].trim() : 'Fröer';
}

function buildIcons(f, sun, water, sow_time, bloom_time, row, depth, height) {
  const icons = [];
  const push = (label, kind) => {
    if (!label) return;
    icons.push({ label, icon: null, kind });
  };
  push(sun, 'sun');
  push(water, 'water');
  if (sow_time) push(`Så tid ${sow_time}`, 'sow');
  if (bloom_time) push(`Blomningstid ${bloom_time}`, 'bloom');
  if (row != null) push(`Radavstånd ${row} cm`, 'row');
  if (depth != null) push(`Sådjup ${String(depth).replace('.', ',')} cm`, 'depth');
  if (height != null) push(`Fullvuxen ${height} cm`, 'height');
  if (f.lower_planting_distance != null) {
    push(`Planteringsavstånd ${f.lower_planting_distance} cm`, 'plant_spacing');
  }
  return icons;
}

function hitToRow(hit, image_path) {
  const f = hit.filterable || {};
  const sun = formatSun(f.plant_light_level);
  const water = formatWater(f.plant_watering_needs);
  const sow_time = formatSowTime(f);
  const bloom_time =
    monthList(f.plant_flowering_period) ||
    (() => {
      const a = f.plant_harvest_month_start?.[0];
      const b = f.plant_harvest_month_stop?.[0];
      if (a && b) return `${a} - ${b}`;
      return a || null;
    })();
  const row_spacing_cm =
    f.rowspacing != null
      ? Number(f.rowspacing)
      : f.lower_planting_distance != null
        ? Number(f.lower_planting_distance)
        : null;
  const sow_depth_cm = parseDepth(f.seed_sowing_depth);
  const mature_height_cm = f.full_grown_height != null ? Number(f.full_grown_height) : null;
  const icons = buildIcons(f, sun, water, sow_time, bloom_time, row_spacing_cm, sow_depth_cm, mature_height_cm);
  const alias = String(hit.alias || '').replace(/^\//, '');
  const source_url = alias
    ? `https://plantagen.se/se/p/${alias}`
    : `https://plantagen.se/se/search?q=${encodeURIComponent(hit.title || hit.sku || '')}`;
  const external_id = `plantagen_${hit.sku || hit.id}`;

  const ean = Array.isArray(hit.ean) ? String(hit.ean[0] || '') : hit.ean ? String(hit.ean) : null;
  const color = f.colour || f.color || (f.dominant_size != null ? String(f.dominant_size) : null);
  const pkg_height_cm = f.height != null ? Number(f.height) : null;
  const pkg_width_cm = f.width != null ? Number(f.width) : null;
  const pkg_length_cm = f.length != null ? Number(f.length) : null;

  return {
    external_id,
    name: String(hit.title || 'Okänt frö').slice(0, 200),
    category: categoryName(hit),
    description: hit.description || null,
    image_path,
    icons_json: JSON.stringify(icons),
    sun,
    water,
    sow_time,
    bloom_time,
    row_spacing_cm: Number.isFinite(row_spacing_cm) ? row_spacing_cm : null,
    sow_depth_cm,
    mature_height_cm: Number.isFinite(mature_height_cm) ? mature_height_cm : null,
    sku: hit.sku ? String(hit.sku) : null,
    ean: ean || null,
    brand: hit.brand || 'Plantagen',
    origin_country: hit.origin_country || hit.country_of_origin || null,
    color,
    pkg_height_cm: Number.isFinite(pkg_height_cm) ? pkg_height_cm : null,
    pkg_width_cm: Number.isFinite(pkg_width_cm) ? pkg_width_cm : null,
    pkg_length_cm: Number.isFinite(pkg_length_cm) ? pkg_length_cm : null,
    source_url,
    water_interval_days: waterIntervalFromText(water, 3),
    harvest_days_min: null,
    harvest_days_max: null,
    raw_json: JSON.stringify({
      id: hit.id,
      sku: hit.sku,
      ean: hit.ean || null,
      description: hit.description || null,
      brand: hit.brand || 'Plantagen',
      origin_country: hit.origin_country || hit.country_of_origin || null,
      scientific_name: f.scientific_name || null,
      filterable: f,
      categories: hit.categories,
    }),
  };
}

function upsertSeed(row) {
  db.prepare(`
    INSERT INTO seeds(
      external_id, name, category, description, image_path, icons_json, sun, water, sow_time, bloom_time,
      row_spacing_cm, sow_depth_cm, mature_height_cm, sku, ean, brand, origin_country, color,
      pkg_height_cm, pkg_width_cm, pkg_length_cm, source_url, water_interval_days,
      harvest_days_min, harvest_days_max, raw_json, updated_at
    ) VALUES (
      @external_id, @name, @category, @description, @image_path, @icons_json, @sun, @water, @sow_time, @bloom_time,
      @row_spacing_cm, @sow_depth_cm, @mature_height_cm, @sku, @ean, @brand, @origin_country, @color,
      @pkg_height_cm, @pkg_width_cm, @pkg_length_cm, @source_url, @water_interval_days,
      @harvest_days_min, @harvest_days_max, @raw_json, datetime('now')
    )
    ON CONFLICT(external_id) DO UPDATE SET
      name=excluded.name,
      category=excluded.category,
      description=excluded.description,
      image_path=COALESCE(excluded.image_path, seeds.image_path),
      icons_json=excluded.icons_json,
      sun=excluded.sun,
      water=excluded.water,
      sow_time=excluded.sow_time,
      bloom_time=excluded.bloom_time,
      row_spacing_cm=excluded.row_spacing_cm,
      sow_depth_cm=excluded.sow_depth_cm,
      mature_height_cm=excluded.mature_height_cm,
      sku=excluded.sku,
      ean=excluded.ean,
      brand=excluded.brand,
      origin_country=COALESCE(excluded.origin_country, seeds.origin_country),
      color=excluded.color,
      pkg_height_cm=excluded.pkg_height_cm,
      pkg_width_cm=excluded.pkg_width_cm,
      pkg_length_cm=excluded.pkg_length_cm,
      source_url=excluded.source_url,
      water_interval_days=excluded.water_interval_days,
      raw_json=excluded.raw_json,
      updated_at=datetime('now')
  `).run(row);
}

async function meiliSearch(page) {
  const res = await fetchWithRetry(
    `${MEILI_HOST}/indexes/${MEILI_INDEX}/search`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MEILI_KEY}`,
      },
      body: JSON.stringify({
        q: '',
        filter: SEED_FILTER,
        hitsPerPage: PAGE_SIZE,
        page,
      }),
    },
    `meili page ${page}`
  );
  return res.json();
}

function imageCandidates(imageUrl) {
  const url = String(imageUrl || '');
  if (!url) return [];
  const out = [url];
  // Try a larger crystallize derivative, then original path without size segment
  if (/\/@\d+\//.test(url)) {
    out.push(url.replace(/\/@\d+\//, '/@1024/'));
    out.push(url.replace(/\/@\d+\//, '/@2000/'));
  }
  // Some assets also exist as .png/.jpg
  if (/\.webp(\?|$)/i.test(url)) {
    out.push(url.replace(/\.webp(\?|$)/i, '.png$1'));
    out.push(url.replace(/\.webp(\?|$)/i, '.jpg$1'));
  }
  return [...new Set(out)];
}

async function downloadImage(imageUrl, dest) {
  if (!imageUrl) return null;
  const candidates = imageCandidates(imageUrl);
  let lastErr = null;
  for (const url of candidates) {
    for (;;) {
      try {
        const res = await fetch(url, {
          timeout: REQUEST_TIMEOUT_MS,
          headers: { 'User-Agent': 'OdlatPersonalCatalog/1.0 (+local LAN)' },
        });
        if (isRetryable(null, res.status)) {
          console.warn(`  rate/unavailable HTTP ${res.status} for image — wait 1 min…`);
          await sleep(RETRY_WAIT_MS);
          continue;
        }
        if (res.status === 404) {
          lastErr = new Error(`HTTP 404 ${url}`);
          break;
        }
        if (!res.ok) {
          lastErr = new Error(`HTTP ${res.status}`);
          if (isRetryable(null, res.status)) {
            await sleep(RETRY_WAIT_MS);
            continue;
          }
          break;
        }
        const buf = await res.buffer();
        if (!buf || buf.length < 50) {
          lastErr = new Error('empty image');
          break;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        return dest;
      } catch (e) {
        lastErr = e;
        if (isRetryable(e)) {
          console.warn(`  image retry: ${e.message} — wait 1 min…`);
          await sleep(RETRY_WAIT_MS);
          continue;
        }
        break;
      }
    }
  }
  console.warn(`  image skip ${path.basename(dest)}: ${lastErr?.message || 'failed'}`);
  return null;
}

async function importHit(hit, progress) {
  const id = String(hit.id || hit.sku);
  if (progress.doneIds.includes(id)) return 'skip';

  const alias = String(hit.alias || hit.sku || id).replace(/^\//, '');
  const ext = path.extname(new URL(hit.image_url || 'https://x/x.jpg').pathname) || '.webp';
  const safe = `plantagen_${alias}`.replace(/\W+/g, '_').slice(0, 160);
  const dest = path.join(MEDIA_DIR, 'products', `${safe}${ext}`);
  let image_path = null;
  if (hit.image_url) {
    const saved = await downloadImage(hit.image_url, dest);
    if (saved) image_path = `/media/products/${path.basename(dest)}`;
  }

  const row = hitToRow(hit, image_path);
  upsertSeed(row);
  progress.doneIds.push(id);
  if (progress.doneIds.length % 25 === 0) saveProgress(progress);
  return 'ok';
}

async function main() {
  console.log('Ensuring fallback seeds…');
  loadFallback();

  const progress = loadProgress();
  progress.doneIds = Array.isArray(progress.doneIds) ? progress.doneIds : [];
  console.log(`Resume: ${progress.doneIds.length} already imported`);

  let page = 1;
  let totalPages = 1;
  let totalHits = 0;
  let ok = 0;
  let skip = 0;

  while (page <= totalPages) {
    console.log(`Fetching Meili page ${page}/${totalPages || '?'}…`);
    const data = await meiliSearch(page);
    totalPages = data.totalPages || 1;
    totalHits = data.totalHits || 0;
    const hits = data.hits || [];
    console.log(`  got ${hits.length} (totalHits=${totalHits})`);

    for (const hit of hits) {
      try {
        const r = await importHit(hit, progress);
        if (r === 'ok') {
          ok++;
          console.log(`  + ${hit.title}`);
        } else {
          skip++;
        }
      } catch (e) {
        if (isRetryable(e)) {
          console.warn(`  hit retry later: ${hit.title} — ${e.message}`);
          await sleep(RETRY_WAIT_MS);
          try {
            const r = await importHit(hit, progress);
            if (r === 'ok') ok++;
            else skip++;
          } catch (e2) {
            console.warn(`  fail ${hit.title}: ${e2.message}`);
            progress.failed = progress.failed || [];
            progress.failed.push({ id: hit.id, title: hit.title, error: e2.message });
          }
        } else {
          console.warn(`  fail ${hit.title}: ${e.message}`);
          progress.failed = progress.failed || [];
          progress.failed.push({ id: hit.id, title: hit.title, error: e.message });
        }
      }
    }

    saveProgress(progress);
    page++;
  }

  // Retry previously failed until empty or max rounds
  let round = 0;
  while ((progress.failed || []).length && round < 20) {
    round++;
    const pending = [...progress.failed];
    progress.failed = [];
    console.log(`Retry round ${round}: ${pending.length} failed…`);
    await sleep(RETRY_WAIT_MS);
    for (const item of pending) {
      try {
        // Re-fetch single product by sku/title
        const res = await fetchWithRetry(
          `${MEILI_HOST}/indexes/${MEILI_INDEX}/search`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${MEILI_KEY}`,
            },
            body: JSON.stringify({
              q: item.title || '',
              filter: `id = "${item.id}"`,
              hitsPerPage: 1,
            }),
          },
          `retry ${item.id}`
        );
        const data = await res.json();
        const hit = data.hits?.[0];
        if (!hit) throw new Error('not found in meili');
        const r = await importHit(hit, progress);
        if (r === 'ok') ok++;
      } catch (e) {
        console.warn(`  still failing ${item.title}: ${e.message}`);
        progress.failed.push(item);
      }
    }
    saveProgress(progress);
  }

  const count = db.prepare('SELECT COUNT(*) AS c FROM seeds').get().c;
  const withImg = db
    .prepare("SELECT COUNT(*) AS c FROM seeds WHERE image_path IS NOT NULL AND image_path != ''")
    .get().c;
  console.log(
    `Done. new_ok=${ok} skipped=${skip} failed=${(progress.failed || []).length} total_seeds=${count} with_image=${withImg}`
  );
  if ((progress.failed || []).length) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
