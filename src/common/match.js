import { DATASETS, queryAdeme } from './ademe.js';
import { queryParcels } from './apicarto.js';
import { resolveInseeCodes, banReverse } from './geo.js';

function shiftIsoDate(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function widenDateRange(range, days) {
  if (!range) return null;
  return {
    gte: shiftIsoDate(range.gte, -days),
    lte: shiftIsoDate(range.lte, days),
    precision: range.precision,
  };
}

function buildFilters(payload, dataset, tier) {
  const filters = { eq: [], gte: [], lte: [], in: [] };
  const isLegacy = dataset === DATASETS.legacy;
  const f = {
    postal: isLegacy ? 'code_postal' : 'code_postal_ban',
    surface: isLegacy ? 'surface_habitable' : 'surface_habitable_logement',
    energy: isLegacy ? 'classe_consommation_energie' : 'etiquette_dpe',
    ges: isLegacy ? 'classe_estimation_ges' : 'etiquette_ges',
    date: 'date_etablissement_dpe',
    building: isLegacy ? 'tr002_type_batiment_description' : 'type_batiment',
  };

  if (payload.postal) filters.eq.push([f.postal, payload.postal]);

  let surfaceTolerance = 1;
  if (tier >= 3) surfaceTolerance = 3;
  if (payload.surface) {
    filters.gte.push([f.surface, payload.surface - surfaceTolerance]);
    filters.lte.push([f.surface, payload.surface + surfaceTolerance]);
  }

  const noDate = !payload.dateRange;
  const energyMaxTier = noDate ? 3 : 3;
  const gesMaxTier = noDate ? 1 : 2;
  if (payload.energyClass && tier <= energyMaxTier) filters.eq.push([f.energy, payload.energyClass]);
  if (payload.gesClass && tier <= gesMaxTier) filters.eq.push([f.ges, payload.gesClass]);

  let dateRange = payload.dateRange;
  if (dateRange) {
    if (tier === 2) dateRange = widenDateRange(dateRange, 7);
    if (tier >= 3) dateRange = widenDateRange(dateRange, 30);
    filters.gte.push([f.date, dateRange.gte]);
    filters.lte.push([f.date, dateRange.lte]);
  }

  return filters;
}

function scoreRecord(record, payload) {
  let score = 0;
  const reasons = [];
  const diffs = [];

  if (payload.surface != null && record.surface != null) {
    const diff = Math.abs(record.surface - payload.surface);
    if (diff === 0) {
      score += 30;
      reasons.push('surface exacte');
    } else if (diff <= 1) {
      score += 22;
      reasons.push('surface ±1');
    } else if (diff <= 3) {
      score += 10;
      diffs.push(`surface ${record.surface} vs ${payload.surface}`);
    } else {
      diffs.push(`surface ${record.surface} vs ${payload.surface}`);
    }
  }

  if (payload.dateRange && record.date) {
    const recordIso = String(record.date).slice(0, 10);
    if (recordIso >= payload.dateRange.gte && recordIso <= payload.dateRange.lte) {
      score += 30;
      reasons.push('date dans la fenêtre');
    } else {
      const target = new Date(payload.dateRange.gte + 'T00:00:00Z').getTime();
      const got = new Date(recordIso + 'T00:00:00Z').getTime();
      const days = Math.abs(target - got) / (1000 * 60 * 60 * 24);
      if (days <= 7) score += 18;
      else if (days <= 30) score += 8;
      diffs.push(`date ${recordIso} vs ${payload.dateRange.gte}…${payload.dateRange.lte}`);
    }
  }

  if (payload.energyClass && record.energyClass) {
    if (record.energyClass === payload.energyClass) {
      score += 15;
      reasons.push(`classe ${record.energyClass}`);
    } else {
      diffs.push(`classe ${record.energyClass} vs ${payload.energyClass}`);
    }
  }

  if (payload.gesClass && record.gesClass) {
    if (record.gesClass === payload.gesClass) {
      score += 15;
      reasons.push(`GES ${record.gesClass}`);
    } else {
      diffs.push(`GES ${record.gesClass} vs ${payload.gesClass}`);
    }
  }

  if (payload.buildingType && record.buildingType) {
    const recordType = String(record.buildingType).toLowerCase();
    if (recordType.includes(payload.buildingType)) {
      score += 10;
      reasons.push(payload.buildingType);
    }
  }

  return { score: Math.min(100, score), reasons, diffs };
}

function pickDataset(payload) {
  const range = payload.dateRange;
  if (range) {
    const start = range.gte;
    if (start && start < '2021-07-01') return DATASETS.legacy;
  }
  if (payload.isNewBuild) return DATASETS.newBuild;
  return DATASETS.existing;
}

async function runLookup(payload) {
  const primaryDataset = pickDataset(payload);
  const tried = [];
  const datasetsToTry = [primaryDataset];
  if (primaryDataset !== DATASETS.legacy) datasetsToTry.push(DATASETS.legacy);
  if (primaryDataset !== DATASETS.existing && !datasetsToTry.includes(DATASETS.existing)) {
    datasetsToTry.push(DATASETS.existing);
  }

  let lastResult = null;
  let usedDataset = primaryDataset;
  let usedTier = 1;

  for (const dataset of datasetsToTry) {
    for (let tier = 1; tier <= 3; tier++) {
      const filters = buildFilters(payload, dataset, tier);
      try {
        const result = await queryAdeme({ dataset, filters, size: 20 });
        tried.push({ dataset, tier, total: result.total, url: result.url });
        if (result.records.length > 0) {
          usedDataset = dataset;
          usedTier = tier;
          lastResult = result;
          break;
        }
      } catch (err) {
        tried.push({ dataset, tier, error: String(err.message || err) });
      }
    }
    if (lastResult && lastResult.records.length > 0) break;
  }

  if (!lastResult || lastResult.records.length === 0) {
    return {
      ok: true,
      candidates: [],
      tried,
      dataset: primaryDataset,
      tier: 3,
      highConfidence: false,
    };
  }

  const scored = lastResult.records
    .map((record) => ({ record, ...scoreRecord(record, payload) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  const second = scored[1];
  const margin = second ? top.score - second.score : top.score;
  const highConfidence = top.score >= 80 && margin >= 20;

  return {
    ok: true,
    candidates: scored.slice(0, 5),
    tried,
    dataset: usedDataset,
    tier: usedTier,
    margin,
    highConfidence,
  };
}

function scoreParcel(parcel, payload, inseeCount) {
  let score = 0;
  const reasons = [];
  const diffs = [];

  if (payload.surface != null && parcel.contenance != null) {
    const diff = Math.abs(parcel.contenance - payload.surface);
    if (diff === 0) {
      score += 50;
      reasons.push('contenance exacte');
    } else if (diff <= 1) {
      score += 35;
      reasons.push('contenance ±1 m²');
    } else if (diff <= 5) {
      score += 15;
      reasons.push('contenance ±5 m²');
    }
    if (diff > 10) {
      score -= 10;
      diffs.push(`contenance ${parcel.contenance} vs ${payload.surface}`);
    } else if (diff > 0) {
      diffs.push(`contenance ${parcel.contenance} vs ${payload.surface}`);
    }
  }

  if (payload.section && parcel.section) {
    if (String(parcel.section).toUpperCase() === String(payload.section).toUpperCase()) {
      score += 15;
      reasons.push(`section ${parcel.section}`);
    }
  }

  if (inseeCount === 1) {
    score += 10;
    reasons.push('commune unique');
  }

  return { score: Math.max(0, Math.min(100, score)), reasons, diffs };
}

async function runLandLookup(payload) {
  const tried = [];
  if (!payload.postal || !payload.surface) {
    return { ok: true, kind: 'land', candidates: [], tried, tier: 0, total: 0, highConfidence: false };
  }

  const insees = await resolveInseeCodes(payload.postal, payload.city);
  tried.push({ step: 'insee', postal: payload.postal, city: payload.city || null, count: insees.length, codes: insees.map((i) => i.code) });
  if (insees.length === 0) {
    return { ok: true, kind: 'land', candidates: [], tried, tier: 0, total: 0, highConfidence: false };
  }

  const parcelResults = await Promise.all(
    insees.map((insee) => queryParcels({ codeInsee: insee.code, surface: payload.surface, section: payload.section || null }))
  );

  const merged = new Map();
  let maxTier = 0;
  for (let i = 0; i < parcelResults.length; i++) {
    const r = parcelResults[i];
    tried.push({ step: 'apicarto', codeInsee: insees[i].code, tier: r.tier, count: r.features.length, sub: r.tried });
    if (r.tier > maxTier) maxTier = r.tier;
    for (const p of r.features) {
      if (!p.idu) continue;
      if (!merged.has(p.idu)) merged.set(p.idu, p);
    }
  }

  const total = merged.size;
  if (total === 0) {
    return { ok: true, kind: 'land', candidates: [], tried, tier: maxTier, total: 0, highConfidence: false };
  }

  const scored = Array.from(merged.values())
    .map((parcel) => ({ parcel, ...scoreParcel(parcel, payload, insees.length) }))
    .sort((a, b) => b.score - a.score);

  const top5 = scored.slice(0, 5);

  await Promise.all(
    top5.map(async (item) => {
      if (!Array.isArray(item.parcel.centroid)) return;
      const [lon, lat] = item.parcel.centroid;
      const ban = await banReverse(lon, lat);
      if (ban) {
        item.parcel.address = ban.label || null;
        item.parcel.street = ban.street || null;
        item.parcel.banPostcode = ban.postcode || null;
        item.parcel.banCity = ban.city || null;
      }
    })
  );

  const top = top5[0];
  const second = top5[1];
  const margin = second ? top.score - second.score : top.score;
  const highConfidence = top.score >= 70 && margin >= 30;

  return {
    ok: true,
    kind: 'land',
    candidates: top5,
    tried,
    tier: maxTier,
    total,
    margin,
    highConfidence,
    inseeCount: insees.length,
    insees,
  };
}

export { runLookup, runLandLookup, scoreRecord, scoreParcel, buildFilters, pickDataset };
