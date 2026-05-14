(function () {
  'use strict';

  const ENERGY_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

  function normalizePostal(value) {
    if (value == null) return null;
    const digits = String(value).replace(/\D+/g, '');
    if (digits.length === 4) return '0' + digits;
    if (digits.length === 5) return digits;
    return null;
  }

  function normalizeSurface(value) {
    if (value == null) return null;
    const cleaned = String(value).replace(',', '.').replace(/[^\d.]/g, '');
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    if (!isFinite(num) || num <= 0 || num > 10000) return null;
    return Math.round(num);
  }

  function normalizeLandSurface(value) {
    if (value == null) return null;
    const cleaned = String(value).replace(',', '.').replace(/[^\d.]/g, '');
    if (!cleaned) return null;
    const num = parseFloat(cleaned);
    if (!isFinite(num) || num <= 0 || num > 999999) return null;
    return Math.round(num);
  }

  function stripAccents(str) {
    return String(str).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function detectListingKind({ category, propertyType, title } = {}) {
    const parts = [category, propertyType, title].filter(Boolean).map((p) => stripAccents(String(p)).toLowerCase());
    for (const p of parts) {
      if (/\bterrain\b|\bterrains\b|\bland\b/.test(p)) return 'land';
    }
    return 'dpe';
  }

  function normalizeSection(text) {
    if (!text) return null;
    const m = String(text).match(/\bsection\s+([A-Z]{1,2})\b/i);
    if (!m) return null;
    return m[1].toUpperCase();
  }

  function normalizeClass(value) {
    if (!value) return null;
    const letter = String(value).trim().toUpperCase().charAt(0);
    return ENERGY_CLASSES.includes(letter) ? letter : null;
  }

  function normalizePropertyType(value) {
    if (!value) return null;
    const v = String(value).toLowerCase();
    if (v.includes('maison') || v === 'house') return 'maison';
    if (v.includes('appart') || v === 'flat' || v === 'apartment') return 'appartement';
    return null;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function toISODate(year, month, day) {
    if (!year) return null;
    const y = parseInt(year, 10);
    if (!isFinite(y) || y < 2000 || y > 2100) return null;
    const m = month ? parseInt(month, 10) : null;
    const d = day ? parseInt(day, 10) : null;
    if (m && (m < 1 || m > 12)) return null;
    if (d && (d < 1 || d > 31)) return null;
    return {
      year: y,
      month: m,
      day: d,
      iso: m && d ? `${y}-${pad2(m)}-${pad2(d)}` : null,
    };
  }

  function parseDateRange(parsed) {
    if (!parsed) return null;
    const { year, month, day } = parsed;
    if (year && month && day) {
      const iso = `${year}-${pad2(month)}-${pad2(day)}`;
      return { gte: iso, lte: iso, precision: 'day' };
    }
    if (year && month) {
      const last = new Date(year, month, 0).getDate();
      return {
        gte: `${year}-${pad2(month)}-01`,
        lte: `${year}-${pad2(month)}-${pad2(last)}`,
        precision: 'month',
      };
    }
    if (year) {
      return {
        gte: `${year}-01-01`,
        lte: `${year}-12-31`,
        precision: 'year',
      };
    }
    return null;
  }

  function extractDateFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const ctx = '(?:diagnostic|dpe|énerg|energ|performance)';
    const tail = '[^.\\n]{0,80}?';

    const reFull = new RegExp(
      `${ctx}${tail}(\\b\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{4})\\b`,
      'i'
    );
    let m = text.match(reFull);
    if (m) return toISODate(m[3], m[2], m[1]);

    const reIso = new RegExp(`${ctx}${tail}(\\b\\d{4})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{1,2})\\b`, 'i');
    m = text.match(reIso);
    if (m) return toISODate(m[1], m[2], m[3]);

    const reMonthYear = new RegExp(`${ctx}${tail}(\\b\\d{1,2})[\\/\\-.](\\d{4})\\b`, 'i');
    m = text.match(reMonthYear);
    if (m) return toISODate(m[2], m[1], null);

    const reMonthName = new RegExp(
      `${ctx}${tail}(?:(\\d{1,2})\\s+)?(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\\s+(\\d{4})`,
      'i'
    );
    m = text.match(reMonthName);
    if (m) {
      const months = {
        janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5,
        juin: 6, juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10,
        novembre: 11, décembre: 12, decembre: 12,
      };
      const mo = months[m[2].toLowerCase()];
      return toISODate(m[3], mo, m[1] ? parseInt(m[1], 10) : null);
    }

    const reYear = new RegExp(`${ctx}${tail}\\b(20\\d{2})\\b`, 'i');
    m = text.match(reYear);
    if (m) return toISODate(m[1], null, null);

    return null;
  }

  function parseUserDate(input) {
    if (!input) return null;
    const trimmed = String(input).trim();
    let m = trimmed.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return toISODate(m[3], m[2], m[1]);
    m = trimmed.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
    if (m) return toISODate(m[1], m[2], m[3]);
    m = trimmed.match(/^(\d{1,2})[\/\-.](\d{4})$/);
    if (m) return toISODate(m[2], m[1], null);
    m = trimmed.match(/^(\d{4})$/);
    if (m) return toISODate(m[1], null, null);
    return null;
  }

  function getNestedValue(obj, paths) {
    for (const path of paths) {
      let cur = obj;
      let ok = true;
      for (const key of path) {
        if (cur && typeof cur === 'object' && key in cur) {
          cur = cur[key];
        } else {
          ok = false;
          break;
        }
      }
      if (ok && cur != null && cur !== '') return cur;
    }
    return null;
  }

  function deepFind(obj, predicate, maxDepth = 6) {
    const seen = new WeakSet();
    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > maxDepth) return null;
      if (seen.has(node)) return null;
      seen.add(node);
      if (predicate(node)) return node;
      if (Array.isArray(node)) {
        for (const item of node) {
          const r = walk(item, depth + 1);
          if (r) return r;
        }
      } else {
        for (const k of Object.keys(node)) {
          const r = walk(node[k], depth + 1);
          if (r) return r;
        }
      }
      return null;
    }
    return walk(obj, 0);
  }

  window.__immodexExtract = {
    normalizePostal,
    normalizeSurface,
    normalizeLandSurface,
    normalizeClass,
    normalizePropertyType,
    detectListingKind,
    normalizeSection,
    stripAccents,
    extractDateFromText,
    parseUserDate,
    parseDateRange,
    getNestedValue,
    deepFind,
    ENERGY_CLASSES,
  };
})();
