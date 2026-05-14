(function () {
  'use strict';

  const ex = window.__immodexExtract;
  const ui = window.__immodexOverlay;

  function readLifecycleData() {
    const node = document.getElementById('__UFRN_LIFECYCLE_SERVERREQUEST__');
    if (!node || !node.textContent) return null;
    const m = node.textContent.match(/JSON\.parse\((".*")\)/s);
    if (!m) return null;
    try {
      const inner = JSON.parse(m[1]);
      return JSON.parse(inner);
    } catch (err) {
      console.warn('[immodex seloger] lifecycle parse error:', err);
      return null;
    }
  }

  function findClassified(lifecycle) {
    if (!lifecycle) return null;
    for (const key of Object.keys(lifecycle)) {
      const app = lifecycle[key];
      const c = app?.data?.classified;
      if (c) return c;
    }
    return null;
  }

  function extractFromClassified(classified) {
    if (!classified) return null;
    const sections = classified.sections || {};
    const address = sections.location?.address || {};
    const postal = ex.normalizePostal(address.zipCode);
    const city = address.city || null;
    const rawType = classified.rawData?.propertyType || '';
    const hardTitle = sections.hardFacts?.title || '';

    const facts = sections.hardFacts?.facts || [];
    let landSpace = null;
    let livingSpace = null;
    for (const f of facts) {
      if (f.type === 'landSpace') landSpace = ex.normalizeLandSurface(f.splitValue || f.value);
      else if (f.type === 'livingSpace') livingSpace = ex.normalizeSurface(f.splitValue || f.value);
    }

    const isLand = /terrain/i.test(rawType) || /terrain/i.test(hardTitle);

    if (isLand) {
      const description = sections.description?.description || '';
      const surface = landSpace != null ? landSpace : ex.normalizeLandSurface(livingSpace);
      const section = ex.normalizeSection(description);
      return {
        kind: 'land',
        postal,
        city,
        surface,
        section,
        source: 'seloger-json',
      };
    }

    const surface = livingSpace;

    let energyClass = null;
    let gesClass = null;
    const certs = sections.energy?.certificates || [];
    for (const cert of certs) {
      for (const scale of cert.scales || []) {
        const rating = scale.efficiencyClass?.rating;
        if (!rating) continue;
        const type = String(scale.type || '').toUpperCase();
        if (type.includes('GHG') || type.includes('GES')) {
          gesClass = gesClass || ex.normalizeClass(rating);
        } else if (type.includes('ENERGY') || type.includes('DPE')) {
          energyClass = energyClass || ex.normalizeClass(rating);
        }
      }
    }

    let buildingType = null;
    if (/maison|house/i.test(rawType) || /maison/i.test(hardTitle)) buildingType = 'maison';
    else if (/appart|flat/i.test(rawType) || /appart/i.test(hardTitle)) buildingType = 'appartement';

    const description = sections.description?.description || '';
    const dateParsed = ex.extractDateFromText(description);
    const dateRange = ex.parseDateRange(dateParsed);
    const isNewBuild = classified.metadata?.isNewBuildProject === true || /neuf|vefa/i.test(description);

    return {
      kind: 'dpe',
      postal,
      city,
      surface,
      energyClass,
      gesClass,
      buildingType,
      dateRange,
      isNewBuild,
      source: 'seloger-json',
    };
  }

  function extractFromDom() {
    const title = document.title || '';
    const metaDesc =
      document.querySelector('meta[name="description"]')?.getAttribute('content') ||
      document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      '';
    const sources = [title, metaDesc, document.body.innerText || ''];

    let postal = null;
    let city = null;
    for (const text of sources) {
      const m = text.match(/\b(\d{5})\b/);
      if (m) {
        postal = m[1];
        break;
      }
    }
    for (const text of sources) {
      const m = text.match(/\(?(\d{5})\)?\s*$/) || text.match(/\b\d{5}\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-' ]{1,40})/);
      if (m && m[1] && /[A-Za-z]/.test(m[1])) {
        city = m[1].trim();
        break;
      }
    }

    const bodyText = document.body.innerText || '';
    const isLand =
      /\bterrain[s]?\b/i.test(title) ||
      /\/terrain/i.test(location.pathname) ||
      /\bterrain[s]?\b/i.test(metaDesc);

    if (isLand) {
      let landSurface = null;
      for (const text of sources) {
        const m = text.match(/(\d{1,6})\s*m(?:²|2)\b/i);
        if (m) {
          landSurface = ex.normalizeLandSurface(m[1]);
          if (landSurface) break;
        }
      }
      const section = ex.normalizeSection(bodyText);
      if (!landSurface || !postal) return null;
      return {
        kind: 'land',
        postal,
        city,
        surface: landSurface,
        section,
        source: 'seloger-dom',
      };
    }

    let surface = null;
    for (const text of sources) {
      const m = text.match(/(\d{1,4})\s*m(?:²|2)\b/i);
      if (m) {
        surface = ex.normalizeSurface(m[1]);
        if (surface) break;
      }
    }

    let buildingType = null;
    if (/maison/i.test(title)) buildingType = 'maison';
    else if (/appart/i.test(title)) buildingType = 'appartement';

    const dateParsed = ex.extractDateFromText(bodyText);
    const dateRange = ex.parseDateRange(dateParsed);
    const isNewBuild = /neuf|vefa|programme\s+neuf/i.test(bodyText);

    if (!surface || !postal) return null;
    return {
      kind: 'dpe',
      postal,
      city,
      surface,
      energyClass: null,
      gesClass: null,
      buildingType,
      dateRange,
      isNewBuild,
      source: 'seloger-dom',
    };
  }

  function tryExtract() {
    const lifecycle = readLifecycleData();
    const classified = findClassified(lifecycle);
    let payload = extractFromClassified(classified);
    if (!payload || !payload.surface || !payload.postal) {
      const fallback = extractFromDom();
      if (fallback) payload = { ...(payload || {}), ...fallback };
    }
    return payload;
  }

  async function runLookup(payload) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'LOOKUP', payload });
      if (!response || response.ok !== true) {
        ui.showError(response?.error || 'Erreur inconnue', payload);
        return;
      }
      if (payload.kind === 'land' || response.result?.kind === 'land') {
        ui.showLandResult(payload, response.result, () => openOverride(payload));
      } else {
        ui.showResult(payload, response.result, () => openOverride(payload));
      }
    } catch (err) {
      ui.showError(String(err.message || err), payload);
    }
  }

  function openOverride(payload) {
    try {
      sessionStorage.setItem('immodex.override.payload', JSON.stringify(payload));
    } catch {}
    alert("Ouvrez l’extension (icône dans la barre) pour modifier les champs et relancer la recherche.");
  }

  async function onButtonClick() {
    try {
      console.log('[immodex seloger] click. url=', location.href);
      ui.showLoading({ postal: null, surface: null, energyClass: null, gesClass: null });
      let payload = tryExtract();
      let attempts = 1;
      while ((!payload || !payload.surface || !payload.postal) && attempts < 4) {
        await new Promise((r) => setTimeout(r, 350));
        const next = tryExtract();
        if (next) payload = { ...(payload || {}), ...next };
        attempts++;
      }
      console.log('[immodex seloger] payload:', payload, 'attempts:', attempts);
      if (!payload || !payload.surface || !payload.postal) {
        ui.showError(
          "Impossible d'extraire les données DPE de cette page. Utilisez l’extension (icône) pour saisir manuellement.",
          payload
        );
        return;
      }
      if (payload.kind === 'land') {
        ui.showLoading(payload);
        runLookup(payload);
        return;
      }
      if (!payload.dateRange) {
        ui.showDatePrompt(payload, (updated) => {
          ui.showLoading(updated);
          runLookup(updated);
        });
        return;
      }
      ui.showLoading(payload);
      runLookup(payload);
    } catch (err) {
      console.error('[immodex seloger] click error:', err);
      ui.showError('Erreur: ' + (err.message || String(err)), null);
    }
  }

  function ensureButton() {
    ui.mountFloatingButton("Immodex — trouver l’adresse", onButtonClick);
  }

  function init() {
    ensureButton();
    setInterval(ensureButton, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  ui.onNavigate(() => {
    console.log('[immodex seloger] SPA nav — reset');
    ui.closeCard();
    ui.resetFloatingButton();
    setTimeout(init, 200);
  });
})();
