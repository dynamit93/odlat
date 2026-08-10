const MONTHS = {
  jan: 1, januari: 1,
  feb: 2, februari: 2,
  mar: 3, mars: 3,
  apr: 4, april: 4,
  may: 5, maj: 5,
  jun: 6, juni: 6,
  jul: 7, juli: 7,
  aug: 8, augusti: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oct: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function parseMonthTokens(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const found = [];
  for (const [name, num] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${name}\\b`, 'i').test(lower)) found.push(num);
  }
  return [...new Set(found)].sort((a, b) => a - b);
}

function waterIntervalFromText(waterText, fallback = 3) {
  const t = String(waterText || '').toLowerCase();
  if (/mycket|rikligt|hög/.test(t)) return 1;
  if (/lite|torka|torr|sparsamt/.test(t)) return 5;
  if (/måttligt|medel/.test(t)) return 3;
  return fallback;
}

/** Typical days to harvest when Plantagen data lacks explicit numbers. */
function inferHarvestDays(seed) {
  const min = seed?.harvest_days_min;
  const max = seed?.harvest_days_max;
  if (min != null && max != null) {
    return { min: Number(min), max: Number(max), source: 'katalog' };
  }

  const name = String(seed?.name || '').toLowerCase();
  const cat = String(seed?.category || '').toLowerCase();

  const rules = [
    { re: /bifftomat|oxhj[aä]r|beef\s*steak|(coeur\s*de\s*boeuf)|boeuf/, min: 70, max: 95, source: 'typisk bifftomat' },
    { re: /k[oö]rsb[aä]rstomat|cherry|cocktailtomat|plommontomat/, min: 55, max: 80, source: 'typisk körsbärstomat' },
    { re: /tomat|tomato/, min: 40, max: 95, source: 'typisk tomat' },
    { re: /chili|peperoni|habanero|jalape[nñ]o/, min: 60, max: 100, source: 'typisk chili' },
    { re: /paprika/, min: 60, max: 90, source: 'typisk paprika' },
    { re: /gurka|slanggurka|druvgurka/, min: 50, max: 70, source: 'typisk gurka' },
    { re: /squash|zucchini|pumpa/, min: 45, max: 70, source: 'typisk squash' },
    { re: /morot/, min: 60, max: 100, source: 'typisk morot' },
    { re: /r[aä]dis/, min: 20, max: 40, source: 'typisk rädisa' },
    { re: /sallat|sallad|romansa/, min: 30, max: 60, source: 'typisk sallat' },
    { re: /basilika|dill|persilja|gr[aä]sl[oö]k|koriander/, min: 30, max: 60, source: 'typisk krydda' },
    { re: /[aä]rt|bona|böna/, min: 55, max: 80, source: 'typisk ärt/böna' },
    { re: /groddar|alfalfa/, min: 5, max: 10, source: 'typiska groddar' },
  ];

  for (const r of rules) {
    if (r.re.test(name)) {
      return { min: r.min, max: r.max, source: r.source };
    }
  }
  if (/grönsak/.test(cat)) return { min: 50, max: 90, source: 'typisk grönsak' };
  if (/blom/.test(cat)) return { min: 60, max: 100, source: 'typisk blomma' };
  if (/krydd/.test(cat)) return { min: 35, max: 70, source: 'typisk krydda' };
  return { min: 60, max: 90, source: 'schablon' };
}

function estimateHarvestWindow(seed, plantedAt) {
  const planted = new Date(`${plantedAt}T12:00:00`);
  if (Number.isNaN(planted.getTime())) return null;
  const year = planted.getFullYear();
  const days = inferHarvestDays(seed);

  const bloomMonths = parseMonthTokens(seed.bloom_time);
  if (bloomMonths.length && seed?.harvest_days_min == null) {
    const first = bloomMonths[0];
    const last = bloomMonths[bloomMonths.length - 1];
    const start = new Date(year, first - 1, 15);
    const end = new Date(year, last - 1, 28);
    if (start < planted) {
      start.setFullYear(year + 1);
      end.setFullYear(year + 1);
    }
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      daysMin: days.min,
      daysMax: days.max,
      source: `blomningstid + ${days.source}`,
    };
  }

  const from = new Date(planted);
  from.setDate(from.getDate() + days.min);
  const to = new Date(planted);
  to.setDate(to.getDate() + days.max);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    daysMin: days.min,
    daysMax: days.max,
    source: days.source,
  };
}

/**
 * Warn if harvest may miss autumn frost for the user's place.
 */
function plantingFrostAlert({ seed, plantedAt, climate, placeName }) {
  if (!seed || !plantedAt) return null;
  const frostIso =
    climate?.frost_date_this_year ||
    (climate?.frost_date_median_mmdd
      ? `${new Date().getFullYear()}-${climate.frost_date_median_mmdd}`
      : null);
  if (!frostIso) return null;

  const harvest = estimateHarvestWindow(seed, plantedAt);
  if (!harvest?.from || !harvest?.to) return null;

  const frost = new Date(`${frostIso}T12:00:00`);
  const earliest = new Date(`${harvest.from}T12:00:00`);
  const latest = new Date(`${harvest.to}T12:00:00`);
  const place = placeName || climate?.place_name || 'din plats';
  const frostLabel = frost.toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'long',
  });
  const daysMax = harvest.daysMax;
  const daysMin = harvest.daysMin;

  const base = {
    frostDate: frostIso,
    harvestFrom: harvest.from,
    harvestTo: harvest.to,
    daysMin,
    daysMax,
    daysSource: harvest.source,
    placeName: place,
  };

  if (earliest > frost) {
    return {
      ...base,
      level: 'danger',
      title: 'För sent att plantera för skörd i år',
      message:
        `${seed.name} tar normalt ${daysMin}–${daysMax} dagar (${harvest.source}). ` +
        `Planterat ${plantedAt} ger skörd tidigast ${harvest.from}, men i ${place} brukar första frosten komma ca ${frostLabel} ` +
        `(baserat på ${climate?.history_years || 10} års väderhistorik). Du hinner troligen inte skörda innan frosten.`,
    };
  }

  if (latest > frost) {
    const marginDays = Math.round((frost - earliest) / 86400000);
    return {
      ...base,
      level: 'warning',
      title: 'Risk att missa skörd före frost',
      message:
        `${seed.name} tar normalt ${daysMin}–${daysMax} dagar. ` +
        `Vid plantering ${plantedAt} kan skörd behövas fram till ${harvest.to}, men första frosten i ${place} brukar vara ca ${frostLabel}. ` +
        `Tidig skörd (~${daysMin} dagar) kan hinna (${marginDays} dagar till frost), men den långsamma sidan riskerar att missas.`,
    };
  }

  const cushion = Math.round((frost - latest) / 86400000);
  if (cushion <= 14) {
    return {
      ...base,
      level: 'caution',
      title: 'Knappt före frost',
      message:
        `Skörd beräknas ${harvest.from}–${harvest.to}. Första frosten i ${place} ca ${frostLabel} ` +
        `(${cushion} dagar efter sen skörd). Håll koll på vädret och täck vid behov.`,
    };
  }

  return {
    ...base,
    level: 'ok',
    title: 'Ser ut att hinna före frost',
    message:
      `Skörd ca ${harvest.from}–${harvest.to} (${daysMin}–${daysMax} dagar). ` +
      `Första frosten i ${place} brukar vara ca ${frostLabel}.`,
  };
}

function wateringAdvice({ seed, planting, weather, rainMm }) {
  const interval =
    seed?.water_interval_days ||
    waterIntervalFromText(seed?.water, 3);
  const last = planting.last_watered_at
    ? new Date(planting.last_watered_at)
    : new Date(planting.planted_at);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(last);
  due.setDate(due.getDate() + interval);
  due.setHours(0, 0, 0, 0);

  if (rainMm >= 5) {
    return {
      status: 'wait_rain',
      message: 'Vänta — regn väntas / nyligen',
      nextDate: null,
      intervalDays: interval,
    };
  }

  const diffDays = Math.round((due - today) / 86400000);
  if (diffDays <= 0) {
    return {
      status: 'water_today',
      message: 'Vattna idag',
      nextDate: today.toISOString().slice(0, 10),
      intervalDays: interval,
    };
  }
  return {
    status: 'scheduled',
    message: `Vattna om ${diffDays} dag${diffDays === 1 ? '' : 'ar'}`,
    nextDate: due.toISOString().slice(0, 10),
    intervalDays: interval,
  };
}

module.exports = {
  parseMonthTokens,
  waterIntervalFromText,
  inferHarvestDays,
  estimateHarvestWindow,
  plantingFrostAlert,
  wateringAdvice,
};
