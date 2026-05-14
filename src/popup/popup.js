const ENERGY_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

const dpeForm = document.getElementById('dpe-form');
const landForm = document.getElementById('land-form');
const modeBtnDpe = document.getElementById('mode-dpe');
const modeBtnLand = document.getElementById('mode-land');
const statusBox = document.getElementById('status');
const resultsBox = document.getElementById('results');

let mode = 'dpe';

function normalizePostal(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D+/g, '');
  if (digits.length === 4) return '0' + digits;
  if (digits.length === 5) return digits;
  return null;
}

function normalizeSurface(value) {
  if (!value) return null;
  const num = parseInt(String(value).replace(/\D+/g, ''), 10);
  if (!isFinite(num) || num <= 0) return null;
  return num;
}

function normalizeClass(value) {
  if (!value) return null;
  const letter = String(value).trim().toUpperCase().charAt(0);
  return ENERGY_CLASSES.includes(letter) ? letter : null;
}

function normalizeSection(value) {
  if (!value) return null;
  const m = String(value).trim().toUpperCase().match(/^[A-Z]{1,2}$/);
  return m ? m[0] : null;
}

function pad2(n) {
  return n < 10 ? '0' + n : String(n);
}

function parseUserDate(input) {
  if (!input) return null;
  const t = String(input).trim();
  let m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return { year: +m[3], month: +m[2], day: +m[1] };
  m = t.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  m = t.match(/^(\d{1,2})[\/\-.](\d{4})$/);
  if (m) return { year: +m[2], month: +m[1], day: null };
  m = t.match(/^(\d{4})$/);
  if (m) return { year: +m[1], month: null, day: null };
  return null;
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
    return { gte: `${year}-${pad2(month)}-01`, lte: `${year}-${pad2(month)}-${pad2(last)}`, precision: 'month' };
  }
  if (year) return { gte: `${year}-01-01`, lte: `${year}-12-31`, precision: 'year' };
  return null;
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function setStatus(message, isError = false) {
  if (!message) {
    statusBox.classList.add('hidden');
    statusBox.textContent = '';
    return;
  }
  statusBox.classList.remove('hidden');
  statusBox.classList.toggle('error', isError);
  statusBox.textContent = message;
}

function setMode(next) {
  mode = next;
  modeBtnDpe.classList.toggle('active', mode === 'dpe');
  modeBtnLand.classList.toggle('active', mode === 'land');
  dpeForm.classList.toggle('hidden', mode !== 'dpe');
  landForm.classList.toggle('hidden', mode !== 'land');
  setStatus('');
  resultsBox.innerHTML = '';
}

