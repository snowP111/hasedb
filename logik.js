/*
 * HaseDB – Logik ohne Oberfläche (aus der Java-Version übertragen: Terpene, HaseFilter,
 * Statistik, RauchStatistik) plus Vergleich zweier Personen. Testbar mit Node.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- Datum (immer lokal, nie UTC)
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const ausIso = (t) => { const [j, m, d] = t.split('-').map(Number); return new Date(j, m - 1, d); };
  const plusTage = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const heute = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };

  // ---------------------------------------------------------------- Terpene
  const VARIANTEN = { caryopyllen: 'Caryophyllen', mycren: 'Myrcen' };
  /** "ß-Caryophyllen" → "Caryophyllen", "a-2-Pinen" → "Pinen", "Limonene" → "Limonen" */
  function normalisiere(t) {
    if (t == null) return '';
    let n = String(t).trim().replace(/^(?:[αβßaAbBdDlL](?:-\d+)?-)+/, '').trim();
    if (!n) return '';
    if (n.toLowerCase().endsWith('ene')) n = n.slice(0, -1);
    const k = n.toLowerCase();
    if (VARIANTEN[k]) return VARIANTEN[k];
    return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
  }
  function terpenListe(text) {
    const s = new Set();
    for (const teil of String(text || '').split(/[,;/]/)) { const n = normalisiere(teil); if (n) s.add(n); }
    return [...s];
  }

  // ---------------------------------------------------------------- Filter (leer/null = egal)
  /** f = { name, thcMin, thcMax, terpene:[…] (alle müssen enthalten sein), bestrahlt: true|false|null, mitReview: true|false|null } */
  function passt(h, f) {
    if (f.name && !h.name.toLowerCase().includes(f.name.trim().toLowerCase())) return false;
    if (f.thcMin != null && h.thc < f.thcMin - 1e-9) return false;
    if (f.thcMax != null && h.thc > f.thcMax + 1e-9) return false;
    if (f.bestrahlt != null && !!h.bestrahlt !== f.bestrahlt) return false;
    if (f.mitReview != null && hatReview(h) !== f.mitReview) return false;
    if (f.terpene && f.terpene.length) { const l = terpenListe(h.terpene); if (!f.terpene.every((t) => l.includes(t))) return false; }
    return true;
  }
  const hatReview = (h) => (h.reviews || []).some((r) => r.text && r.text.trim());

  // ---------------------------------------------------------------- Statistik
  function statistik(hases) {
    const thc = hases.map((h) => h.thc).sort((a, b) => a - b), n = thc.length;
    const median = n ? (n % 2 ? thc[(n - 1) / 2] : (thc[n / 2 - 1] + thc[n / 2]) / 2) : 0;
    const zaehler = {};
    for (const h of hases) for (const t of terpenListe(h.terpene)) zaehler[t] = (zaehler[t] || 0) + 1;
    const terpene = Object.entries(zaehler).map(([name, wert]) => ({ name, wert }))
      .sort((a, b) => b.wert - a.wert || a.name.localeCompare(b.name, 'de'));
    return {
      anzahl: n, leer: n === 0,
      schnitt: n ? thc.reduce((a, b) => a + b, 0) / n : 0, median, min: n ? thc[0] : 0, max: n ? thc[n - 1] : 0,
      bestrahlt: hases.filter((h) => h.bestrahlt).length,
      mitReview: hases.filter(hatReview).length,
      terpene,
      top: hases.slice().sort((a, b) => b.thc - a.thc).slice(0, 5).map((h) => ({ name: h.name, wert: h.thc })),
    };
  }
  /** THC-Werte in Bereiche der Breite schritt (z. B. "22–24"). */
  function thcVerteilung(hases, schritt) {
    if (!hases.length) return [];
    const s = statistik(hases), start = Math.floor(s.min / schritt) * schritt, ende = Math.floor(s.max / schritt) * schritt;
    const b = new Map();
    for (let v = start; v <= ende + 1e-9; v += schritt) b.set(Math.round(v / schritt), 0);
    for (const h of hases) { const k = Math.floor(h.thc / schritt + 1e-9); b.set(k, (b.get(k) || 0) + 1); }
    return [...b.entries()].map(([k, wert]) => ({ name: `${Math.round(k * schritt)}–${Math.round(k * schritt + schritt)}`, wert }));
  }

  // ---------------------------------------------------------------- Smoke-Counter
  // tage: { "2026-11-20": 0 (rauchfrei) | n (n-mal geraucht) }; fehlender Tag = nicht eingetragen
  function rauch(tage, h) {
    h = h || heute();
    const hIso = iso(h);
    const sortiert = Object.keys(tage).sort();
    function aktuelleSerie() {
      const w = tage[hIso];
      if (w > 0) return 0;
      let d = w == null ? plusTage(h, -1) : h, n = 0;
      while (tage[iso(d)] === 0) { n++; d = plusTage(d, -1); }
      return n;
    }
    function laengsteSerie() {
      let best = 0, akt = 0, vorher = null;
      for (const k of sortiert) {
        if (tage[k] === 0) {
          const d = ausIso(k);
          akt = vorher && iso(plusTage(vorher, 1)) === k ? akt + 1 : 1;
          if (akt > best) best = akt;
          vorher = d;
        } else { akt = 0; vorher = null; }
      }
      return best;
    }
    function monat(j, m) { // m: 0–11
      const pre = `${j}-${String(m + 1).padStart(2, '0')}-`;
      const werte = sortiert.filter((k) => k.startsWith(pre)).map((k) => tage[k]);
      const letzter = new Date(j, m + 1, 0);
      const ende = letzter > h ? h : letzter;
      const bisher = ende < new Date(j, m, 1) ? 0 : ende.getDate();
      return {
        rauchfrei: werte.filter((a) => a === 0).length, geraucht: werte.filter((a) => a > 0).length,
        einheiten: werte.reduce((a, b) => a + b, 0), offen: Math.max(0, bisher - werte.length),
      };
    }
    const rauchWerte = sortiert.map((k) => tage[k]).filter((a) => a > 0);
    function letzteTage(n) {
      const out = [];
      for (let i = n - 1; i >= 0; i--) { const d = plusTage(h, -i), k = iso(d); out.push({ datum: d, iso: k, anzahl: tage[k] === undefined ? null : tage[k] }); }
      return out;
    }
    function proWochentag() { // Montag zuerst
      const v = [0, 0, 0, 0, 0, 0, 0];
      for (const k of sortiert) v[(ausIso(k).getDay() + 6) % 7] += tage[k];
      return v;
    }
    return {
      heuteEingetragen: tage[hIso] !== undefined, heute: tage[hIso],
      serie: aktuelleSerie(), rekord: laengsteSerie(), monat,
      eingetragen: sortiert.length,
      schnittProRauchtag: rauchWerte.length ? rauchWerte.reduce((a, b) => a + b, 0) / rauchWerte.length : 0,
      letzteTage, proWochentag,
    };
  }

  /**
   * Vergleich zweier (oder mehr) Personen über die letzten n Tage.
   * personen: [{ id, name, tage }] → { tage:[{iso, werte:[…]}], summen:[…], rauchfrei:[…], serien:[…], rekorde:[…] }
   */
  function vergleich(personen, n, h) {
    h = h || heute();
    const r = personen.map((p) => rauch(p.tage, h));
    const tage = r[0] ? r[0].letzteTage(n).map((t, i) => ({ iso: t.iso, datum: t.datum, werte: r.map((x) => x.letzteTage(n)[i].anzahl) })) : [];
    const summen = personen.map((_, pi) => tage.reduce((a, t) => a + (t.werte[pi] || 0), 0));
    const rauchfrei = personen.map((_, pi) => tage.filter((t) => t.werte[pi] === 0).length);
    const eingetragen = personen.map((_, pi) => tage.filter((t) => t.werte[pi] !== null).length);
    return { tage, summen, rauchfrei, eingetragen, serien: r.map((x) => x.serie), rekorde: r.map((x) => x.rekord), wochentage: r.map((x) => x.proWochentag()) };
  }

  const api = { iso, ausIso, plusTage, heute, normalisiere, terpenListe, passt, hatReview, statistik, thcVerteilung, rauch, vergleich };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Logik = api;
})(typeof window !== 'undefined' ? window : globalThis);
