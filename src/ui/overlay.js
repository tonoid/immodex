(function () {
  'use strict';

  let currentCard = null;

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'style') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (v != null) {
        node.setAttribute(k, v);
      }
    }
    for (const child of children) {
      if (child == null) continue;
      if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function closeCard() {
    if (currentCard && currentCard.parentNode) {
      currentCard.parentNode.removeChild(currentCard);
    }
    currentCard = null;
  }

  function ensureCard() {
    if (currentCard) return currentCard;
    const card = el('div', { class: 'immodex-card' });
    document.body.appendChild(card);
    currentCard = card;
    return card;
  }

  const GITHUB_URL = 'https://github.com/tonoid/immodex';
  const TONOID_URL = 'https://www.tonoid.com/fr';

  function githubIconSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'currentColor');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
      'd',
      'M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z'
    );
    svg.appendChild(path);
    return svg;
  }

  function renderCredit() {
    const wrap = el('span', { class: 'immodex-credit' });
    const ghLink = el('a', {
      class: 'immodex-credit-gh',
      href: GITHUB_URL,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: 'Code source sur GitHub',
      'aria-label': 'GitHub',
    });
    ghLink.appendChild(githubIconSvg());
    const tonoidLink = el(
      'a',
      {
        class: 'immodex-credit-tonoid',
        href: TONOID_URL,
        target: '_blank',
        rel: 'noopener',
        title: 'tonoid.com',
      },
      'by tonoïd'
    );
    wrap.appendChild(ghLink);
    wrap.appendChild(tonoidLink);
    return wrap;
  }

  function renderHeader(card) {
    const header = el(
      'div',
      { class: 'immodex-header' },
      el('div', { class: 'immodex-title' }, 'Immodex'),
      el('button', { class: 'immodex-close', onclick: closeCard }, '×')
    );
    card.appendChild(header);
  }

  function renderFields(card, payload) {
    const fields = el('div', { class: 'immodex-fields' });
    const isLand = payload && payload.kind === 'land';
    const rows = isLand
      ? [
          ['Code postal', payload.postal],
          ['Ville', payload.city],
          ['Surface terrain', payload.surface ? `${payload.surface} m²` : null],
          ['Section', payload.section],
        ]
      : [
          ['Code postal', payload.postal],
          ['Ville', payload.city],
          ['Surface', payload.surface ? `${payload.surface} m²` : null],
          ['Classe énergie', payload.energyClass],
          ['Classe GES', payload.gesClass],
          ['Type', payload.buildingType],
          ['Date DPE', payload.dateRange ? `${payload.dateRange.gte} → ${payload.dateRange.lte}` : null],
        ];
    for (const [label, value] of rows) {
      if (!value) continue;
      fields.appendChild(
        el(
          'div',
          { class: 'immodex-fields-row' },
          el('span', { class: 'immodex-fields-label' }, label),
          el('span', null, String(value))
        )
      );
    }
    card.appendChild(fields);
  }

  function showLoading(payload) {
    const card = ensureCard();
    card.innerHTML = '';
    renderHeader(card);
    renderFields(card, payload);
    card.appendChild(el('div', { class: 'immodex-status' }, 'Recherche en cours…'));
    return card;
  }

  function showError(message, payload) {
    const card = ensureCard();
    card.innerHTML = '';
    renderHeader(card);
    if (payload) renderFields(card, payload);
    card.appendChild(el('div', { class: 'immodex-error' }, message));
  }

  function showDatePrompt(payload, onSubmit) {
    const card = ensureCard();
    card.innerHTML = '';
    renderHeader(card);
    renderFields(card, payload);

    const input = el('input', {
      type: 'text',
      placeholder: 'JJ/MM/AAAA, MM/AAAA ou AAAA (facultatif)',
      autocomplete: 'off',
    });
    const errBox = el('div', { class: 'immodex-error', style: { display: 'none' } });
    const submit = () => {
      const raw = input.value.trim();
      if (!raw) {
        errBox.style.display = 'none';
        onSubmit({ ...payload, dateRange: null });
        return;
      }
      const parsed = window.__immodexExtract.parseUserDate(raw);
      if (!parsed) {
        errBox.textContent = 'Format de date invalide. Laisser vide pour chercher sans date.';
        errBox.style.display = 'block';
        return;
      }
      errBox.style.display = 'none';
      const range = window.__immodexExtract.parseDateRange(parsed);
      onSubmit({ ...payload, dateRange: range });
    };
    const submitNoDate = () => {
      errBox.style.display = 'none';
      onSubmit({ ...payload, dateRange: null });
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submit();
      }
    });

    const prompt = el(
      'div',
      { class: 'immodex-date-prompt' },
      el('label', null, 'Date du DPE (facultatif — laisser vide pour chercher par surface + classes)'),
      input,
      errBox,
      el('button', { onclick: submit }, 'Rechercher'),
      el('a', { onclick: submitNoDate, class: 'immodex-skip-date' }, 'Chercher sans date')
    );
    card.appendChild(prompt);
    setTimeout(() => input.focus(), 30);
  }

  function confidenceClass(score) {
    if (score >= 80) return 'immodex-conf-green';
    if (score >= 50) return 'immodex-conf-yellow';
    return 'immodex-conf-red';
  }

  function gmapsLink(address, postal, city) {
    const q = encodeURIComponent([address, postal, city].filter(Boolean).join(', '));
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  function showResult(payload, result, onModify) {
    const card = ensureCard();
    card.innerHTML = '';
    renderHeader(card);
    renderFields(card, payload);

    if (!result || !result.candidates || result.candidates.length === 0) {
      card.appendChild(
        el(
          'div',
          { class: 'immodex-empty' },
          'Aucune correspondance trouvée dans le registre ADEME. Essayez d’ajuster les champs.'
        )
      );
      const footer = el('div', { class: 'immodex-footer' });
      if (onModify) footer.appendChild(el('a', { onclick: onModify }, 'Modifier les champs'));
      footer.appendChild(renderCredit());
      card.appendChild(footer);
      return;
    }

    const top = result.candidates[0];
    const conf = confidenceClass(top.score);
    const topBox = el('div', { class: `immodex-top ${conf}` });
    topBox.appendChild(el('div', { class: 'immodex-address' }, top.record.address || '(adresse inconnue)'));
    const metaParts = [];
    if (top.record.postal) metaParts.push(top.record.postal);
    if (top.record.city) metaParts.push(top.record.city);
    if (top.record.surface != null) metaParts.push(`${top.record.surface} m²`);
    if (top.record.date) metaParts.push(`DPE ${String(top.record.date).slice(0, 10)}`);
    topBox.appendChild(el('div', { class: 'immodex-meta' }, metaParts.join(' • ')));

    const confLabel =
      top.score >= 80 ? 'Confiance élevée' : top.score >= 50 ? 'Confiance moyenne' : 'Confiance faible';
    topBox.appendChild(
      el(
        'div',
        { class: 'immodex-confidence' },
        el('span', { class: 'immodex-dot' }),
        `${confLabel} (${top.score}/100)`
      )
    );

    const links = el(
      'div',
      { class: 'immodex-links' },
      el(
        'a',
        {
          href: gmapsLink(top.record.address, top.record.postal, top.record.city),
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'Voir sur Google Maps'
      )
    );
    if (top.record.id) {
      links.appendChild(
        el(
          'a',
          {
            href: `https://observatoire-dpe-audit.ademe.fr/afficher-dpe/${encodeURIComponent(top.record.id)}`,
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'Fiche ADEME'
        )
      );
    }
    topBox.appendChild(links);
    card.appendChild(topBox);

    const alts = result.candidates.slice(1);
    if (alts.length > 0) {
      const details = el(
        'details',
        { class: 'immodex-alts' },
        el('summary', null, `Autres candidats (${alts.length})`)
      );
      for (const alt of alts) {
        const row = el(
          'div',
          { class: 'immodex-alt-row' },
          el('div', { class: 'immodex-alt-address' }, alt.record.address || '(adresse inconnue)'),
          el(
            'div',
            { class: 'immodex-meta' },
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
        );
        if (alt.diffs && alt.diffs.length > 0) {
          row.appendChild(el('div', { class: 'immodex-alt-diffs' }, '≠ ' + alt.diffs.join(' ; ')));
        }
        const altLinks = el(
          'div',
          { class: 'immodex-links' },
          el(
            'a',
            {
              href: gmapsLink(alt.record.address, alt.record.postal, alt.record.city),
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            'Google Maps'
          )
        );
        row.appendChild(altLinks);
        details.appendChild(row);
      }
      card.appendChild(details);
    }

    const footerParts = [];
    if (result.cached) footerParts.push(el('span', null, 'cache'));
    footerParts.push(el('span', null, `dataset ${result.dataset}`));
    footerParts.push(el('span', null, `tier ${result.tier}`));
    if (onModify) footerParts.push(el('a', { onclick: onModify }, 'Modifier les champs'));
    footerParts.push(renderCredit());
    card.appendChild(el('div', { class: 'immodex-footer' }, ...footerParts));
  }

  function landConfidenceClass(score) {
    if (score >= 70) return 'immodex-conf-green';
    if (score >= 40) return 'immodex-conf-yellow';
    return 'immodex-conf-red';
  }

  function geoportailLink(lon, lat) {
    return `https://www.geoportail.gouv.fr/carte?c=${lon.toFixed(6)},${lat.toFixed(6)}&z=19&l0=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(1)&permalink=yes`;
  }

  function cadastreOrthoLink(lon, lat) {
    return `https://www.geoportail.gouv.fr/carte?c=${lon.toFixed(6)},${lat.toFixed(6)}&z=20&l0=ORTHOIMAGERY.ORTHOPHOTOS::GEOPORTAIL:OGC:WMTS(1)&l1=CADASTRALPARCELS.PARCELLAIRE_EXPRESS::GEOPORTAIL:OGC:WMTS(0.7)&permalink=yes`;
  }

  function gmapsCoordLink(lon, lat) {
    return `https://www.google.com/maps?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
  }

  function showLandResult(payload, result, onModify) {
    const card = ensureCard();
    card.innerHTML = '';
    renderHeader(card);
    renderFields(card, payload);

    if (!result || !result.candidates || result.candidates.length === 0) {
      card.appendChild(
        el(
          'div',
          { class: 'immodex-empty' },
          'Aucune parcelle trouvée dans le cadastre IGN pour ces critères.'
        )
      );
      const footer = el('div', { class: 'immodex-footer' });
      if (onModify) footer.appendChild(el('a', { onclick: onModify }, 'Modifier les champs'));
      footer.appendChild(renderCredit());
      card.appendChild(footer);
      return;
    }

    const top = result.candidates[0];
    const conf = landConfidenceClass(top.score);
    const parcel = top.parcel;
    const topBox = el('div', { class: `immodex-top ${conf}` });

    const addressLine = parcel.address || parcel.street || '(adresse approximative)';
    topBox.appendChild(el('div', { class: 'immodex-address' }, addressLine));

    const metaParts = [];
    if (parcel.nom_com) metaParts.push(parcel.nom_com);
    if (parcel.codeInsee) metaParts.push(`INSEE ${parcel.codeInsee}`);
    if (parcel.contenance != null) metaParts.push(`${parcel.contenance} m²`);
    topBox.appendChild(el('div', { class: 'immodex-meta' }, metaParts.join(' • ')));

    const idLine = el('div', { class: 'immodex-parcel-id' });
    const idParts = [];
    if (parcel.idu) idParts.push(parcel.idu);
    const sn = [];
    if (parcel.section) sn.push(`section ${parcel.section}`);
    if (parcel.numero) sn.push(`n°${parcel.numero}`);
    if (sn.length > 0) idParts.push(sn.join(' '));
    idLine.textContent = idParts.join(' — ');
    topBox.appendChild(idLine);

    const confLabel =
      top.score >= 70 ? 'Confiance élevée' : top.score >= 40 ? 'Confiance moyenne' : 'Confiance faible';
    topBox.appendChild(
      el(
        'div',
        { class: 'immodex-confidence' },
        el('span', { class: 'immodex-dot' }),
        `${confLabel} (${top.score}/100)`
      )
    );

    const links = el('div', { class: 'immodex-links' });
    if (Array.isArray(parcel.centroid)) {
      const [lon, lat] = parcel.centroid;
      links.appendChild(
        el(
          'a',
          { href: gmapsCoordLink(lon, lat), target: '_blank', rel: 'noopener noreferrer' },
          'Google Maps'
        )
      );
      links.appendChild(
        el(
          'a',
          { href: geoportailLink(lon, lat), target: '_blank', rel: 'noopener noreferrer' },
          'Géoportail'
        )
      );
    }
    if (Array.isArray(parcel.centroid)) {
      const [lon, lat] = parcel.centroid;
      links.appendChild(
        el(
          'a',
          {
            href: cadastreOrthoLink(lon, lat),
            target: '_blank',
            rel: 'noopener noreferrer',
            title: 'Orthophoto + cadastre superposé',
          },
          'Cadastre + photo'
        )
      );
    }
    topBox.appendChild(links);
    card.appendChild(topBox);

    const alts = result.candidates.slice(1);
    if (alts.length > 0) {
      const details = el(
        'details',
        { class: 'immodex-alts' },
        el('summary', null, `Autres parcelles (${alts.length})`)
      );
      for (const alt of alts) {
        const ap = alt.parcel;
        const altAddress = ap.address || ap.street || '(adresse approximative)';
        const row = el(
          'div',
          { class: 'immodex-alt-row' },
          el('div', { class: 'immodex-alt-address' }, altAddress),
          el(
            'div',
            { class: 'immodex-meta' },
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
        );
        if (ap.idu) row.appendChild(el('div', { class: 'immodex-parcel-id' }, ap.idu));
        if (alt.diffs && alt.diffs.length > 0) {
          row.appendChild(el('div', { class: 'immodex-alt-diffs' }, '≠ ' + alt.diffs.join(' ; ')));
        }
        if (Array.isArray(ap.centroid)) {
          const [lon, lat] = ap.centroid;
          const altLinks = el(
            'div',
            { class: 'immodex-links' },
            el('a', { href: gmapsCoordLink(lon, lat), target: '_blank', rel: 'noopener noreferrer' }, 'Maps'),
            el('a', { href: geoportailLink(lon, lat), target: '_blank', rel: 'noopener noreferrer' }, 'Géoportail')
          );
          row.appendChild(altLinks);
        }
        details.appendChild(row);
      }
      card.appendChild(details);
    }

    const footerParts = [];
    if (result.cached) footerParts.push(el('span', null, 'cache'));
    if (result.tier != null) footerParts.push(el('span', null, `tier ${result.tier}`));
    if (result.total != null) footerParts.push(el('span', null, `${result.total} candidat(s)`));
    if (onModify) footerParts.push(el('a', { onclick: onModify }, 'Modifier les champs'));
    footerParts.push(renderCredit());
    card.appendChild(el('div', { class: 'immodex-footer' }, ...footerParts));
  }

  function injectButton(anchor, label, onClick) {
    if (!anchor || anchor.querySelector('.immodex-btn')) return null;
    const btn = el('button', { class: 'immodex-btn', type: 'button' }, label);
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onClick(btn);
    });
    anchor.appendChild(btn);
    return btn;
  }

  let floatingBtnState = null;

  function buildFloatingBtn(label, onClick) {
    const btn = el(
      'button',
      {
        class: 'immodex-btn immodex-floating-btn',
        type: 'button',
        id: 'immodex-floating-btn',
        title: label,
        'aria-label': label,
      },
      label
    );
    btn.style.cssText = 'position:fixed!important;right:18px!important;bottom:18px!important;z-index:2147483646!important;visibility:visible!important;opacity:1!important;display:inline-flex!important;';
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onClick(btn);
    });
    return btn;
  }

  function mountFloatingButton(label, onClick) {
    if (floatingBtnState) {
      floatingBtnState.label = label;
      floatingBtnState.onClick = onClick;
    } else {
      floatingBtnState = { label, onClick, observer: null };
    }

    const ensureInDom = () => {
      if (!document.body) return null;
      const existing = document.getElementById('immodex-floating-btn');
      if (existing && existing.isConnected) return existing;
      const fresh = buildFloatingBtn(floatingBtnState.label, floatingBtnState.onClick);
      document.body.appendChild(fresh);
      return fresh;
    };

    const btn = ensureInDom();

    if (!floatingBtnState.observer && typeof MutationObserver !== 'undefined') {
      const obs = new MutationObserver(() => {
        const inDom = document.getElementById('immodex-floating-btn');
        if (!inDom || !inDom.isConnected) ensureInDom();
      });
      try {
        obs.observe(document.documentElement, { childList: true, subtree: true });
        floatingBtnState.observer = obs;
      } catch (e) {
        // ignore
      }
    }

    return btn;
  }

  function resetFloatingButton() {
    const existing = document.getElementById('immodex-floating-btn');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    if (floatingBtnState) {
      const fresh = buildFloatingBtn(floatingBtnState.label, floatingBtnState.onClick);
      (document.body || document.documentElement).appendChild(fresh);
      return fresh;
    }
    return null;
  }

  function onNavigate(cb) {
    let lastUrl = location.href;
    const fire = () => {
      if (location.href !== lastUrl) {
        const prev = lastUrl;
        lastUrl = location.href;
        try { cb(prev, lastUrl); } catch (e) { console.warn('[immodex] onNavigate cb error:', e); }
      }
    };
    window.addEventListener('popstate', fire);
    window.addEventListener('hashchange', fire);
    setInterval(fire, 250);
    return () => {
      window.removeEventListener('popstate', fire);
      window.removeEventListener('hashchange', fire);
    };
  }

  window.__immodexOverlay = {
    showLoading,
    showError,
    showDatePrompt,
    showResult,
    showLandResult,
    closeCard,
    injectButton,
    mountFloatingButton,
    resetFloatingButton,
    onNavigate,
  };
})();
