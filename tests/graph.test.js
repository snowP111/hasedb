// Tests für den Wegfinder: node tests/graph.test.js
'use strict';
const W = require('../graph.js');
let ok = 0, fail = 0;
function check(name, cond) { if (cond) ok++; else { fail++; console.log('FEHLER:', name); } }

// Raster 30×30 Knoten bei Pasing, Abstand ~50 m, zufällige Lücken und Straßentypen
function raster(seed) {
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const els = [], N = 30; let id = 1, wid = 1;
  const nid = (x, y) => 1 + y * N + x;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) els.push({ type: 'node', id: id++, lat: 48.14 + y * 0.00045, lon: 11.44 + x * 0.00067 });
  const types = ['residential', 'residential', 'tertiary', 'footway', 'secondary', 'service'];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (x + 1 < N && rnd() > 0.15) els.push({ type: 'way', id: wid++, nodes: [nid(x, y), nid(x + 1, y)], tags: { highway: types[Math.floor(rnd() * types.length)], ...(rnd() < 0.1 ? { oneway: 'yes' } : {}) } });
    if (y + 1 < N && rnd() > 0.15) els.push({ type: 'way', id: wid++, nodes: [nid(x, y), nid(x, y + 1)], tags: { highway: types[Math.floor(rnd() * types.length)], name: 'Straße ' + x } });
  }
  return { elements: els };
}

// 1) A* findet dieselben Kosten wie Dijkstra (Heuristik zulässig), untersucht aber weniger
for (const modus of ['fuss', 'rad', 'auto']) {
  for (let seed = 1; seed <= 15; seed++) {
    const d = W.kompakt(raster(seed)), g = W.baueGraph(d, modus);
    const a = W.naechster(g, 48.14, 11.44), b = W.naechster(g, 48.153, 11.459);
    if (!a || !b) continue;
    const r1 = W.aStern(g, a.i, b.i), r2 = W.aStern(g, a.i, b.i, { dijkstra: true });
    check(`${modus}/${seed} beide gefunden oder beide nicht`, (r1 === null) === (r2 === null));
    if (r1 && r2) {
      check(`${modus}/${seed} optimal (${r1.kosten.toFixed(3)} vs ${r2.kosten.toFixed(3)})`, Math.abs(r1.kosten - r2.kosten) < 1e-6);
      check(`${modus}/${seed} weniger untersucht`, r1.untersucht <= r2.untersucht);
      check(`${modus}/${seed} Pfad zusammenhängend`, r1.pfad[0] === a.i && r1.pfad[r1.pfad.length - 1] === b.i);
    }
  }
}

// 2) Einbahnstraße: Auto darf nicht gegen die Richtung, Fußgänger schon
const ein = { elements: [
  { type: 'node', id: 1, lat: 48.15, lon: 11.46 }, { type: 'node', id: 2, lat: 48.15, lon: 11.462 },
  { type: 'way', id: 1, nodes: [1, 2], tags: { highway: 'residential', oneway: 'yes' } }] };
const de = W.kompakt(ein);
check('Auto in Richtung', W.aStern(W.baueGraph(de, 'auto'), 0, 1) !== null);
check('Auto gegen Einbahn', W.aStern(W.baueGraph(de, 'auto'), 1, 0) === null);
check('Fuß gegen Einbahn', W.aStern(W.baueGraph(de, 'fuss'), 1, 0) !== null);
check('Rad gegen Einbahn verboten', W.aStern(W.baueGraph(de, 'rad'), 1, 0) === null);
ein.elements[2].tags['oneway:bicycle'] = 'no';
check('Rad mit oneway:bicycle=no', W.aStern(W.baueGraph(W.kompakt(ein), 'rad'), 1, 0) !== null);

// 3) Fußweg ist fürs Auto tabu, Autobahn für Fußgänger
const fw = W.kompakt({ elements: [
  { type: 'node', id: 1, lat: 48.15, lon: 11.46 }, { type: 'node', id: 2, lat: 48.151, lon: 11.46 },
  { type: 'way', id: 1, nodes: [1, 2], tags: { highway: 'footway' } }] });
check('Auto kein Fußweg', W.aStern(W.baueGraph(fw, 'auto'), 0, 1) === null);
const bahn = W.kompakt({ elements: [
  { type: 'node', id: 1, lat: 48.15, lon: 11.46 }, { type: 'node', id: 2, lat: 48.151, lon: 11.46 },
  { type: 'way', id: 1, nodes: [1, 2], tags: { highway: 'motorway' } }] });
check('Fuß keine Autobahn', W.aStern(W.baueGraph(bahn, 'fuss'), 0, 1) === null);

// 4) Haversine: Marienplatz → Pasing Bahnhof ≈ 8,6 km Luftlinie
const dm = W.distanz(48.1374, 11.5755, 48.1497, 11.4613);
check('Haversine plausibel (' + Math.round(dm) + ' m)', dm > 8000 && dm < 9000);

// 5) Straßennamen werden zusammengefasst
const d5 = W.kompakt(raster(3)), g5 = W.baueGraph(d5, 'fuss');
const r5 = W.aStern(g5, W.naechster(g5, 48.14, 11.44).i, W.naechster(g5, 48.153, 11.459).i);
check('Straßenliste vorhanden', r5 && r5.strassen.length > 0 && Math.abs(r5.strassen.reduce((a, s) => a + s.meter, 0) - r5.meter) < 1e-6);

// 6) Tempo: groß genug, dass es Echtgröße schafft
const t0 = Date.now(); const big = W.kompakt(raster(7)); for (let k = 0; k < 50; k++) W.baueGraph(big, 'auto');
check('Graph bauen schnell', (Date.now() - t0) < 2000);

console.log(`${ok} bestanden, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
