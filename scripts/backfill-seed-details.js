/**
 * Backfill description / EAN / package attrs from existing raw_json + Meili (no image re-download).
 */
const fetch = require('node-fetch');
const { db } = require('../server/db');

const MEILI_HOST = 'https://ms-a6530e77c471-12443.lon.meilisearch.io';
const MEILI_KEY = 'a2159774cf867351b1195f0a05a4fb9f4693c781bd3e89a3ff5e856637710594';
const MEILI_INDEX = 'products_sv-SE';
const SEED_FILTER = 'categories.lvl1 = "Odla > Fröer"';
const PAGE_SIZE = 100;

const update = db.prepare(`
  UPDATE seeds SET
    description = COALESCE(@description, description),
    sku = COALESCE(@sku, sku),
    ean = COALESCE(@ean, ean),
    brand = COALESCE(@brand, brand),
    color = COALESCE(@color, color),
    pkg_height_cm = COALESCE(@pkg_height_cm, pkg_height_cm),
    pkg_width_cm = COALESCE(@pkg_width_cm, pkg_width_cm),
    pkg_length_cm = COALESCE(@pkg_length_cm, pkg_length_cm),
    category = COALESCE(@category, category),
    raw_json = COALESCE(@raw_json, raw_json),
    updated_at = datetime('now')
  WHERE external_id = @external_id
`);

function categoryName(hit) {
  const lvl2 = hit.categories?.lvl2?.[0] || '';
  const m = lvl2.match(/Fröer\s*>\s*(.+)$/i) || lvl2.match(/Froer\s*>\s*(.+)$/i);
  return m ? m[1].trim() : 'Fröer';
}

async function main() {
  // First pass: raw_json already on disk
  const rows = db.prepare('SELECT id, external_id, raw_json FROM seeds').all();
  let fromRaw = 0;
  for (const row of rows) {
    let raw = {};
    try {
      raw = row.raw_json ? JSON.parse(row.raw_json) : {};
    } catch {
      continue;
    }
    const f = raw.filterable || {};
    const ean = Array.isArray(raw.ean) ? String(raw.ean[0] || '') : raw.ean ? String(raw.ean) : null;
    if (!raw.description && !raw.sku && !ean && !f.height) continue;
    update.run({
      external_id: row.external_id,
      description: raw.description || null,
      sku: raw.sku ? String(raw.sku) : null,
      ean: ean || null,
      brand: raw.brand || 'Plantagen',
      color: f.colour || f.color || (f.dominant_size != null ? String(f.dominant_size) : null),
      pkg_height_cm: f.height != null ? Number(f.height) : null,
      pkg_width_cm: f.width != null ? Number(f.width) : null,
      pkg_length_cm: f.length != null ? Number(f.length) : null,
      category: null,
      raw_json: null,
    });
    fromRaw++;
  }
  console.log(`Backfilled from raw_json: ${fromRaw}`);

  // Second pass: Meili for EAN + full attrs
  let page = 1;
  let totalPages = 1;
  let updated = 0;
  while (page <= totalPages) {
    const res = await fetch(`${MEILI_HOST}/indexes/${MEILI_INDEX}/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MEILI_KEY}`,
      },
      body: JSON.stringify({ q: '', filter: SEED_FILTER, hitsPerPage: PAGE_SIZE, page }),
      timeout: 30000,
    });
    if (!res.ok) throw new Error(`Meili HTTP ${res.status}`);
    const data = await res.json();
    totalPages = data.totalPages || 1;
    for (const hit of data.hits || []) {
      const f = hit.filterable || {};
      const external_id = `plantagen_${hit.sku || hit.id}`;
      const ean = Array.isArray(hit.ean) ? String(hit.ean[0] || '') : hit.ean ? String(hit.ean) : null;
      const raw_json = JSON.stringify({
        id: hit.id,
        sku: hit.sku,
        ean: hit.ean || null,
        description: hit.description || null,
        brand: hit.brand || 'Plantagen',
        origin_country: hit.origin_country || hit.country_of_origin || null,
        scientific_name: f.scientific_name || null,
        filterable: f,
        categories: hit.categories,
      });
      const info = update.run({
        external_id,
        description: hit.description || null,
        sku: hit.sku ? String(hit.sku) : null,
        ean: ean || null,
        brand: hit.brand || 'Plantagen',
        color: f.colour || f.color || (f.dominant_size != null ? String(f.dominant_size) : null),
        pkg_height_cm: f.height != null ? Number(f.height) : null,
        pkg_width_cm: f.width != null ? Number(f.width) : null,
        pkg_length_cm: f.length != null ? Number(f.length) : null,
        category: categoryName(hit),
        raw_json,
      });
      if (info.changes) updated++;
    }
    console.log(`Meili page ${page}/${totalPages}`);
    page++;
  }
  console.log(`Updated from Meili: ${updated}`);

  // Third pass: scrape Ursprungsland from product pages when missing
  const needOrigin = db
    .prepare(
      `SELECT id, external_id, source_url, origin_country FROM seeds
       WHERE (origin_country IS NULL OR origin_country = '')
         AND source_url LIKE 'https://plantagen.se/se/p/%'`
    )
    .all();
  console.log(`Scraping origin for ${needOrigin.length} seeds…`);
  const setOrigin = db.prepare(
    'UPDATE seeds SET origin_country = ?, updated_at = datetime(\'now\') WHERE id = ?'
  );
  let origins = 0;
  for (let i = 0; i < needOrigin.length; i++) {
    const row = needOrigin[i];
    try {
      const res = await fetch(row.source_url, {
        timeout: 25000,
        headers: { 'User-Agent': 'OdlatPersonalCatalog/1.0' },
      });
      if (res.status === 429 || res.status === 503) {
        console.warn('  rate limited — wait 1 min');
        await new Promise((r) => setTimeout(r, 60000));
        i--;
        continue;
      }
      if (!res.ok) continue;
      const html = await res.text();
      const m = html.match(/countryOfOrigin([A-Z]{2})\b/);
      if (m) {
        setOrigin.run(m[1], row.id);
        origins++;
      }
      if ((i + 1) % 50 === 0) console.log(`  origin ${i + 1}/${needOrigin.length} (found ${origins})`);
      await new Promise((r) => setTimeout(r, 150));
    } catch (e) {
      if (/timeout|429|econnreset/i.test(e.message)) {
        console.warn(`  retry ${row.source_url}: ${e.message} — wait 1 min`);
        await new Promise((r) => setTimeout(r, 60000));
        i--;
      }
    }
  }
  console.log(`Origins filled: ${origins}`);

  const sample = db
    .prepare(
      "SELECT name, description, sku, ean, color, pkg_height_cm, pkg_width_cm, pkg_length_cm, brand, origin_country FROM seeds WHERE name LIKE '%Alfalfa%'"
    )
    .get();
  console.log('Alfalfa sample', sample);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
