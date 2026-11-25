/* HaseDB – Reiter KARTE (ehemals mapApp): 3D-Karte München, Orte (privat/geteilt), A*-Wegfinder.
 * Wird erst beim ersten Öffnen des Reiters gestartet: Karte.start({ sb, user, name(uid), meldung }) */
window.Karte = (function () {
  'use strict';
  const CFG = window.HASE_CONFIG.karte;
  let X = null;            // Verbindung zur App: sb, user, name(uid), meldung
  let map = null;
  function start(ctx) {
  X = ctx;
  const W = window.Wegfinder;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ------------------------------------------------------------------ Speicher (Browser)
  const lokal = {
    get(k, d) { try { const v = localStorage.getItem('hasedb.karte.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hasedb.karte.' + k, JSON.stringify(v)); } catch (e) { /* voll oder gesperrt */ } },
    del(k) { try { localStorage.removeItem('hasedb.karte.' + k); } catch (e) { /* egal */ } },
  };
  // IndexedDB für die großen Straßendaten
  const idb = {
    _db: null,
    async db() {
      if (this._db) return this._db;
      this._db = await new Promise((res, rej) => {
        const r = indexedDB.open('mapapp', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('daten');
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return this._db;
    },
    async get(k) {
      try { const db = await this.db(); return await new Promise((res, rej) => { const q = db.transaction('daten').objectStore('daten').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
      catch (e) { return undefined; }
    },
    async set(k, v) {
      try { const db = await this.db(); await new Promise((res, rej) => { const t = db.transaction('daten', 'readwrite'); t.objectStore('daten').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
      catch (e) { /* ohne Cache weiter */ }
    },
  };

  // ------------------------------------------------------------------ Kategorien & Symbole
  const IK = {
    alle: '<path d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" fill="currentColor"/>',
    wichtig: '<path d="M12 2.5l2.9 6.2 6.6.7-5 4.5 1.4 6.6L12 17.2l-5.9 3.3 1.4-6.6-5-4.5 6.6-.7z" fill="currentColor"/>',
    essen: '<path d="M6 2v7a2 2 0 0 0 2 2v11M10 2v7a2 2 0 0 1-2 2M8 2v5M17 22V2c-2 1-3 4-3 8h3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    einkaufen: '<path d="M2 4h3l2.4 11h11l2-8H6.3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="19.5" r="1.6" fill="currentColor"/><circle cx="17" cy="19.5" r="1.6" fill="currentColor"/>',
    freizeit: '<path d="M12 3 22 20H2z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 10v5M12 17v1.2" stroke="currentColor" stroke-width="1.8"/>',
    arbeit: '<path d="M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 8h2M14 8h2M8 12h2M14 12h2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    sonstiges: '<path d="M12 3 21 12 12 21 3 12z" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  };
  const KAT = [
    { id: 'wichtig', name: 'Wichtig' }, { id: 'essen', name: 'Essen & Trinken' }, { id: 'einkaufen', name: 'Einkaufen' },
    { id: 'freizeit', name: 'Freizeit' }, { id: 'arbeit', name: 'Uni & Arbeit' },
    { id: 'sonstiges', name: 'Sonstiges' },
  ];
  const katName = (id) => (KAT.find((k) => k.id === id) || KAT[KAT.length - 1]).name;
  const ikon = (id, cls) => `<svg class="ikon ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${IK[id] || IK.sonstiges}</svg>`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ------------------------------------------------------------------ Zustand
  const S = {
    orte: lokal.get('orte-' + X.user.id, []),
    filter: lokal.get('filter', null) || Object.fromEntries(KAT.map((k) => [k.id, true])),
    gewaehlt: null, marker: new Map(),
    modus: 'fuss', daten: null, graphen: {}, klickZiel: null, punkte: { start: null, ziel: null },
    sb: null, user: null, neuPos: null, bearbeite: null, setzen: false,
  };

  const meldung = (t, ms) => X.meldung(t, ms);
  const eigen = (o) => !o.user_id || o.user_id === X.user.id;

  // ------------------------------------------------------------------ Karte & Stil
  map = new maplibregl.Map({
    container: 'karte-map', style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#050506' } }] },
    center: [CFG.start.lon, CFG.start.lat], zoom: CFG.start.zoom, pitch: CFG.start.pitch, bearing: CFG.start.bearing,
    maxPitch: 75, attributionControl: false, hash: false,
    maxBounds: [[CFG.muenchen.w, CFG.muenchen.s], [CFG.muenchen.o, CFG.muenchen.n]], minZoom: 10.5, renderWorldCopies: false,
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  const ROT = '#e8253b';
  function umfaerben(st) {
    const vec = Object.keys(st.sources).find((k) => st.sources[k].type === 'vector') || 'openmaptiles';
    st.light = { anchor: 'viewport', color: '#ffd6da', intensity: 0.32, position: [1.2, 210, 40] };
    const neu = [];
    let hat3d = false;
    for (const l of st.layers) {
      const id = l.id.toLowerCase(), sl = l['source-layer'] || '';
      l.paint = l.paint || {}; l.layout = l.layout || {};
      if (l.type === 'background') { l.paint['background-color'] = '#050506'; }
      else if (l.type === 'fill') {
        let c = '#08080a';
        if (sl === 'water') c = '#0c0d11';
        else if (sl === 'park' || sl === 'landcover') c = '#0a0b0b';
        else if (sl === 'building') { c = '#121214'; l.paint['fill-outline-color'] = '#1d1d21'; }
        else if (sl === 'aeroway') c = '#0d0d10';
        l.paint['fill-color'] = c; delete l.paint['fill-pattern'];
        if (sl !== 'water' && sl !== 'building') l.paint['fill-opacity'] = 0.9;
      } else if (l.type === 'line') {
        let c = '#2a2a30';
        if (sl === 'transportation') {
          if (/rail|transit|ferry|cable/.test(id)) { c = '#3a3a40'; }
          else if (/casing/.test(id)) { c = '#120406'; }
          else if (/motorway|trunk/.test(id)) c = '#ff3349';
          else if (/primary/.test(id)) c = '#e8253b';
          else if (/secondary|tertiary/.test(id)) c = '#a81b2c';
          else if (/path|pedestrian|footway|cycle|steps|track/.test(id)) c = '#3d1016';
          else c = '#5e121c';
        } else if (sl === 'waterway') c = '#121620';
        else if (sl === 'boundary') c = '#2c2c32';
        else if (sl === 'aeroway') c = '#1a1a1e';
        l.paint['line-color'] = c; delete l.paint['line-pattern'];
      } else if (l.type === 'fill-extrusion') {
        hat3d = true; extrusion(l);
      } else if (l.type === 'symbol') {
        if (sl === 'poi' || sl === 'aerodrome_label' || /poi|shield|oneway/.test(id)) { l.layout.visibility = 'none'; continue; }
        l.paint['text-color'] = sl === 'transportation_name' ? '#7d7b76' : sl === 'water_name' ? '#3c4455' : '#c9c7c1';
        l.paint['text-halo-color'] = '#050506'; l.paint['text-halo-width'] = 1.4;
        if (l.paint['icon-opacity'] === undefined) l.paint['icon-opacity'] = 0.6;
      } else if (l.type === 'hillshade' || l.type === 'raster') { l.layout.visibility = 'none'; }
    }
    // Leuchten der großen Straßen
    const strasse = st.layers.findIndex((l) => l['source-layer'] === 'transportation' && l.type === 'line');
    const glow = {
      id: 'mapapp-glow', type: 'line', source: vec, 'source-layer': 'transportation', minzoom: 10,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false],
      paint: { 'line-color': ROT, 'line-blur': 6, 'line-opacity': 0.35, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 14] },
    };
    if (strasse >= 0) st.layers.splice(strasse, 0, glow); else neu.push(glow);
    if (!hat3d) {
      const l = { id: 'mapapp-3d', type: 'fill-extrusion', source: vec, 'source-layer': 'building', minzoom: 13, paint: {} };
      extrusion(l);
      const lbl = st.layers.findIndex((x) => x.type === 'symbol');
      if (lbl >= 0) st.layers.splice(lbl, 0, l); else neu.push(l);
    }
    st.layers.push(...neu);
    return st;
  }
  function extrusion(l) {
    l.paint = {
      'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 8], 0, '#141417', 25, '#1e1e23', 60, '#2c2b31'],
      'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.92,
      'fill-extrusion-vertical-gradient': true,
    };
    l.layout = { visibility: lokal.get('3d', true) ? 'visible' : 'none' };
  }
  async function stilLaden() {
    try {
      const r = await fetch(CFG.kartenstil); if (!r.ok) throw new Error(r.status);
      map.setStyle(umfaerben(await r.json()), { diff: false });   // ohne diff: sonst bleiben eigene Ebenen (Route, Gebiet) weg
    } catch (e) {
      meldung('Kartenstil konnte nicht geladen werden – Internet?', 5000);
    }
  }
  stilLaden();

  // Eigene Ebenen nach jedem Stilwechsel
  map.on('style.load', () => {
    const g = CFG.gebiet;
    const ring = [[g.w, g.s], [g.o, g.s], [g.o, g.n], [g.w, g.n], [g.w, g.s]];
    map.addSource('gebiet', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ring] } } });
    map.addLayer({ id: 'gebiet-maske', type: 'fill', source: 'gebiet', paint: { 'fill-color': '#000', 'fill-opacity': 0.45 } });
    map.addLayer({ id: 'gebiet-rand', type: 'line', source: 'gebiet', paint: { 'line-color': ROT, 'line-width': 1.2, 'line-opacity': 0.55, 'line-dasharray': [4, 3] } });
    map.addSource('route', { type: 'geojson', data: leer() });
    map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ROT, 'line-width': 16, 'line-blur': 10, 'line-opacity': 0.55 } });
    map.addLayer({ id: 'route-kern', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff5a6a', 'line-width': 4 } });
    map.addLayer({ id: 'route-mitte', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffe3e6', 'line-width': 1.2 } });
    if (S.letzteRoute) zeigeRoute(S.letzteRoute);
  });
  const leer = () => ({ type: 'FeatureCollection', features: [] });

  // Ort-Symbole beim Herauszoomen verkleinern (Zoom 16+ = volle Größe, ab 12 = 40 %)
  function mkGroesse() {
    const s = Math.max(0.4, Math.min(1, 0.4 + (map.getZoom() - 12) * 0.15));
    $('#karte-map').style.setProperty('--mk', s.toFixed(2));
  }
  map.on('zoom', mkGroesse); mkGroesse();

  // Kompass
  const nadel = $('#kompass-nadel');
  map.on('rotate', () => { nadel.style.transform = `rotate(${-map.getBearing()}deg)`; });
  nadel.style.transform = `rotate(${-map.getBearing()}deg)`;
  $('#kompass').addEventListener('click', () => map.easeTo({ bearing: 0, duration: 600 }));

  // ------------------------------------------------------------------ Reiter
  function zeigeReiter(r) {
    if (r !== 'karte' && window.innerWidth <= 820 && S.gewaehlt) schliesseOrt();
    $$('.unterreiter button').forEach((b) => b.classList.toggle('aktiv', b.dataset.reiter === r));
    $$('#feld-links section').forEach((s) => { s.hidden = s.dataset.feld !== r; });
    $('#feld-links').classList.remove('zu');
    if (r === 'route') { fuellePunktWahl(); datenLaden(false).catch(() => {}); }
    if (r === 'orte') zeichneListe();
  }
  $$('.unterreiter button').forEach((b) => b.addEventListener('click', () => zeigeReiter(b.dataset.reiter)));
  $('#filter-zu').addEventListener('click', () => $('#feld-links').classList.toggle('zu'));

  // ------------------------------------------------------------------ Filter
  function zeichneFilter() {
    const alleAn = KAT.every((k) => S.filter[k.id]);
    $('#filter').innerHTML = `<li data-k="alle" class="${alleAn ? 'aktiv' : ''}">${ikon('alle')}<span>Alle</span></li>` +
      KAT.map((k) => `<li data-k="${k.id}" class="${S.filter[k.id] ? (alleAn ? '' : 'aktiv') : 'aus'}">${ikon(k.id)}<span>${k.name}</span></li>`).join('');
  }
  $('#filter').addEventListener('click', (e) => {
    const li = e.target.closest('li'); if (!li) return;
    const k = li.dataset.k;
    if (k === 'alle') KAT.forEach((x) => { S.filter[x.id] = true; });
    else {
      const alleAn = KAT.every((x) => S.filter[x.id]);
      if (alleAn) KAT.forEach((x) => { S.filter[x.id] = x.id === k; });   // erster Klick: nur diese Kategorie
      else S.filter[k] = !S.filter[k];
      if (!KAT.some((x) => S.filter[x.id])) KAT.forEach((x) => { S.filter[x.id] = true; });
    }
    lokal.set('filter', S.filter);
    zeichneFilter(); zeichneMarker();
  });

  // ------------------------------------------------------------------ Markierungen
  function zeichneMarker() {
    const da = new Set();
    for (const o of S.orte) {
      da.add(o.id);
      let m = S.marker.get(o.id);
      if (!m) {
        const el = document.createElement('div');
        el.className = 'mk';
        el.addEventListener('click', (ev) => { ev.stopPropagation(); waehle(el.dataset.id); });
        m = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([o.lon, o.lat]).addTo(map);
        S.marker.set(o.id, m);
      }
      const el = m.getElement();
      el.dataset.id = o.id;
      m.setLngLat([o.lon, o.lat]);
      const gew = S.gewaehlt === o.id;
      el.className = 'mk' + (o.kategorie === 'wichtig' ? ' wichtig' : '') + (gew ? ' gewaehlt' : '') + (o.geteilt ? ' geteilt' : '');
      el.innerHTML = `<div class="mk-in"><div class="raute"></div>${ikon(o.kategorie)}</div>` + (gew ? `<div class="mk-schild">${esc(o.name)}<small>${esc(katName(o.kategorie))}</small></div>` : '');
      el.style.display = S.filter[o.kategorie] !== false ? '' : 'none';
      el.title = o.name;
    }
    for (const [id, m] of S.marker) if (!da.has(id)) { m.remove(); S.marker.delete(id); }
  }
  function waehle(id) {
    S.gewaehlt = id;
    const o = S.orte.find((x) => x.id === id);
    if (!o) { $('#feld-ort').hidden = true; S.gewaehlt = null; zeichneMarker(); return; }
    $('#ort-name').textContent = o.name;
    $('#ort-art').innerHTML = ikon(o.kategorie) + `<span>${esc(katName(o.kategorie))}</span>`;
    $('#ort-notiz').textContent = o.notiz || '';
    $('#ort-wer').textContent = eigen(o) ? (o.geteilt ? 'GETEILT' : 'PRIVAT') : 'GETEILT VON ' + X.name(o.user_id).toUpperCase();
    $('#ort-bearbeiten').hidden = !eigen(o); $('#ort-loeschen').hidden = !eigen(o);
    $('#feld-ort').hidden = false; document.body.classList.add('ort-offen');
    zeichneMarker();
  }
  function schliesseOrt() { S.gewaehlt = null; $('#feld-ort').hidden = true; document.body.classList.remove('ort-offen'); zeichneMarker(); }
  $('#ort-zu').addEventListener('click', schliesseOrt);
  $('#ort-route').addEventListener('click', () => {
    const id = S.gewaehlt; zeigeReiter('route');
    $('#route-ziel').value = 'ort:' + id;
    if ($('#route-start').value === 'ort:' + id) $('#route-start').value = 'pos';
    berechne();
  });
  $('#ort-bearbeiten').addEventListener('click', () => { const o = S.orte.find((x) => x.id === S.gewaehlt); if (o && eigen(o)) oeffneFenster(o); });
  $('#ort-loeschen').addEventListener('click', async () => {
    const o = S.orte.find((x) => x.id === S.gewaehlt); if (!o || !eigen(o)) return;
    if (!confirm(`„${o.name}“ löschen?`)) return;
    await loescheOrt(o); schliesseOrt();
  });

  // Liste
  function zeichneListe() {
    const q = ($('#orte-suche').value || '').toLowerCase().trim();
    const l = S.orte.filter((o) => !q || o.name.toLowerCase().includes(q) || (o.notiz || '').toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'));
    $('#orte-liste').innerHTML = l.length ? l.map((o) => `<li data-id="${esc(o.id)}">${ikon(o.kategorie)}<div><div class="titel">${esc(o.name)}</div><div class="unter">${esc(katName(o.kategorie)).toUpperCase()}${eigen(o) ? (o.geteilt ? ' · GETEILT' : '') : ' · VON ' + esc(X.name(o.user_id)).toUpperCase()}</div></div></li>`).join('')
      : `<li class="leer">${S.orte.length ? 'Nichts gefunden.' : 'Noch keine Orte. Rechtsklick (iPhone: lange drücken) auf die Karte markiert einen Ort.'}</li>`;
  }
  $('#orte-suche').addEventListener('input', zeichneListe);
  $('#orte-liste').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]'); if (!li) return;
    const o = S.orte.find((x) => x.id === li.dataset.id); if (!o) return;
    map.flyTo({ center: [o.lon, o.lat], zoom: Math.max(map.getZoom(), 16), duration: 900 });
    waehle(o.id);
  });

  // ------------------------------------------------------------------ Ort anlegen / bearbeiten
  let fKat = 'sonstiges';
  function oeffneFenster(o, pos) {
    S.bearbeite = o || null; S.neuPos = pos || (o ? { lat: o.lat, lon: o.lon } : null);
    $('#fenster-titel').textContent = o ? 'ORT BEARBEITEN' : 'ORT MARKIEREN';
    $('#f-name').value = o ? o.name : '';
    $('#f-notiz').value = o ? o.notiz || '' : '';
    $('#f-geteilt').checked = o ? !!o.geteilt : false;
    fKat = o ? o.kategorie : 'sonstiges';
    $('#f-kategorie').innerHTML = KAT.map((k) => `<button type="button" data-k="${k.id}" class="${k.id === fKat ? 'aktiv' : ''}">${ikon(k.id)}${k.name}</button>`).join('');
    $('#fenster-ort').hidden = false;
    setTimeout(() => $('#f-name').focus(), 30);
  }
  $('#f-kategorie').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    fKat = b.dataset.k; $$('#f-kategorie button').forEach((x) => x.classList.toggle('aktiv', x === b));
  });
  $('#f-abbrechen').addEventListener('click', () => { $('#fenster-ort').hidden = true; });
  $('#form-ort').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#f-name').value.trim(); if (!name) return;
    const daten = { name, kategorie: fKat, notiz: $('#f-notiz').value.trim(), lat: S.neuPos.lat, lon: S.neuPos.lon, geteilt: $('#f-geteilt').checked };
    $('#fenster-ort').hidden = true;
    const o = S.bearbeite ? await aendereOrt(S.bearbeite, daten) : await neuerOrt(daten);
    if (o) waehle(o.id);
  });
  function setzenModus(an) {
    S.setzen = an; document.body.classList.toggle('setzen', an);
    $('#knopf-neu').textContent = an ? 'AUF DIE KARTE KLICKEN …' : '+ ORT MARKIEREN';
  }
  $('#knopf-neu').addEventListener('click', () => setzenModus(!S.setzen));

  map.on('contextmenu', (e) => { e.preventDefault(); oeffneFenster(null, { lat: e.lngLat.lat, lon: e.lngLat.lng }); });
  // Langes Drücken (iPhone)
  let druckT = 0, druckStart = null;
  map.on('touchstart', (e) => {
    if (e.originalEvent.touches.length !== 1) { clearTimeout(druckT); return; }
    druckStart = e.point; const ll = e.lngLat;
    druckT = setTimeout(() => { oeffneFenster(null, { lat: ll.lat, lon: ll.lng }); }, 600);
  });
  map.on('touchmove', (e) => { if (druckStart && (Math.abs(e.point.x - druckStart.x) > 8 || Math.abs(e.point.y - druckStart.y) > 8)) clearTimeout(druckT); });
  map.on('touchend', () => clearTimeout(druckT));
  map.on('movestart', () => clearTimeout(druckT));

  map.on('click', (e) => {
    const pos = { lat: e.lngLat.lat, lon: e.lngLat.lng };
    if (S.klickZiel) { setzePunkt(S.klickZiel, pos); return; }
    if (S.setzen) { setzenModus(false); oeffneFenster(null, pos); return; }
    if (S.gewaehlt) schliesseOrt();
  });

  // ------------------------------------------------------------------ Orte speichern (Supabase, Tabelle orte)
  function sichern() { lokal.set('orte-' + X.user.id, S.orte); zeichneFilter(); zeichneMarker(); if (!$('[data-feld="orte"]').hidden) zeichneListe(); }
  const zeile = (o) => ({ name: o.name, kategorie: o.kategorie, notiz: o.notiz || '', lat: o.lat, lon: o.lon, geteilt: !!o.geteilt });
  async function neuerOrt(d) {
    const { data, error } = await X.sb.from('orte').insert(zeile(d)).select().single();
    if (error) { meldung('Nicht gespeichert: ' + error.message, 4000); return null; }
    S.orte.push(data); sichern(); meldung('„' + data.name + '“ markiert');
    return data;
  }
  async function aendereOrt(alt, d) {
    const geaendert = new Date().toISOString();
    const { error } = await X.sb.from('orte').update({ ...zeile(d), geaendert }).eq('id', alt.id);
    if (error) { meldung('Nicht gespeichert: ' + error.message, 4000); return null; }
    Object.assign(alt, d, { geaendert }); sichern(); return alt;
  }
  async function loescheOrt(o) {
    const { error } = await X.sb.from('orte').delete().eq('id', o.id);
    if (error) { meldung('Löschen fehlgeschlagen: ' + error.message, 4000); return; }
    S.orte = S.orte.filter((x) => x.id !== o.id); sichern();
  }
  async function orteLaden() {
    const { data, error } = await X.sb.from('orte').select('*').order('erstellt');
    if (error) { meldung('Orte konnten nicht geladen werden: ' + error.message, 4000); return; }
    S.orte = data; sichern(); if (S.gewaehlt) waehle(S.gewaehlt);
  }

  // ------------------------------------------------------------------ Straßendaten & Wegfinder
  const DATEN_KEY = 'strassen-v1-' + Object.values(CFG.gebiet).join('_');
  let ladeLaeuft = null;
  function datenInfo(t, fehler) {
    for (const id of ['#route-daten', '#daten-info']) { const el = $(id); el.textContent = t; el.classList.toggle('fehler', !!fehler); }
  }
  function datenLaden(neu) {
    if (S.daten && !neu) return Promise.resolve(S.daten);
    if (ladeLaeuft) return ladeLaeuft;
    ladeLaeuft = (async () => {
      if (!neu) {
        const c = await idb.get(DATEN_KEY);
        if (c && c.daten) { S.daten = c.daten; S.graphen = {}; datenInfo(infoText(c)); return S.daten; }
      }
      const g = CFG.gebiet;
      const q = `[out:json][timeout:180];way["highway"]["area"!="yes"](${g.s},${g.w},${g.n},${g.o});(._;>;);out body qt;`;
      let letzterFehler = null;
      // 1) fertige Datei im Projekt (daten/overpass.json), 2) Overpass-Server nacheinander
      const quellen = [{ url: 'daten/overpass.json' }, ...CFG.overpass.map((url) => ({ url, post: true }))];
      for (const qu of quellen) {
        try {
          if (qu.post) datenInfo('Lade Straßendaten von OpenStreetMap … (einmalig, bis zu 1–2 Minuten)');
          const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), qu.post ? 200000 : 30000);
          const r = await fetch(qu.url, qu.post ? { method: 'POST', signal: ctl.signal, body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } : { signal: ctl.signal });
          clearTimeout(t);
          if (!r.ok) throw new Error(qu.post ? 'Server ausgelastet (' + r.status + ')' : 'keine Datei');
          const json = await r.json();
          datenInfo('Baue Graph …');
          const daten = W.kompakt(json);
          const eintrag = { zeit: Date.now(), daten };
          await idb.set(DATEN_KEY, eintrag);
          S.daten = daten; S.graphen = {};
          datenInfo(infoText(eintrag));
          return daten;
        } catch (e) { letzterFehler = e; }
      }
      datenInfo('Straßendaten gerade nicht erreichbar (' + (letzterFehler && letzterFehler.message) + '). In ein paar Minuten erneut versuchen.', true);
      throw letzterFehler;
    })().finally(() => { ladeLaeuft = null; });
    return ladeLaeuft;
  }
  const infoText = () => '';
  $('#knopf-daten').addEventListener('click', () => datenLaden(true).catch(() => {}));
  function graph(modus) {
    if (!S.graphen[modus]) S.graphen[modus] = W.baueGraph(S.daten, modus);
    return S.graphen[modus];
  }

  $$('#modi button').forEach((b) => b.addEventListener('click', () => {
    S.modus = b.dataset.modus; $$('#modi button').forEach((x) => x.classList.toggle('aktiv', x === b));
    if (!$('#route-ergebnis').hidden) berechne();
  }));
  function fuellePunktWahl() {
    for (const w of ['start', 'ziel']) {
      const sel = $('#route-' + w), alt = sel.value;
      const orte = S.orte.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
      sel.innerHTML = `<option value="pos">◎ Mein Standort</option>` +
        `<option value="karte">⌖ ${S.punkte[w] ? 'Punkt auf der Karte' : 'Auf der Karte wählen …'}</option>` +
        orte.map((o) => `<option value="ort:${esc(o.id)}">${esc(o.name)}</option>`).join('');
      if (alt && Array.from(sel.options).some((x) => x.value === alt)) sel.value = alt;
      else if (w === 'ziel' && orte.length) sel.value = 'ort:' + orte[0].id;
    }
  }
  $$('[data-klick]').forEach((b) => b.addEventListener('click', () => {
    const w = b.dataset.klick;
    S.klickZiel = S.klickZiel === w ? null : w;
    $$('[data-klick]').forEach((x) => x.classList.toggle('wartet', x.dataset.klick === S.klickZiel));
    document.body.classList.toggle('setzen', !!S.klickZiel);
    if (S.klickZiel) meldung((w === 'start' ? 'Start' : 'Ziel') + ': auf die Karte klicken');
  }));
  $('#route-start').addEventListener('change', (e) => { if (e.target.value === 'karte' && !S.punkte.start) $('[data-klick="start"]').click(); });
  $('#route-ziel').addEventListener('change', (e) => { if (e.target.value === 'karte' && !S.punkte.ziel) $('[data-klick="ziel"]').click(); });
  const punktMarker = {};
  function setzePunkt(w, pos, still) {
    S.punkte[w] = pos; S.klickZiel = null;
    $$('[data-klick]').forEach((x) => x.classList.remove('wartet')); document.body.classList.remove('setzen');
    fuellePunktWahl(); $('#route-' + w).value = 'karte';
    if (punktMarker[w]) punktMarker[w].remove();
    const el = document.createElement('div'); el.className = 'punkt-mk ' + w;
    punktMarker[w] = new maplibregl.Marker({ element: el }).setLngLat([pos.lon, pos.lat]).addTo(map);
    if (!still && S.punkte.start && S.punkte.ziel) berechne();
  }
  function standort() {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) { rej(new Error('Kein GPS')); return; }
      navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), (e) => rej(e), { enableHighAccuracy: true, timeout: 10000 });
    });
  }
  async function punkt(w) {
    const v = $('#route-' + w).value;
    if (v === 'pos') return standort();
    if (v === 'karte') { if (!S.punkte[w]) throw new Error('Bitte ' + (w === 'start' ? 'Start' : 'Ziel') + ' auf der Karte wählen'); return S.punkte[w]; }
    const o = S.orte.find((x) => 'ort:' + x.id === v); if (!o) throw new Error('Ort nicht gefunden');
    return { lat: o.lat, lon: o.lon };
  }
  const fmtKm = (m) => m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2).replace('.', ',') + '<small>km</small>' : Math.round(m) + '<small>m</small>';
  const fmtMin = (s) => s < 3600 ? Math.max(1, Math.round(s / 60)) + ' min' : Math.floor(s / 3600) + ' h ' + Math.round((s % 3600) / 60) + ' min';
  function imGebiet(p) { const g = CFG.gebiet; return p.lat >= g.s && p.lat <= g.n && p.lon >= g.w && p.lon <= g.o; }

  $('#knopf-route').addEventListener('click', () => berechne());

  async function berechne() {
    const knopf = $('#knopf-route'); knopf.disabled = true; knopf.textContent = 'BERECHNE …';
    try {
      await datenLaden(false);
      const [a, b] = await Promise.all([punkt('start'), punkt('ziel')]);
      if (!imGebiet(a) || !imGebiet(b)) throw new Error((imGebiet(a) ? 'Ziel' : 'Start') + ' liegt außerhalb des Routing-Gebiets (rot gestrichelt)');
      const g = graph(S.modus);
      const na = W.naechster(g, a.lat, a.lon), nb = W.naechster(g, b.lat, b.lon);
      if (!na || !nb) throw new Error('Kein passender Weg in der Nähe');
      const r = W.aStern(g, na.i, nb.i);
      if (!r) throw new Error('Kein Weg gefunden – mit diesem Verkehrsmittel nicht erreichbar');
      S.letzteRoute = { r, a, b, na, nb, g };
      zeigeRoute(S.letzteRoute);
      navStart(fmtKm(gesamtVorab(r, na, nb)).replace(/<[^>]+>/g, ' '), fmtMin(W.dauer(r, S.modus) + (na.meter + nb.meter) / (5 / 3.6)));
      const gesamtM = r.meter + na.meter + nb.meter;
      const sek = W.dauer(r, S.modus) + (na.meter + nb.meter) / (5 / 3.6);
      const e = $('#route-ergebnis'); e.hidden = false;
      e.innerHTML = `<div class="gross">${fmtKm(gesamtM)} <small>· ${fmtMin(sek)}</small></div>` +
        `<ol>${r.strassen.filter((s) => s.meter >= 15).map((s) => `<li>${esc(s.name)}<span>${Math.round(s.meter)} m</span></li>`).join('')}</ol>`;
    } catch (err) {
      const e = $('#route-ergebnis'); e.hidden = false; e.innerHTML = `<div class="hinweis fehler" style="margin:0">${esc(err.message || 'Standort nicht verfügbar')}</div>`;
    } finally { knopf.disabled = false; knopf.textContent = 'ROUTE BERECHNEN'; }
  }
  const gesamtVorab = (r, na, nb) => r.meter + na.meter + nb.meter;
  function zeigeRoute(R) {
    if (!map.getSource('route')) return;
    const { r, a, b, g } = R, d = g.d;
    const koord = r.pfad.map((i) => [d.lon[i], d.lat[i]]);
    S.routeKoord = [[a.lon, a.lat], ...koord, [b.lon, b.lat]];
    const feats = [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: koord } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], koord[0]] } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [koord[koord.length - 1], [b.lon, b.lat]] } },
    ];
    map.getSource('route').setData({ type: 'FeatureCollection', features: feats });
    for (const [w, p] of [['start', a], ['ziel', b]]) {
      if (punktMarker[w]) punktMarker[w].remove();
      const el = document.createElement('div'); el.className = 'punkt-mk ' + w;
      punktMarker[w] = new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
    }
    const bb = koord.reduce((m, c) => [[Math.min(m[0][0], c[0]), Math.min(m[0][1], c[1])], [Math.max(m[1][0], c[0]), Math.max(m[1][1], c[1])]], [[a.lon, a.lat], [a.lon, a.lat]]);
    const schmal = window.innerWidth <= 820;
    map.fitBounds(bb, { padding: schmal ? { top: 90, bottom: window.innerHeight * 0.5, left: 30, right: 30 } : { top: 110, bottom: 90, left: 360, right: 80 }, maxZoom: 17, duration: 900, pitch: map.getPitch(), bearing: map.getBearing() });
  }

  // ------------------------------------------------------------------ Route verfolgen (eigener Standort nur während einer Route)
  let navWatch = null, ichMarker = null, folgen = false;
  function navStart(gesamt, dauer) {
    $('#nav-text').textContent = `${gesamt.trim()} · ${dauer}`;
    $('#nav-rest').textContent = 'ROUTE';
    $('#nav-leiste').hidden = false;
    if (window.innerWidth <= 820) $('#feld-links').classList.add('zu');
    if (navWatch === null && navigator.geolocation) {
      navWatch = navigator.geolocation.watchPosition(position, () => { $('#nav-rest').textContent = 'STANDORT AUS'; }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    }
  }
  function position(p) {
    const ll = [p.coords.longitude, p.coords.latitude];
    if (!ichMarker) { const el = document.createElement('div'); el.className = 'ich-mk'; ichMarker = new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map); }
    else ichMarker.setLngLat(ll);
    if (folgen) map.easeTo({ center: ll, duration: 800 });
    // Restweg: nächster Punkt auf der Route, ab dort bis zum Ziel
    const k = S.routeKoord; if (!k || !k.length) return;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < k.length; i++) { const dd = W.distanz(ll[1], ll[0], k[i][1], k[i][0]); if (dd < bd) { bd = dd; bi = i; } }
    let rest = bd;
    for (let i = bi; i + 1 < k.length; i++) rest += W.distanz(k[i][1], k[i][0], k[i + 1][1], k[i + 1][0]);
    $('#nav-rest').textContent = rest < 25 ? 'ZIEL ERREICHT' : 'NOCH ' + fmtKm(rest).replace(/<[^>]+>/g, ' ').trim().toUpperCase();
  }
  function navEnde() {
    if (navWatch !== null) { navigator.geolocation.clearWatch(navWatch); navWatch = null; }
    if (ichMarker) { ichMarker.remove(); ichMarker = null; }
    folgen = false; $('#nav-folgen').classList.remove('aktiv');
    $('#nav-leiste').hidden = true; $('#route-ergebnis').hidden = true;
    S.letzteRoute = null; S.routeKoord = null;
    if (map.getSource('route')) map.getSource('route').setData(leer());
    for (const w of ['start', 'ziel']) if (punktMarker[w]) { punktMarker[w].remove(); punktMarker[w] = null; }
    S.punkte = { start: null, ziel: null };
  }
  $('#nav-ende').addEventListener('click', navEnde);
  $('#nav-folgen').addEventListener('click', () => {
    folgen = !folgen; $('#nav-folgen').classList.toggle('aktiv', folgen);
    if (folgen && ichMarker) map.easeTo({ center: ichMarker.getLngLat(), zoom: Math.max(map.getZoom(), 16.5), duration: 800 });
    if (folgen && !ichMarker) meldung('Warte auf deinen Standort …');
  });
  map.on('dragstart', () => { if (folgen) { folgen = false; $('#nav-folgen').classList.remove('aktiv'); } });

  // ------------------------------------------------------------------ Einstellungen: Ansicht
  $('#opt-3d').checked = lokal.get('3d', true);
  $('#opt-3d').addEventListener('change', (e) => {
    lokal.set('3d', e.target.checked);
    for (const l of map.getStyle().layers) if (l.type === 'fill-extrusion') map.setLayoutProperty(l.id, 'visibility', e.target.checked ? 'visible' : 'none');
    map.easeTo({ pitch: e.target.checked ? CFG.start.pitch : 0, duration: 600 });
  });


  // ------------------------------------------------------------------ Tasten
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || $('#ansicht-karte').hidden) return;
    if (!$('#fenster-ort').hidden) { $('#fenster-ort').hidden = true; return; }
    if (S.klickZiel || S.setzen) { S.klickZiel = null; setzenModus(false); $$('[data-klick]').forEach((x) => x.classList.remove('wartet')); document.body.classList.remove('setzen'); return; }
    if (S.gewaehlt) schliesseOrt();
  });

  // ------------------------------------------------------------------ Start
  zeichneFilter(); zeichneMarker();
  orteLaden();
  window.__karte = { S, map, berechne, datenLaden, W };
  }

  return {
    start,
    gestartet: () => !!map,
    zeigen() { if (map) setTimeout(() => map.resize(), 30); },
    neuLaden() { if (window.__karte) window.__karte.datenLaden(true).catch(() => {}); },
  };
})();
