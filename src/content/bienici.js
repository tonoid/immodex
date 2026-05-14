(function () {
  'use strict';

  const ex = window.__immodexExtract;
  const ui = window.__immodexOverlay;
  const STATE = { injectedFor: null };

  function readInitialState() {
    if (window.__INITIAL_STATE__ && typeof window.__INITIAL_STATE__ === 'object') {
      return window.__INITIAL_STATE__;
    }
    for (const tag of document.querySelectorAll('script')) {
      const t = tag.textContent || '';
      const m = t.match(/__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})\s*;?\s*(?:window|<\/script>|$)/);
      if (m) {
        try {
          return JSON.parse(m[1]);
        } catch {}
      }
    }
    if (typeof window.realEstateAd === 'object' && window.realEstateAd) return { realEstateAd: window.realEstateAd };
    return null;
  }

  function findAd(state) {
    if (!state) return null;
    if (state.realEstateAd && typeof state.realEstateAd === 'object') return state.realEstateAd;
    return ex.deepFind(
      state,
      (n) =>
        n &&
        typeof n === 'object' &&
        ('energyClassification' in n || 'greenhouseGasEmission' in n || 'surfaceArea' in n) &&
        ('postalCode' in n || 'city' in n)
    );
  }

  function extractFromAd(ad) {
    if (!ad) return null;
    const postal = ex.normalizePostal(ad.postalCode);
    const city = ad.city || null;
    const text = [ad.title, ad.description, ad.descriptive].filter(Boolean).join('\n');

    const rawType = ad.propertyType || ad.adType || '';
    const kindFromType = /terrain|land/i.test(String(rawType));
    const kindFromTitle = /terrain/i.test(ad.title || '');
    const onlyLandSurface = ad.landSurface != null && (ad.livingArea == null && ad.surfaceArea == null);
    const isLand = kindFromType || kindFromTitle || onlyLandSurface;

    if (isLand) {
      const surface = ex.normalizeLandSurface(ad.landSurface ?? ad.surfaceArea ?? ad.surface);
      const section = ex.normalizeSection(text);
      return {
        kind: 'land',
        postal,
        city,
        surface,
        section,
        source: 'bienici-state',
      };
    }

    const surface = ex.normalizeSurface(ad.surfaceArea ?? ad.surface);
    const energy = ex.normalizeClass(ad.energyClassification ?? ad.energyValue);
    const ges = ex.normalizeClass(ad.greenhouseGasEmissionValueClassification ?? ad.greenhouseGasEmissionClassification);
    const buildingType = ex.normalizePropertyType(rawType);
    const dateParsed = ex.extractDateFromText(text);
    const dateRange = ex.parseDateRange(dateParsed);
    const isNewBuild = ad.isNewProperty === true || /neuf|vefa/i.test(text || '');

    return {
      kind: 'dpe',
      postal,
      city,
      surface,
      energyClass: energy,
      gesClass: ges,
      buildingType,
      dateRange,
      isNewBuild,
      source: 'bienici-state',
    };
  }

  function extractFromDom() {
    const energyEl = document.querySelector(
      '.energy-diagnostic__letter--active, .dpe-bar__letter--active, [class*="energyClassification"][class*="active"]'
    );
    const gesEl = document.querySelector(
      '.ges-diagnostic__letter--active, .ges-bar__letter--active, [class*="greenhouseGasEmission"][class*="active"]'
    );
    const surfaceEl =
      document.querySelector('[class*="surfaceArea"]') ||
      document.querySelector('.fullAdSummary__data--surfaceArea');
    const postalEl = document.querySelector('[class*="postalCode"], .fullAdHeader__address');
    const descEl = document.querySelector('.fullAdDescription, .ad-description, [class*="description"]');

    let energy = ex.normalizeClass(energyEl?.textContent);
    let ges = ex.normalizeClass(gesEl?.textContent);
    let surface = ex.normalizeSurface(surfaceEl?.textContent);
    let postal = null;
    let city = null;
    if (postalEl?.textContent) {
      const m = postalEl.textContent.match(/\b(\d{5})\b/);
      if (m) postal = m[1];
      const cm = postalEl.textContent.replace(/\d{5}/, '').trim();
      if (cm) city = cm;
    }

    const pageTitle =
      document.querySelector('h1, [class*="adTitle"], [class*="ad-title"]')?.textContent ||
      document.title ||
      '';
    const docText = document.documentElement.textContent || '';
    const bodyTextEarly = document.body.innerText || '';
    const metaDesc =
      document.querySelector('meta[name="description"]')?.getAttribute('content') ||
      document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      '';
    if (!surface) {
      const sources = [pageTitle, docText, bodyTextEarly, metaDesc];
      for (const src of sources) {
        const m = src.match(/(\d{1,4})\s*m(?:²|2)\b/i);
        if (m) {
          surface = ex.normalizeSurface(m[1]);
          if (surface) break;
        }
      }
    }
    if (!postal) {
      const pathSlug = location.pathname.match(/\/annonce\/[^\/]+\/([^\/]+)/);
      if (pathSlug) {
        const city0 = pathSlug[1];
        const re = new RegExp(`${city0}-(\\d{5})`, 'i');
        const cityMatch = decodeURIComponent(location.search).match(re);
        if (cityMatch) postal = cityMatch[1];
      }
    }
    if (!postal) {
      const candidates = [
        pageTitle,
        document.title,
        document.querySelector('h1')?.textContent || '',
        document.querySelector('h2')?.textContent || '',
        docText,
        bodyTextEarly,
        metaDesc,
      ];
      for (const text of candidates) {
        const m = text.match(/\b(\d{5})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\-' ]{1,40})/);
        if (m) {
          postal = m[1];
          city = city || m[2].trim();
          break;
        }
      }
      if (!postal) {
        for (const text of [docText, bodyTextEarly, metaDesc]) {
          const bare = text.match(/\b(\d{5})\b/);
          if (bare) {
            postal = bare[1];
            break;
          }
        }
      }
    }

    let buildingType = null;
    if (/maison/i.test(pageTitle)) buildingType = 'maison';
    else if (/appart/i.test(pageTitle)) buildingType = 'appartement';

    const descText = descEl?.textContent || '';
    const bodyText = document.body.innerText || '';

    const isLand =
      /\bterrain\b/i.test(pageTitle) ||
      /\bterrain\b/i.test(document.title || '') ||
      /\/terrain[s]?\b|\/achat-terrain/i.test(location.pathname);

    if (isLand) {
      let landSurface = ex.normalizeLandSurface(surfaceEl?.textContent);
      if (!landSurface) {
        const sources = [pageTitle, document.title || '', metaDesc, descText, bodyText];
        for (const src of sources) {
          const m = src.match(/(\d{1,6})\s*m(?:²|2)\b/i);
          if (m) {
            landSurface = ex.normalizeLandSurface(m[1]);
            if (landSurface) break;
          }
        }
      }
      const section = ex.normalizeSection([descText, bodyText, pageTitle].join(' '));
      console.log('[immodex bienici] DOM extract (land):', { surface: landSurface, postal, city, section });
      if (!landSurface || !postal) return null;
      return {
        kind: 'land',
        postal,
        city,
        surface: landSurface,
        section,
        source: 'bienici-dom',
      };
    }

    const dateParsed =
      ex.extractDateFromText(descText) || ex.extractDateFromText(bodyText);
    const dateRange = ex.parseDateRange(dateParsed);
    const isNewBuild = /neuf|vefa/i.test(descText || bodyText || '');

    console.log('[immodex bienici] DOM extract:', { surface, postal, city, energy, ges, buildingType });
    console.log('[immodex bienici] url:', location.href);
    console.log(
      '[immodex bienici] all 5-digit numbers in body:',
      (document.body.innerText || '').match(/\b\d{5}\b/g)
    );
    console.log(
      '[immodex bienici] all 5-digit numbers in documentElement:',
      (document.documentElement.textContent || '').match(/\b\d{5}\b/g)
    );
    if (!surface || !postal) return null;
    return {
      kind: 'dpe',
      postal,
      city,
      surface,
      energyClass: energy,
      gesClass: ges,
      buildingType: null,
      dateRange,
      isNewBuild,
      source: 'bienici-dom',
    };
  }

  function locateAnchor() {
    const candidates = [
      '.energy-diagnostic',
      '.dpe-bar',
      '[class*="energyClassification"]',
      '[class*="diagnosticEnergy"]',
      '.fullAdSummary__diagnostics',
    ];
    for (const sel of candidates) {
      const node = document.querySelector(sel);
      if (node) {
        const parent = node.closest('section, div, li') || node.parentElement;
        if (parent) return parent;
      }
    }
    return null;
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

  function tryExtract() {
    const state = readInitialState();
    const ad = findAd(state);
    let payload = ad ? extractFromAd(ad) : null;
    if (!payload || (!payload.surface && !payload.energyClass)) {
      const fallback = extractFromDom();
      if (fallback) payload = { ...(payload || {}), ...fallback };
    }
    return payload;
  }

  async function onButtonClick() {
    try {
      console.log('[immodex bienici] click. url=', location.href);
      ui.showLoading({ postal: null, surface: null, energyClass: null, gesClass: null });
      let payload = tryExtract();
      let attempts = 1;
      while ((!payload || !payload.surface || !payload.postal) && attempts < 4) {
        await new Promise((r) => setTimeout(r, 350));
        const next = tryExtract();
        if (next) payload = { ...(payload || {}), ...next };
        attempts++;
      }
      console.log('[immodex bienici] payload after retries:', payload, 'attempts:', attempts);
      if (!payload || !payload.surface || !payload.postal) {
        ui.showError(
          "Impossible d'extraire les données DPE de cette page. Essayez de cliquer à nouveau ou utilisez l’extension (icône) pour saisir manuellement.",
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
      console.error('[immodex bienici] click error:', err);
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
    console.log('[immodex bienici] SPA nav — reset');
    STATE.injectedFor = null;
    ui.closeCard();
    ui.resetFloatingButton();
    setTimeout(init, 200);
  });
})();
