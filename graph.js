/*
 * mapApp – Wegfinder
 * Aus OpenStreetMap-Daten (Overpass-JSON) wird je Verkehrsmittel ein Graph gebaut,
 * darauf sucht A* den besten Weg. Läuft im Browser und in Node (für Tests).
 *
 *   const daten = Wegfinder.kompakt(overpassJson);       // klein, speicherbar
 *   const g = Wegfinder.baueGraph(daten, 'fuss');         // 'fuss' | 'rad' | 'auto'
 *   const r = Wegfinder.aStern(g, start, ziel);            // Knoten-Indizes
 */
(function (global) {
  'use strict';

  const ERDRADIUS = 6371000; // Meter

  /** Entfernung zweier Punkte auf der Erdkugel in Metern (Haversine-Formel). */
  function distanz(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * ERDRADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  // Tags, die wir für das Routing brauchen (alles andere wird weggeworfen)
  const TAGS = ['highway', 'name', 'ref', 'oneway', 'junction', 'access', 'foot', 'bicycle', 'motor_vehicle',
    'motorcar', 'vehicle', 'maxspeed', 'service', 'oneway:bicycle', 'cycleway', 'area'];

  /** Overpass-Antwort → kompakte Daten { lat:[], lon:[], wege:[{n:[idx…], t:{…}}] } */
  function kompakt(json) {
    const index = new Map(), lat = [], lon = [];
    for (const el of json.elements || []) {
      if (el.type === 'node' && !index.has(el.id)) { index.set(el.id, lat.length); lat.push(el.lat); lon.push(el.lon); }
    }
    const wege = [];
    for (const el of json.elements || []) {
      if (el.type !== 'way' || !el.tags || !el.tags.highway || !el.nodes) continue;
      const n = [];
      for (const id of el.nodes) { const i = index.get(id); if (i !== undefined) n.push(i); }
      if (n.length < 2) continue;
      const t = {};
      for (const k of TAGS) if (el.tags[k] !== undefined) t[k] = el.tags[k];
      wege.push({ n, t });
    }
    return { version: 1, lat, lon, wege };
  }

  // ---------------------------------------------------------------- Regeln je Verkehrsmittel
  const NIE = new Set(['construction', 'proposed', 'abandoned', 'disused', 'raceway', 'bus_guideway', 'platform', 'corridor', 'elevator']);
  const AUTO_TEMPO = { // km/h, wenn kein maxspeed angegeben ist
    motorway: 100, motorway_link: 60, trunk: 80, trunk_link: 50, primary: 50, primary_link: 40, secondary: 50,
    secondary_link: 40, tertiary: 40, tertiary_link: 30, unclassified: 35, residential: 30, living_street: 7,
    service: 15, road: 25,
  };
  const NEIN = (v) => v === 'no' || v === 'private';
  const JA = (v) => v === 'yes' || v === 'designated' || v === 'permissive' || v === 'destination';

  function tempo(t) {
    const m = parseInt(t.maxspeed, 10);
    if (m > 0) return Math.min(130, m);
    if (t.maxspeed === 'walk') return 7;
    let v = AUTO_TEMPO[t.highway] || 25;
    if (t.service === 'parking_aisle' || t.service === 'driveway') v = 10;
    return v;
  }

  /**
   * Regel für einen Weg: { erlaubt, vor, zurueck, faktor, tempo }
   *   faktor  – Aufschlag auf die Länge (≥ 1, z. B. Rad schieben)
   *   tempo   – nur Auto: km/h
   */
  function regel(t, modus) {
    const h = t.highway;
    if (!h || NIE.has(h) || t.area === 'yes') return null;
    const ow = t.oneway, rund = t.junction === 'roundabout' || t.junction === 'circular';
    if (modus === 'fuss') {
      if (h === 'motorway' || h === 'motorway_link' || h === 'trunk' || h === 'trunk_link') return null;
      if (t.foot === 'no' || t.foot === 'use_sidepath') return null;
      if (NEIN(t.access) && !JA(t.foot)) return null;
      return { vor: true, zurueck: true, faktor: 1 };
    }
    if (modus === 'rad') {
      if (h === 'motorway' || h === 'motorway_link' || h === 'trunk' || h === 'trunk_link') return null;
      if (t.bicycle === 'no' || t.bicycle === 'use_sidepath') return null;
      if (NEIN(t.access) && !JA(t.bicycle)) return null;
      if (t.vehicle === 'no' && !JA(t.bicycle)) return null;
      let faktor = 1;
      if (h === 'steps') { if (!JA(t.bicycle)) faktor = 4; }               // tragen
      else if ((h === 'footway' || h === 'pedestrian' || h === 'corridor') && !JA(t.bicycle)) faktor = 2.5; // schieben
      else if (h === 'primary' || h === 'secondary') faktor = 1.15;        // lieber ruhigere Straßen
      const gegen = t['oneway:bicycle'] === 'no' || /^opposite/.test(t.cycleway || '');
      let vor = true, zurueck = true;
      if (!gegen && faktor < 2) {
        if (ow === 'yes' || ow === 'true' || ow === '1' || rund) zurueck = false;
        else if (ow === '-1' || ow === 'reverse') vor = false;
      }
      return { vor, zurueck, faktor };
    }
    // Auto
    if (!(h in AUTO_TEMPO)) return null;
    if (NEIN(t.access) && !JA(t.motor_vehicle) && !JA(t.motorcar)) return null;
    if (t.motor_vehicle === 'no' || t.motorcar === 'no' || t.vehicle === 'no') return null;
    let vor = true, zurueck = true;
    if (ow === 'yes' || ow === 'true' || ow === '1' || rund || (h === 'motorway' && ow !== 'no')) zurueck = false;
    else if (ow === '-1' || ow === 'reverse') vor = false;
    return { vor, zurueck, faktor: 1, tempo: tempo(t) };
  }

  /**
   * Baut den Graphen für ein Verkehrsmittel.
   * Kanten: kosten = Meter (Fuß/Rad, mit Faktor) bzw. Sekunden (Auto).
   */
  function baueGraph(d, modus) {
    const n = d.lat.length, nach = Array.from({ length: n }, () => []);
    let vmax = 0;
    d.wege.forEach((w, wi) => {
      const r = regel(w.t, modus);
      if (!r) return;
      if (r.tempo && r.tempo > vmax) vmax = r.tempo;
      for (let k = 0; k + 1 < w.n.length; k++) {
        const a = w.n[k], b = w.n[k + 1];
        const m = distanz(d.lat[a], d.lon[a], d.lat[b], d.lon[b]);
        const kosten = modus === 'auto' ? m / (r.tempo / 3.6) : m * r.faktor;
        if (r.vor) nach[a].push({ zu: b, kosten, m, weg: wi });
        if (r.zurueck) nach[b].push({ zu: a, kosten, m, weg: wi });
      }
    });
    // Heuristik-Maßstab: Meter → Kostenart. Auto: Luftlinie / Höchsttempo (nie überschätzen).
    const hFaktor = modus === 'auto' ? 1 / ((vmax || 130) / 3.6) : 1;
    return { modus, d, nach, hFaktor };
  }

  // ---------------------------------------------------------------- Prioritätswarteschlange (Binär-Heap)
  class Heap {
    constructor() { this.k = []; this.p = []; }
    get leer() { return this.k.length === 0; }
    push(knoten, prio) {
      const k = this.k, p = this.p; let i = k.length; k.push(knoten); p.push(prio);
      while (i > 0) {
        const e = (i - 1) >> 1; if (p[e] <= prio) break;
        k[i] = k[e]; p[i] = p[e]; i = e;
      }
      k[i] = knoten; p[i] = prio;
    }
    pop() {
      const k = this.k, p = this.p, top = k[0], lk = k.pop(), lp = p.pop(), n = k.length;
      if (n > 0) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && p[c + 1] < p[c]) c++;
          if (p[c] >= lp) break;
          k[i] = k[c]; p[i] = p[c]; i = c;
        }
        k[i] = lk; p[i] = lp;
      }
      return top;
    }
  }

  /**
   * A*: f(n) = g(n) + h(n)
   *   g = bisherige Kosten vom Start, h = Luftlinie zum Ziel (in Kostenart).
   * Mit opts.dijkstra = true ist h = 0 (zum Vergleich).
   * Ergebnis: { pfad:[idx…], kosten, meter, untersucht, besucht:[idx…], strassen:[{name, meter}] } oder null
   */
  function aStern(g, start, ziel, opts) {
    opts = opts || {};
    const { d, nach, hFaktor } = g, n = d.lat.length;
    const zl = d.lat[ziel], zo = d.lon[ziel];
    const h = opts.dijkstra ? () => 0 : (i) => distanz(d.lat[i], d.lon[i], zl, zo) * hFaktor;
    const gw = new Float64Array(n).fill(Infinity);
    const vor = new Int32Array(n).fill(-1), vorKante = new Array(n);
    const fertig = new Uint8Array(n);
    const offen = new Heap();
    const besucht = [];
    gw[start] = 0; offen.push(start, h(start));
    let untersucht = 0;
    while (!offen.leer) {
      const akt = offen.pop();
      if (fertig[akt]) continue;          // veralteter Eintrag
      fertig[akt] = 1; untersucht++;
      if (opts.mitBesucht) besucht.push(akt);
      if (akt === ziel) break;
      for (const e of nach[akt]) {
        if (fertig[e.zu]) continue;
        const neu = gw[akt] + e.kosten;
        if (neu < gw[e.zu]) { gw[e.zu] = neu; vor[e.zu] = akt; vorKante[e.zu] = e; offen.push(e.zu, neu + h(e.zu)); }
      }
    }
    if (!fertig[ziel]) return null;
    const pfad = [], kanten = [];
    for (let i = ziel; i !== -1; i = vor[i]) { pfad.push(i); if (vorKante[i]) kanten.push(vorKante[i]); }
    pfad.reverse(); kanten.reverse();
    let meter = 0; const strassen = [];
    for (const e of kanten) {
      meter += e.m;
      const t = d.wege[e.weg].t, name = t.name || t.ref || wegArt(t.highway);
      const last = strassen[strassen.length - 1];
      if (last && last.name === name) last.meter += e.m; else strassen.push({ name, meter: e.m });
    }
    return { pfad, kosten: gw[ziel], meter, untersucht, besucht, strassen };
  }

  function wegArt(h) {
    return ({ footway: 'Fußweg', path: 'Pfad', cycleway: 'Radweg', steps: 'Treppe', service: 'Zufahrt', track: 'Feldweg',
      pedestrian: 'Fußgängerzone', living_street: 'Spielstraße', residential: 'Wohnstraße' })[h] || 'Weg';
  }

  /** Nächster Knoten mit Kanten im Graphen (lineare Suche – bei ~50.000 Knoten unter 5 ms). */
  function naechster(g, lat, lon) {
    const { d, nach } = g;
    let best = -1, bd = Infinity;
    const kx = Math.cos(lat * Math.PI / 180);
    for (let i = 0; i < d.lat.length; i++) {
      if (nach[i].length === 0) continue;
      const dy = d.lat[i] - lat, dx = (d.lon[i] - lon) * kx, q = dx * dx + dy * dy;
      if (q < bd) { bd = q; best = i; }
    }
    return best < 0 ? null : { i: best, meter: distanz(lat, lon, d.lat[best], d.lon[best]) };
  }

  /** Geschätzte Dauer in Sekunden. */
  function dauer(r, modus) {
    if (modus === 'auto') return r.kosten;                 // Kosten sind schon Sekunden
    return r.meter / ((modus === 'rad' ? 15 : 5) / 3.6);
  }

  const api = { distanz, kompakt, baueGraph, aStern, naechster, dauer, regel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Wegfinder = api;
})(typeof window !== 'undefined' ? window : globalThis);