function gmapsLink(address, postal, city) {
  const q = encodeURIComponent([address, postal, city].filter(Boolean).join(', '));
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function confidenceClass(score) {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

function landConfidenceClass(score) {
  if (score >= 70) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}

function renderDpeResult(result) {
  resultsBox.innerHTML = '';
  if (!result.candidates || result.candidates.length === 0) {
    resultsBox.appendChild(el('div', { class: 'empty' }, 'Aucune correspondance dans le registre ADEME.'));
    return;
  }
  const top = result.candidates[0];
  const conf = confidenceClass(top.score);
  const box = el('div', { class: `result-top ${conf}` });
  box.appendChild(el('div', { class: 'result-address' }, top.record.address || '(adresse inconnue)'));
  const metaParts = [top.record.postal, top.record.city, top.record.surface != null ? `${top.record.surface} m²` : null, top.record.date ? String(top.record.date).slice(0, 10) : null].filter(Boolean);
  box.appendChild(el('div', { class: 'result-meta' }, metaParts.join(' • ')));
  box.appendChild(el('div', { class: 'result-meta' }, `Score ${top.score}/100`));
  const links = el(
    'div',
    { class: 'result-links' },
    el(
      'a',
      { href: gmapsLink(top.record.address, top.record.postal, top.record.city), target: '_blank', rel: 'noopener noreferrer' },
      'Google Maps'
    )
  );
  if (top.record.id) {
    links.appendChild(
      el(
        'a',
        { href: `https://observatoire-dpe-audit.ademe.fr/afficher-dpe/${encodeURIComponent(top.record.id)}`, target: '_blank', rel: 'noopener noreferrer' },
        'Fiche ADEME'
      )
    );
  }
  box.appendChild(links);
  resultsBox.appendChild(box);

  const alts = result.candidates.slice(1);
  if (alts.length > 0) {
    const list = el('div', { class: 'result-alt' });
    list.appendChild(el('div', { class: 'result-meta' }, `${alts.length} autre(s) candidat(s)`));
    for (const alt of alts) {
      list.appendChild(
        el(
          'div',
          { class: 'alt-row' },
          el('div', null, alt.record.address || '(adresse inconnue)'),
          el(
            'div',
            { class: 'result-meta' },
            [
              alt.record.postal,
              alt.record.city,
              alt.record.surface != null ? `${alt.record.surface} m²` : null,
              alt.record.date ? String(alt.record.date).slice(0, 10) : null,
              `score ${alt.score}`,
            ]
              .filter(Boolean)
              .join(' • ')
          )
        )
      );
    }
    resultsBox.appendChild(list);
  }
}

function renderLandResult(result) {
  resultsBox.innerHTML = '';
  if (!result.candidates || result.candidates.length === 0) {
    resultsBox.appendChild(el('div', { class: 'empty' }, 'Aucune parcelle trouvée dans le cadastre IGN.'));
    return;
  }
  const top = result.candidates[0];
  const parcel = top.parcel;
  const conf = landConfidenceClass(top.score);
  const box = el('div', { class: `result-top ${conf}` });
  box.appendChild(el('div', { class: 'result-address' }, parcel.address || parcel.street || '(adresse approximative)'));
  const metaParts = [parcel.nom_com, parcel.codeInsee ? `INSEE ${parcel.codeInsee}` : null, parcel.contenance != null ? `${parcel.contenance} m²` : null].filter(Boolean);
  box.appendChild(el('div', { class: 'result-meta' }, metaParts.join(' • ')));
  const idParts = [parcel.idu, parcel.section ? `section ${parcel.section}` : null, parcel.numero ? `n°${parcel.numero}` : null].filter(Boolean);
  if (idParts.length) box.appendChild(el('div', { class: 'result-meta parcel-id' }, idParts.join(' — ')));
  box.appendChild(el('div', { class: 'result-meta' }, `Score ${top.score}/100`));
  if (Array.isArray(parcel.centroid)) {
    const [lon, lat] = parcel.centroid;
    box.appendChild(
      el(
        'div',
        { class: 'result-links' },
        el('a', { href: `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`, target: '_blank', rel: 'noopener noreferrer' }, 'Google Maps'),
        el(
          'a',
          {
            href: `https://www.geoportail.gouv.fr/carte?c=${lon.toFixed(6)},${lat.toFixed(6)}&z=19&l0=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'Géoportail'
        )
      )
    );
  }
  resultsBox.appendChild(box);

  const alts = result.candidates.slice(1);
  if (alts.length > 0) {
    const list = el('div', { class: 'result-alt' });
    list.appendChild(el('div', { class: 'result-meta' }, `${alts.length} autre(s) parcelle(s)`));
    for (const alt of alts) {
      const ap = alt.parcel;
      list.appendChild(
        el(
          'div',
          { class: 'alt-row' },
          el('div', null, ap.address || ap.street || ap.idu || '(parcelle)'),
          el(
            'div',
            { class: 'result-meta' },
            [
              ap.nom_com,
              ap.contenance != null ? `${ap.contenance} m²` : null,
              ap.section ? `section ${ap.section}` : null,
              ap.numero ? `n°${ap.numero}` : null,
              `score ${alt.score}`,
            ]
              .filter(Boolean)
              .join(' • ')
          )
        )
      );
    }
    resultsBox.appendChild(list);
  }
}

async function onDpeSubmit(ev) {
  ev.preventDefault();
  const data = new FormData(dpeForm);
  const payload = {
    kind: 'dpe',
    postal: normalizePostal(data.get('postal')),
    surface: normalizeSurface(data.get('surface')),
    energyClass: normalizeClass(data.get('energyClass')),
    gesClass: normalizeClass(data.get('gesClass')),
    buildingType: data.get('buildingType') || null,
    dateRange: parseDateRange(parseUserDate(data.get('date'))),
    isNewBuild: false,
  };
  if (!payload.postal) return setStatus('Code postal invalide.', true);
  if (!payload.surface) return setStatus('Surface invalide.', true);
  setStatus('Recherche…');
  resultsBox.innerHTML = '';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LOOKUP', payload });
    if (!response || response.ok !== true) return setStatus(response?.error || 'Erreur inconnue', true);
    setStatus(response.result.cached ? 'Cache' : `OK (dataset ${response.result.dataset}, tier ${response.result.tier})`);
    renderDpeResult(response.result);
  } catch (err) {
    setStatus(String(err.message || err), true);
  }
}

async function onLandSubmit(ev) {
  ev.preventDefault();
  const data = new FormData(landForm);
  const payload = {
    kind: 'land',
    postal: normalizePostal(data.get('postal')),
    surface: normalizeSurface(data.get('surface')),
    city: (data.get('city') || '').toString().trim() || null,
    section: normalizeSection(data.get('section')),
  };
  if (!payload.postal) return setStatus('Code postal invalide.', true);
  if (!payload.surface) return setStatus('Surface invalide.', true);
  setStatus('Recherche cadastrale…');
  resultsBox.innerHTML = '';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LOOKUP', payload });
    if (!response || response.ok !== true) return setStatus(response?.error || 'Erreur inconnue', true);
    setStatus(response.result.cached ? 'Cache' : `OK (tier ${response.result.tier}, ${response.result.total ?? 0} candidat(s))`);
    renderLandResult(response.result);
  } catch (err) {
    setStatus(String(err.message || err), true);
  }
}

dpeForm.addEventListener('submit', onDpeSubmit);
landForm.addEventListener('submit', onLandSubmit);
modeBtnDpe.addEventListener('click', () => setMode('dpe'));
modeBtnLand.addEventListener('click', () => setMode('land'));
