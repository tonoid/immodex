const APICARTO_BASE = 'https://apicarto.ign.fr/api/cadastre/parcelle';
const PAGE_LIMIT = 500;

function centroid(geom) {
  if (!geom || !geom.type) return null;
  const rings = geom.type === 'MultiPolygon' ? geom.coordinates.flat() : geom.coordinates;
  if (!Array.isArray(rings) || rings.length === 0) return null;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const ring of rings) {
    if (!Array.isArray(ring)) continue;
    for (const pt of ring) {
      if (!Array.isArray(pt) || pt.length < 2) continue;
      sx += pt[0];
      sy += pt[1];
      n++;
    }
  }
  if (n === 0) return null;
  return [sx / n, sy / n];
}

function buildUrl({ codeInsee, contenance, section }) {
  const params = new URLSearchParams();
  params.set('code_insee', codeInsee);
  if (contenance != null) params.set('contenance', String(contenance));
  if (section) params.set('section', section);
  params.set('_limit', String(PAGE_LIMIT));
  return `${APICARTO_BASE}?${params.toString()}`;
}

async function fetchExact({ codeInsee, contenance, section }) {
  const url = buildUrl({ codeInsee, contenance, section });
  try {
    const res = await fetch(url);
    if (!res.ok) return { url, features: [], error: `apicarto ${res.status}` };
    const data = await res.json();
    const features = Array.isArray(data?.features) ? data.features : [];
    return { url, features };
  } catch (err) {
    return { url, features: [], error: String(err.message || err) };
  }
}

function featureToParcel(feature, codeInsee) {
  const p = feature?.properties || {};
  const geometry = feature?.geometry || null;
  return {
    idu: p.idu || null,
    section: p.section || null,
    numero: p.numero || null,
    contenance: typeof p.contenance === 'number' ? p.contenance : (p.contenance != null ? Number(p.contenance) : null),
    nom_com: p.nom_com || null,
    codeInsee: p.code_insee || codeInsee,
    centroid: centroid(geometry),
    geometry,
  };
}

function rangeAround(surface, delta) {
  const values = [];
  for (let i = -delta; i <= delta; i++) {
    const v = surface + i;
    if (v > 0) values.push(v);
  }
  return values;
}

async function queryParcels({ codeInsee, surface, section }) {
  if (!codeInsee || !surface) return { features: [], tier: 0, tried: [] };

  const tried = [];
  const seen = new Map();

  async function runTier(values, sectionFilter, tierLabel) {
    const results = await Promise.all(values.map((v) => fetchExact({ codeInsee, contenance: v, section: sectionFilter })));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      tried.push({ tier: tierLabel, codeInsee, contenance: values[i], section: sectionFilter || null, url: r.url, count: r.features.length, error: r.error || null });
      for (const f of r.features) {
        const parcel = featureToParcel(f, codeInsee);
        if (!parcel.idu) continue;
        if (!seen.has(parcel.idu)) seen.set(parcel.idu, parcel);
      }
    }
  }

  await runTier(rangeAround(surface, 1), section || null, 1);
  if (seen.size >= 3) {
    return { features: Array.from(seen.values()), tier: 1, tried };
  }

  await runTier(rangeAround(surface, 5), section || null, 2);
  if (seen.size >= 3) {
    return { features: Array.from(seen.values()), tier: 2, tried };
  }

  const canTier3 = !!section || surface >= 200;
  if (canTier3) {
    await runTier(rangeAround(surface, 20), section || null, 3);
  }

  return { features: Array.from(seen.values()), tier: canTier3 ? 3 : 2, tried };
}

export { queryParcels, centroid, fetchExact, APICARTO_BASE };
