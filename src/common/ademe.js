const ADEME_BASE = 'https://data.ademe.fr/data-fair/api/v1/datasets';

const DATASETS = {
  existing: 'dpe03existant',
  newBuild: 'g3cgx7jb3cmys5voxz1mrm22',
  legacy: 'dpe-france',
};

const FIELD_MAP = {
  existing: {
    id: 'numero_dpe',
    date: 'date_etablissement_dpe',
    surface: 'surface_habitable_logement',
    postal: 'code_postal_ban',
    city: 'nom_commune_ban',
    address: 'adresse_ban',
    energyClass: 'etiquette_dpe',
    gesClass: 'etiquette_ges',
    energyConsumption: 'conso_5_usages_par_m2_ep',
    gesEmission: 'emission_ges_5_usages_par_m2',
    buildingType: 'type_batiment',
    constructionYear: 'annee_construction',
  },
  newBuild: {
    id: 'numero_dpe',
    date: 'date_etablissement_dpe',
    surface: 'surface_habitable_logement',
    postal: 'code_postal_ban',
    city: 'nom_commune_ban',
    address: 'adresse_ban',
    energyClass: 'etiquette_dpe',
    gesClass: 'etiquette_ges',
    energyConsumption: 'conso_5_usages_par_m2_ep',
    gesEmission: 'emission_ges_5_usages_par_m2',
    buildingType: 'type_batiment',
    constructionYear: 'annee_construction',
  },
  legacy: {
    id: 'numero_dpe',
    date: 'date_etablissement_dpe',
    surface: 'surface_habitable',
    postal: 'code_postal',
    city: 'commune',
    address: 'geo_adresse',
    energyClass: 'classe_consommation_energie',
    gesClass: 'classe_estimation_ges',
    energyConsumption: 'consommation_energie',
    gesEmission: 'estimation_ges',
    buildingType: 'tr002_type_batiment_description',
    constructionYear: 'annee_construction',
  },
};

function buildSelect(fields) {
  return Object.values(fields).join(',');
}

function buildAdemeUrl({ dataset, filters, size = 20, sort }) {
  const fieldMap = FIELD_MAP[dataset === DATASETS.legacy ? 'legacy' : dataset === DATASETS.newBuild ? 'newBuild' : 'existing'];
  const params = new URLSearchParams();
  params.set('size', String(size));
  params.set('select', buildSelect(fieldMap));
  if (sort) params.set('sort', sort);

  for (const [op, list] of Object.entries(filters || {})) {
    for (const [field, value] of list) {
      if (value === null || value === undefined || value === '') continue;
      params.append(`${field}_${op}`, String(value));
    }
  }

  return {
    url: `${ADEME_BASE}/${dataset}/lines?${params.toString()}`,
    fieldMap,
  };
}

function normalizeRecord(raw, fieldMap) {
  return {
    id: raw[fieldMap.id] ?? null,
    date: raw[fieldMap.date] ?? null,
    surface: raw[fieldMap.surface] != null ? Number(raw[fieldMap.surface]) : null,
    postal: raw[fieldMap.postal] ?? null,
    city: raw[fieldMap.city] ?? null,
    address: raw[fieldMap.address] ?? null,
    energyClass: raw[fieldMap.energyClass] ?? null,
    gesClass: raw[fieldMap.gesClass] ?? null,
    energyConsumption: raw[fieldMap.energyConsumption] ?? null,
    gesEmission: raw[fieldMap.gesEmission] ?? null,
    buildingType: raw[fieldMap.buildingType] ?? null,
    constructionYear: raw[fieldMap.constructionYear] ?? null,
    raw,
  };
}

async function queryAdeme({ dataset, filters, size = 20, sort }) {
  const { url, fieldMap } = buildAdemeUrl({ dataset, filters, size, sort });
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    throw new Error(`ADEME API error ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  const rows = Array.isArray(data?.results) ? data.results : [];
  return {
    total: data?.total ?? rows.length,
    records: rows.map((r) => normalizeRecord(r, fieldMap)),
    url,
  };
}

export { ADEME_BASE, DATASETS, FIELD_MAP, buildAdemeUrl, queryAdeme, normalizeRecord };
