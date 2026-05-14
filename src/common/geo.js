const GEO_BASE = 'https://geo.api.gouv.fr';
const BAN_BASE = 'https://api-adresse.data.gouv.fr';
const INSEE_TTL_MS = 60 * 60 * 1000;
const BAN_TTL_MS = 24 * 60 * 60 * 1000;
const INSEE_STORE_KEY = 'immodex.cache.insee.v1';
const BAN_STORE_KEY = 'immodex.cache.ban.v1';

const inseeMemory = new Map();
const banMemory = new Map();
let storesLoaded = false;
let loadPromise = null;

function stripAccents(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizeCity(str) {
  return stripAccents(str).toLowerCase().replace(/[-'\s]+/g, ' ').trim();
}

async function loadStores() {
  if (storesLoaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const stored = await chrome.storage.session.get([INSEE_STORE_KEY, BAN_STORE_KEY]);
      const now = Date.now();
      const insee = stored[INSEE_STORE_KEY];
      if (insee && typeof insee === 'object') {
        for (const [k, v] of Object.entries(insee)) {
          if (v && v.expiresAt > now) inseeMemory.set(k, v);
        }
      }
      const ban = stored[BAN_STORE_KEY];
      if (ban && typeof ban === 'object') {
        for (const [k, v] of Object.entries(ban)) {
          if (v && v.expiresAt > now) banMemory.set(k, v);
        }
      }
    } catch (e) {
      // session storage unavailable — fall back to memory only
    }
    storesLoaded = true;
  })();
  return loadPromise;
}

async function persist(key, map) {
  try {
    const obj = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    await chrome.storage.session.set({ [key]: obj });
  } catch (e) {
    // ignore
  }
}

function getMemo(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function setMemo(map, key, value, ttl) {
  map.set(key, { value, expiresAt: Date.now() + ttl });
}

async function resolveInseeCodes(postal, city) {
  if (!postal) return [];
  await loadStores();
  const cityKey = city ? normalizeCity(city) : '';
  const cacheKey = `${postal}|${cityKey}`;
  const cached = getMemo(inseeMemory, cacheKey);
  if (cached) return cached;

  const url = `${GEO_BASE}/communes?codePostal=${encodeURIComponent(postal)}&fields=code,nom,population&format=json`;
  let list;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`geo.api ${res.status}`);
    list = await res.json();
  } catch (err) {
    return [];
  }
  if (!Array.isArray(list)) return [];

  const candidates = list
    .filter((c) => c && c.code)
    .map((c) => ({ code: c.code, nom: c.nom || '', population: typeof c.population === 'number' ? c.population : 0 }));

  let result = candidates;
  if (cityKey) {
    const exact = candidates.filter((c) => normalizeCity(c.nom) === cityKey);
    if (exact.length > 0) result = exact;
    else {
      const partial = candidates.filter((c) => normalizeCity(c.nom).includes(cityKey) || cityKey.includes(normalizeCity(c.nom)));
      if (partial.length > 0) result = partial;
    }
  }
  result = result.slice().sort((a, b) => (b.population || 0) - (a.population || 0));

  setMemo(inseeMemory, cacheKey, result, INSEE_TTL_MS);
  persist(INSEE_STORE_KEY, inseeMemory);
  return result;
}

function roundCoord(n) {
  return Math.round(n * 100000) / 100000;
}

async function banReverse(lon, lat) {
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  await loadStores();
  const key = `${roundCoord(lon)},${roundCoord(lat)}`;
  const cached = getMemo(banMemory, key);
  if (cached !== null && cached !== undefined) return cached;

  const url = `${BAN_BASE}/reverse/?lon=${roundCoord(lon)}&lat=${roundCoord(lat)}&limit=1`;
  let data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`BAN ${res.status}`);
    data = await res.json();
  } catch (err) {
    return null;
  }
  const f = Array.isArray(data?.features) ? data.features[0] : null;
  if (!f || !f.properties) {
    setMemo(banMemory, key, null, BAN_TTL_MS);
    persist(BAN_STORE_KEY, banMemory);
    return null;
  }
  const p = f.properties;
  const value = {
    label: p.label || null,
    housenumber: p.housenumber || null,
    street: p.street || p.name || null,
    postcode: p.postcode || null,
    city: p.city || null,
  };
  setMemo(banMemory, key, value, BAN_TTL_MS);
  persist(BAN_STORE_KEY, banMemory);
  return value;
}

export { resolveInseeCodes, banReverse, normalizeCity, stripAccents };
