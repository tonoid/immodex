import { runLookup, runLandLookup } from '../common/match.js';

const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 60 * 60 * 1000;
const LAND_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'immodex.cache.v1';
const LAND_STORAGE_KEY = 'immodex.cache.land.v1';
const MAX_CONCURRENT = 4;
const MAX_LAND_CONCURRENT = 16;

const memoryCache = new Map();
const landCache = new Map();
let inflight = 0;
let landInflight = 0;
const pending = [];
const landPending = [];

function hashPayload(payload) {
  const kind = payload.kind || 'dpe';
  if (kind === 'land') {
    return [
      'land',
      payload.postal || '',
      payload.city || '',
      payload.surface || '',
      payload.section || '',
    ].join('|');
  }
  const parts = [
    'dpe',
    payload.postal || '',
    payload.surface || '',
    payload.energyClass || '',
    payload.gesClass || '',
    payload.buildingType || '',
    payload.dateRange ? `${payload.dateRange.gte}_${payload.dateRange.lte}` : '',
    payload.isNewBuild ? 'new' : 'ex',
  ];
  return parts.join('|');
}

async function loadPersistedCache() {
  try {
    const stored = await chrome.storage.session.get(STORAGE_KEY);
    const data = stored[STORAGE_KEY];
    if (data && typeof data === 'object') {
      const now = Date.now();
      for (const [key, entry] of Object.entries(data)) {
        if (entry && entry.expiresAt > now) {
          memoryCache.set(key, entry);
        }
      }
    }
  } catch (e) {
    // chrome.storage.session unavailable — ignore
  }
}

async function loadLandCache() {
  try {
    const stored = await chrome.storage.local.get(LAND_STORAGE_KEY);
    const data = stored[LAND_STORAGE_KEY];
    if (data && typeof data === 'object') {
      const now = Date.now();
      for (const [key, entry] of Object.entries(data)) {
        if (entry && entry.expiresAt > now) {
          landCache.set(key, entry);
        }
      }
    }
  } catch (e) {
    // ignore
  }
}

async function persistCache() {
  try {
    const obj = {};
    for (const [k, v] of memoryCache.entries()) obj[k] = v;
    await chrome.storage.session.set({ [STORAGE_KEY]: obj });
  } catch (e) {
    // ignore
  }
}

async function persistLandCache() {
  try {
    const obj = {};
    for (const [k, v] of landCache.entries()) obj[k] = v;
    await chrome.storage.local.set({ [LAND_STORAGE_KEY]: obj });
  } catch (e) {
    // ignore
  }
}

function trimMap(map, max) {
  while (map.size > max) {
    const oldestKey = map.keys().next().value;
    map.delete(oldestKey);
  }
}

function getFromMap(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  map.delete(key);
  map.set(key, entry);
  return entry.value;
}

function getFromCache(key) {
  return getFromMap(memoryCache, key);
}

function setCache(key, value) {
  memoryCache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  trimMap(memoryCache, MAX_CACHE_ENTRIES);
  persistCache();
}

function getFromLandCache(key) {
  return getFromMap(landCache, key);
}

function setLandCache(key, value) {
  landCache.set(key, { value, expiresAt: Date.now() + LAND_CACHE_TTL_MS });
  trimMap(landCache, MAX_CACHE_ENTRIES);
  persistLandCache();
}

function acquireSlot() {
  return new Promise((resolve) => {
    if (inflight < MAX_CONCURRENT) {
      inflight++;
      resolve();
    } else {
      pending.push(resolve);
    }
  });
}

function releaseSlot() {
  inflight--;
  const next = pending.shift();
  if (next) {
    inflight++;
    next();
  }
}

function acquireLandSlot() {
  return new Promise((resolve) => {
    if (landInflight < MAX_LAND_CONCURRENT) {
      landInflight++;
      resolve();
    } else {
      landPending.push(resolve);
    }
  });
}

function releaseLandSlot() {
  landInflight--;
  const next = landPending.shift();
  if (next) {
    landInflight++;
    next();
  }
}

async function handleLookup(payload) {
  if (payload && payload.kind === 'land') {
    const key = hashPayload(payload);
    const cached = getFromLandCache(key);
    if (cached) return { ...cached, cached: true };

    await acquireLandSlot();
    try {
      const result = await runLandLookup(payload);
      setLandCache(key, result);
      return { ...result, cached: false };
    } finally {
      releaseLandSlot();
    }
  }

  const key = hashPayload(payload);
  const cached = getFromCache(key);
  if (cached) return { ...cached, cached: true };

  await acquireSlot();
  try {
    const result = await runLookup(payload);
    setCache(key, result);
    return { ...result, cached: false };
  } finally {
    releaseSlot();
  }
}

loadPersistedCache();
loadLandCache();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'LOOKUP') {
    handleLookup(message.payload || {})
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }
  if (message.type === 'CACHE_CLEAR') {
    memoryCache.clear();
    landCache.clear();
    persistCache();
    persistLandCache();
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
