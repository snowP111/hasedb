// node tests/logik.test.js
'use strict';
const L = require('../logik.js');
let ok = 0, fail = 0;
const eq = (name, a, b) => { const s = JSON.stringify(a) === JSON.stringify(b); if (s) ok++; else { fail++; console.log('FEHLER:', name, '→', JSON.stringify(a), '≠', JSON.stringify(b)); } };

// Terpene (wie Terpene.java)
eq('ß-Caryophyllen', L.normalisiere('ß-Caryophyllen'), 'Caryophyllen');
eq('a-2-Pinen', L.normalisiere('a-2-Pinen'), 'Pinen');
eq('Limonene', L.normalisiere('Limonene'), 'Limonen');
eq('Tippfehler', L.normalisiere(' caryopyllen '), 'Caryophyllen');
eq('D-Limonen', L.normalisiere('D-Limonen'), 'Limonen');
eq('Liste ohne Doppelte', L.terpenListe('ß-Myrcen, Myrcen; Myrcene / Linalool'), ['Myrcen', 'Linalool']);

// Filter
const hs = [
  { id: 1, name: 'Lava Cake', thc: 24.5, terpene: 'Myrcen, Limonen', bestrahlt: false, reviews: [{ text: 'gut' }] },
  { id: 2, name: 'Amnesia', thc: 22, terpene: 'ß-Caryophyllen, Myrcene', bestrahlt: true, reviews: [] },
  { id: 3, name: 'Gelato', thc: 27.1, terpene: 'Limonen', bestrahlt: false, reviews: [{ text: '  ' }] },
];
const namen = (f) => hs.filter((h) => L.passt(h, f)).map((h) => h.name);
eq('Name', namen({ name: 'la' }), ['Lava Cake', 'Gelato']);
eq('THC-Bereich', namen({ thcMin: 22, thcMax: 24.5 }), ['Lava Cake', 'Amnesia']);
eq('alle Terpene', namen({ terpene: ['Myrcen', 'Limonen'] }), ['Lava Cake']);
eq('bestrahlt', namen({ bestrahlt: true }), ['Amnesia']);
eq('mit Review (leere zählt nicht)', namen({ mitReview: true }), ['Lava Cake']);
eq('ohne Review', namen({ mitReview: false }), ['Amnesia', 'Gelato']);

// Statistik
const s = L.statistik(hs);
eq('Anzahl', s.anzahl, 3); eq('Median', s.median, 24.5); eq('Min/Max', [s.min, s.max], [22, 27.1]);
eq('Terpen-Häufigkeit', s.terpene.slice(0, 2), [{ name: 'Limonen', wert: 2 }, { name: 'Myrcen', wert: 2 }]);
eq('Top', s.top.map((t) => t.name), ['Gelato', 'Lava Cake', 'Amnesia']);
eq('THC-Verteilung', L.thcVerteilung(hs, 2), [{ name: '22–24', wert: 1 }, { name: '24–26', wert: 1 }, { name: '26–28', wert: 1 }]);
eq('leer', L.statistik([]).leer, true);

// Smoke-Counter (wie RauchStatistik.java)
const H = new Date(2026, 10, 25); // 25.11.2026
const tage = { '2026-11-20': 2, '2026-11-21': 0, '2026-11-22': 0, '2026-11-23': 0, '2026-11-24': 0 };
let r = L.rauch(tage, H);
eq('Serie, heute offen zählt weiter', r.serie, 4);
eq('Rekord', r.rekord, 4);
r = L.rauch({ ...tage, '2026-11-25': 1 }, H); eq('heute geraucht → 0', r.serie, 0);
r = L.rauch({ ...tage, '2026-11-25': 0 }, H); eq('heute rauchfrei → 5', r.serie, 5);
r = L.rauch({ '2026-11-22': 0, '2026-11-24': 0 }, H); eq('Lücke reißt Serie', [r.serie, r.rekord], [1, 1]);
const m = L.rauch(tage, H).monat(2026, 10);
eq('Monat', m, { rauchfrei: 4, geraucht: 1, einheiten: 2, offen: 20 });
eq('Ø pro Rauchtag', L.rauch({ a: 0, '2026-11-01': 2, '2026-11-02': 3 }, H).schnittProRauchtag, 2.5);
eq('letzte Tage', L.rauch(tage, H).letzteTage(3).map((t) => t.anzahl), [0, 0, null]);
eq('Wochentag (20.11. = Freitag)', L.rauch(tage, H).proWochentag(), [0, 0, 0, 0, 2, 0, 0]);
eq('Monatswechsel Serie', L.rauch({ '2026-10-31': 0, '2026-11-01': 0 }, new Date(2026, 10, 2)).serie, 2);

// Vergleich
const v = L.vergleich([{ name: 'Lucas', tage }, { name: 'Max', tage: { '2026-11-24': 3, '2026-11-23': 0 } }], 7, H);
eq('Vergleich Summen', v.summen, [2, 3]);
eq('Vergleich rauchfrei', v.rauchfrei, [4, 1]);
eq('Vergleich Serien', v.serien, [4, 0]);
eq('Vergleich Tage', v.tage.length, 7);

console.log(`${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
