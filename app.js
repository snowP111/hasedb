/* HaseDB – Web-App für Mac und iPhone, zwei Personen.
 * Sorten (gemeinsam) mit Reviews je Person, Statistik, Smoke-Counter je Person mit Vergleich, Karte.
 * Daten: Supabase (Tabellen hases, reviews, rauchtage, profile, orte). Logik ohne Oberfläche: logik.js */
(function () {
  'use strict';
  const C = window.HASE_CONFIG, L = window.Logik;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const zahl = (v, n) => Number(v).toFixed(n == null ? 1 : n).replace('.', ',');
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const WT = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  const WT_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const langesDatum = (d) => `${WT[d.getDay()]}, ${d.getDate()}. ${MONATE[d.getMonth()]} ${d.getFullYear()}`;

  const sb = window.supabase.createClient(C.supabaseUrl.replace(/\/rest\/v1\/?$/, ''), C.supabaseKey);

  const Z = {
    user: null, profile: {}, hases: [], tage: {}, ansicht: 'start',
    sort: { k: 'name', auf: true },
    filter: { name: '', thcMin: null, thcMax: null, terpene: [], bestrahlt: null, mitReview: null },
    monat: null, tag: null, vglTage: 30,
  };

  let meldungT = 0;
  function meldung(t, ms) {
    const el = $('#meldung'); el.textContent = t; el.hidden = false;
    clearTimeout(meldungT); meldungT = setTimeout(() => { el.hidden = true; }, ms || 2600);
  }

  // ------------------------------------------------------------------ Personen
  const ich = () => Z.user.id;
  function name(uid) {
    if (Z.profile[uid]) return Z.profile[uid];
    if (uid === ich()) return (Z.user.email || 'Ich').split('@')[0];
    return 'Unbenannt';
  }
  const kuerzel = (uid) => name(uid).charAt(0).toUpperCase();
  function personen() {
    const ids = new Set([ich(), ...Object.keys(Z.profile), ...Object.keys(Z.tage)]);
    return [...ids].sort((a, b) => (a === ich() ? -1 : b === ich() ? 1 : name(a).localeCompare(name(b), 'de')));
  }

  // ------------------------------------------------------------------ Laden
  async function laden() {
    const [h, r, t, p] = await Promise.all([
      sb.from('hases').select('id,name,thc,terpene,bestrahlt').order('id'),
      sb.from('reviews').select('hase_id,user_id,text,geaendert'),
      sb.from('rauchtage').select('user_id,datum,anzahl'),
      sb.from('profile').select('user_id,name'),
    ]);
    const fehler = h.error || r.error || t.error || p.error;
    if (fehler) {
      const umbau = /reviews|profile|user_id|does not exist|schema cache/i.test(fehler.message);
      meldung(umbau ? 'Datenbank noch nicht umgebaut – bitte supabase/umbau-zwei-personen.sql ausführen.' : 'Laden fehlgeschlagen: ' + fehler.message, 8000);
      return false;
    }
    const rev = new Map();
    for (const x of r.data) { if (!rev.has(x.hase_id)) rev.set(x.hase_id, []); rev.get(x.hase_id).push(x); }
    Z.hases = h.data.map((x) => ({ ...x, reviews: (rev.get(x.id) || []).filter((y) => y.text && y.text.trim()) }));
    Z.tage = {};
    for (const x of t.data) { (Z.tage[x.user_id] = Z.tage[x.user_id] || {})[x.datum] = x.anzahl; }
    Z.profile = {};
    for (const x of p.data) Z.profile[x.user_id] = x.name;
    return true;
  }
  async function neuZeichnen() { if (await laden()) zeichne(); }

  // ------------------------------------------------------------------ iPhone: schwarzer Balken unten
  // Homescreen-Web-Apps auf iOS: Nach dem ersten Öffnen der Tastatur bleibt der Anzeigebereich zu klein,
  // fest unten sitzende Leisten rutschen hoch und darunter entsteht ein schwarzer Streifen.
  // Abhilfe: nach dem Schließen der Tastatur einmal kurz neu aufbauen lassen, dann misst WebKit die Höhe neu.
  (function viewportHeilen() {
    const homescreen = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    if (!homescreen) return;
    let maxH = window.innerHeight;
    addEventListener('resize', () => { maxH = Math.max(maxH, window.innerHeight); });
    addEventListener('orientationchange', () => { setTimeout(() => { maxH = window.innerHeight; }, 500); });
    function heilen() {
      if (document.activeElement && document.activeElement.matches('input, textarea, select')) return;   // Tastatur noch offen
      if (maxH - window.innerHeight <= 4) return;
      const main = document.querySelector('main'), pos = main ? main.scrollTop : 0;
      document.body.style.display = 'none';
      void document.body.offsetHeight;
      document.body.style.display = '';
      if (main) main.scrollTop = pos;
      window.scrollTo(0, 0);
    }
    document.addEventListener('focusout', (e) => { if (e.target.matches('input, textarea, select')) setTimeout(heilen, 140); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(heilen, 300); });
  })();

  // ------------------------------------------------------------------ Ansichten
  function zeigeAnsicht(a) {
    Z.ansicht = a;
    const reiter = a === 'statistik' ? 'start' : a;   // Statistik gehört zur Übersicht, Profil liegt oben rechts
    $$('#reiter button').forEach((b) => b.classList.toggle('aktiv', b.dataset.ansicht === reiter));
    $('#profil-knopf').classList.toggle('aktiv', a === 'einstellungen');
    $$('.ansicht').forEach((s) => { s.hidden = s.id !== 'ansicht-' + a; });
    $('main').scrollTop = 0;
    if (a === 'karte') {
      if (!window.Karte.gestartet()) window.Karte.start({ sb, user: Z.user, name, meldung });
      window.Karte.zeigen();
    }
    zeichne();
  }
  $$('#reiter button').forEach((b) => b.addEventListener('click', () => zeigeAnsicht(b.dataset.ansicht)));
  function zeichne() {
    if (Z.user) $('#profil-knopf').textContent = kuerzel(ich());
    ({ start: zeichneStart, sorten: zeichneSorten, statistik: zeichneStatistik, smoke: zeichneSmoke, einstellungen: zeichneEinstellungen })[Z.ansicht]?.();
  }

  // ------------------------------------------------------------------ Bausteine
  const kz = (titel, wert, unter, rot) => `<div class="kennzahl${rot ? ' rot' : ''}"><div class="k-titel">${esc(titel)}</div><div class="k-wert">${esc(wert)}</div><div class="k-unter">${esc(unter || '')}</div></div>`;
  function reviewKuerzel(h) {
    return h.reviews.map((r) => `<span class="kuerzel${r.user_id === ich() ? ' ich' : ''}" title="${esc(name(r.user_id))}">${esc(kuerzel(r.user_id))}</span>`).join('') || '<span class="leise">–</span>';
  }
  /** Säulen als SVG. werte: [{ name, w:[…], tip }], Serie 0 rot, Serie 1 weiß */
  function saeulen(werte, opts) {
    opts = opts || {};
    const W = 600, H = 190, unten = 22, oben = 14, n = Math.max(1, werte.length), serien = Math.max(1, ...werte.map((x) => x.w.length));
    const max = Math.max(1, ...werte.flatMap((x) => x.w.map((v) => v || 0)));
    const breite = W / n, innen = breite * 0.72, b = innen / serien;
    const jede = Math.ceil(n / (opts.labels || 15));
    let s = `<svg class="diagramm" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">`;
    s += `<line class="achse" x1="0" x2="${W}" y1="${H - unten}" y2="${H - unten}"/><text x="0" y="10">${max}</text>`;
    werte.forEach((x, i) => {
      x.w.forEach((v, k) => {
        const hh = (H - unten - oben) * (v || 0) / max, xx = i * breite + (breite - innen) / 2 + k * b;
        s += `<rect class="${v == null ? 'b0' : k ? 'b2' : 'b'}" x="${xx.toFixed(1)}" y="${(H - unten - Math.max(hh, v == null ? 0 : 1.5)).toFixed(1)}" width="${Math.max(1, b - 1).toFixed(1)}" height="${Math.max(hh, v == null ? 0 : 1.5).toFixed(1)}"><title>${esc(x.tip || x.name + ': ' + x.w.join(' / '))}</title></rect>`;
      });
      if (i % jede === 0) s += `<text x="${(i * breite + breite / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(x.name)}</text>`;
    });
    return s + '</svg>';
  }
  function balken(werte, fmt, weiss) {
    const max = Math.max(1e-9, ...werte.map((x) => x.wert));
    if (!werte.length) return '<p class="leise">Noch keine Daten.</p>';
    return '<div class="balken">' + werte.map((x) => `<div class="balken-zeile" title="${esc(x.tip || '')}"><span class="bn">${esc(x.name)}</span><span class="bb"><i class="${weiss ? 'weiss' : ''}" style="width:${(100 * x.wert / max).toFixed(1)}%"></i></span><span class="bw">${esc(fmt ? fmt(x.wert) : x.wert)}</span></div>`).join('') + '</div>';
  }

  // ------------------------------------------------------------------ Übersicht
  function zeichneStart() {
    const s = L.statistik(Z.hases), heute = L.heute();
    $('#start-datum').textContent = langesDatum(heute).toUpperCase();
    const top = Z.hases.slice().sort((a, b) => b.thc - a.thc)[0];
    $('#start-kennzahlen').innerHTML =
      kz('EINTRÄGE', s.anzahl, s.bestrahlt + ' davon bestrahlt') +
      kz('Ø THC', s.leer ? '–' : zahl(s.schnitt) + ' %', s.leer ? '' : 'Median ' + zahl(s.median) + ' %') +
      kz('HÖCHSTER THC', top ? zahl(top.thc) + ' %' : '–', top ? top.name : '') +
      kz('MIT REVIEW', s.mitReview, s.leer ? '' : Math.round(100 * s.mitReview / s.anzahl) + ' % bewertet');
    // Smoke-Karte
    const r = L.rauch(Z.tage[ich()] || {}, heute);
    const status = r.heute === undefined ? 'Heute: noch nicht eingetragen' : r.heute === 0 ? 'Heute: rauchfrei ✓' : `Heute: ${r.heute}× geraucht`;
    const andere = personen().filter((p) => p !== ich()).map((p) => {
      const x = L.rauch(Z.tage[p] || {}, heute);
      return `<span>${esc(name(p))}: <b>${x.serie} ${x.serie === 1 ? 'Tag' : 'Tage'}</b> rauchfrei</span>`;
    }).join('');
    $('#start-smoke').innerHTML = `<div class="box-kopf"><span>DEIN SMOKE-COUNTER</span><button class="verlinkt" data-geh="smoke">KALENDER →</button></div>
      <div class="serie"><span class="serie-zahl">${r.serie}</span><span class="serie-text">${r.serie === 1 ? 'TAG' : 'TAGE'} RAUCHFREI · REKORD ${r.rekord}</span></div>
      <div class="status">${status}</div>
      <div class="leiste"><button class="knopf voll" data-smoke="frei">HEUTE RAUCHFREI</button><button class="knopf" data-smoke="plus" aria-label="Einmal geraucht">+1</button><button class="knopf" data-smoke="minus" ${r.heute > 0 ? '' : 'disabled'}>−1</button></div>
      <div class="streifen">${r.letzteTage(14).map((t) => `<span class="${t.anzahl === null ? '' : t.anzahl === 0 ? 'frei' : 'geraucht'}" title="${t.datum.getDate()}.${t.datum.getMonth() + 1}.">${t.anzahl > 0 ? t.anzahl : ''}</span>`).join('')}</div>
      ${andere ? `<div class="vgl-kurz">${andere}</div>` : ''}`;
    // Zuletzt
    const neu = Z.hases.slice().sort((a, b) => b.id - a.id).slice(0, 4);
    $('#start-zuletzt').innerHTML = neu.length ? neu.map((h) => `<div class="zeile-link" data-hase="${h.id}"><div><div class="z-name">${esc(h.name)}</div><div class="z-info">${zahl(h.thc, 2)} % THC</div></div><div>${reviewKuerzel(h)}</div></div>`).join('') : '<p class="leise">Noch keine Einträge.</p>';
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-geh]'); if (g) { zeigeAnsicht(g.dataset.geh); return; }
    const h = e.target.closest('[data-hase]'); if (h) { details(Z.hases.find((x) => x.id === +h.dataset.hase)); return; }
    const sm = e.target.closest('[data-smoke]');
    if (sm) {
      const k = L.iso(L.heute()), jetzt = (Z.tage[ich()] || {})[k];
      if (sm.dataset.smoke === 'frei') setzeTag(k, 0);
      if (sm.dataset.smoke === 'plus') setzeTag(k, (jetzt || 0) + 1);
      if (sm.dataset.smoke === 'minus' && jetzt > 0) setzeTag(k, jetzt - 1);
    }
  });

  // ------------------------------------------------------------------ Sorten (Datenbank + Filter & Suche)
  function filterLesen() {
    const f = Z.filter, num = (id) => { const v = parseFloat(String($(id).value).replace(',', '.')); return Number.isFinite(v) ? v : null; };
    f.name = $('#such-name').value; f.thcMin = num('#f-thc-min'); f.thcMax = num('#f-thc-max');
  }
  function zeichneSorten() {
    filterLesen();
    const f = Z.filter, s = L.statistik(Z.hases);
    $('#f-terpene').innerHTML = s.terpene.map((t) => `<button type="button" data-t="${esc(t.name)}" class="${f.terpene.includes(t.name) ? 'aktiv' : ''}">${esc(t.name)} <small>${t.wert}</small></button>`).join('') || '<span class="leise">Noch keine Terpene.</span>';
    const aktivFilter = f.thcMin != null || f.thcMax != null || f.terpene.length || f.bestrahlt != null || f.mitReview != null;
    $('#filter-auf').classList.toggle('aktiv', !!aktivFilter);
    const k = Z.sort.k, auf = Z.sort.auf ? 1 : -1;
    const liste = Z.hases.filter((h) => L.passt(h, f)).sort((a, b) => auf * (k === 'thc' ? a.thc - b.thc : k === 'bestrahlt' ? (a.bestrahlt - b.bestrahlt) || a.name.localeCompare(b.name, 'de') : a.name.localeCompare(b.name, 'de')));
    $$('#tabelle th[data-sort]').forEach((th) => th.classList.toggle('sortiert', th.dataset.sort === k));
    $('#treffer').textContent = liste.length === Z.hases.length ? `${liste.length} EINTRÄGE` : `${liste.length} VON ${Z.hases.length} EINTRÄGEN`;
    $('#tabelle tbody').innerHTML = liste.length ? liste.map((h) => `<tr data-hase="${h.id}">
        <td>${esc(h.name)}</td><td class="zahl">${zahl(h.thc, 2)} %</td><td class="terp nur-breit">${esc(L.terpenListe(h.terpene).join(', '))}</td>
        <td><span class="etikett${h.bestrahlt ? ' ja' : ''}">${h.bestrahlt ? 'JA' : 'NEIN'}</span></td><td>${reviewKuerzel(h)}</td></tr>`).join('')
      : `<tr class="leer"><td colspan="5">${Z.hases.length ? 'Kein Eintrag passt zu den Filtern.' : 'Noch keine Einträge – „+ Neuer Eintrag“.'}</td></tr>`;
  }
  $('#such-name').addEventListener('input', zeichneSorten);
  $('#f-thc-min').addEventListener('input', zeichneSorten);
  $('#f-thc-max').addEventListener('input', zeichneSorten);
  $('#filter-auf').addEventListener('click', () => { $('#filterfeld').hidden = !$('#filterfeld').hidden; });
  $('#f-terpene').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    const t = b.dataset.t, l = Z.filter.terpene;
    Z.filter.terpene = l.includes(t) ? l.filter((x) => x !== t) : [...l, t];
    zeichneSorten();
  });
  for (const [id, feld] of [['#f-bestrahlt', 'bestrahlt'], ['#f-review', 'mitReview']]) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $$(id + ' button').forEach((x) => x.classList.toggle('aktiv', x === b));
      Z.filter[feld] = b.dataset.w === '' ? null : b.dataset.w === 'ja';
      zeichneSorten();
    });
  }
  $('#filter-reset').addEventListener('click', () => {
    Z.filter = { name: '', thcMin: null, thcMax: null, terpene: [], bestrahlt: null, mitReview: null };
    for (const id of ['#such-name', '#f-thc-min', '#f-thc-max']) $(id).value = '';
    for (const id of ['#f-bestrahlt', '#f-review']) $$(id + ' button').forEach((x, i) => x.classList.toggle('aktiv', i === 0));
    zeichneSorten();
  });
  $$('#tabelle th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    Z.sort = { k: th.dataset.sort, auf: Z.sort.k === th.dataset.sort ? !Z.sort.auf : th.dataset.sort !== 'thc' };
    zeichneSorten();
  }));
  $('#sorte-neu').addEventListener('click', () => formular(null));

  // ------------------------------------------------------------------ Blatt: Details, Formular
  function blatt(html) { $('#blatt-inhalt').innerHTML = html; $('#blatt').hidden = false; }
  function blattZu() { $('#blatt').hidden = true; $('#blatt-inhalt').innerHTML = ''; }
  $('#blatt').addEventListener('click', (e) => { if (e.target.id === 'blatt') blattZu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#blatt').hidden) blattZu(); });

  function details(h) {
    if (!h) return;
    const reviews = personen().map((p) => {
      const r = h.reviews.find((x) => x.user_id === p), meins = p === ich();
      return `<div class="review${meins ? ' ich' : ''}" data-person="${p}">
        <div class="review-wer"><span>${esc(name(p)).toUpperCase()}</span>${meins ? `<button class="verlinkt" data-aktion="review">${r ? 'BEARBEITEN' : 'SCHREIBEN'}</button>` : ''}</div>
        <div class="review-text${r ? '' : ' leer'}">${r ? esc(r.text) : 'Noch kein Review.'}</div></div>`;
    }).join('');
    blatt(`<div class="fenster-kopf">${esc(h.name)}</div>
      <div class="detail-werte"><div><span>THC</span><b>${zahl(h.thc, 2)} %</b></div><div><span>BESTRAHLT</span><b>${h.bestrahlt ? 'Ja' : 'Nein'}</b></div></div>
      <label class="beschr">TERPENE</label>
      <div class="detail-terp">${L.terpenListe(h.terpene).map((t) => `<span class="etikett">${esc(t)}</span>`).join('') || '<span class="leise">–</span>'}</div>
      <div class="detail-orig">Originaleingabe: ${esc(h.terpene)}</div>
      <label class="beschr">REVIEWS</label>${reviews}
      <div class="knopfreihe" style="margin:16px 16px 0"><button class="knopf" data-aktion="bearbeiten">BEARBEITEN</button><button class="knopf gefahr" data-aktion="loeschen">LÖSCHEN</button><button class="knopf" data-aktion="zu">SCHLIESSEN</button></div>`);
    const inhalt = $('#blatt-inhalt');
    inhalt.onclick = async (e) => {
      const a = e.target.closest('[data-aktion]'); if (!a) return;
      const art = a.dataset.aktion;
      if (art === 'zu') blattZu();
      if (art === 'bearbeiten') formular(h);
      if (art === 'loeschen') {
        if (!confirm(`„${h.name}“ wirklich löschen? Das kann nicht rückgängig gemacht werden – auch die Reviews beider Personen werden gelöscht.`)) return;
        const { error } = await sb.from('hases').delete().eq('id', h.id);
        if (error) { meldung('Löschen fehlgeschlagen: ' + error.message, 5000); return; }
        blattZu(); meldung('Gelöscht'); neuZeichnen();
      }
      if (art === 'review') {
        const box = inhalt.querySelector(`.review[data-person="${ich()}"]`), alt = (h.reviews.find((x) => x.user_id === ich()) || {}).text || '';
        box.querySelector('.review-text').outerHTML = `<textarea class="eingabe" rows="5" placeholder="Geschmack, Wirkung, Preis-Leistung …">${esc(alt)}</textarea>
          <div class="knopfreihe"><button class="knopf voll" data-aktion="review-speichern">REVIEW SPEICHERN</button></div>`;
        a.hidden = true; box.querySelector('textarea').focus();
      }
      if (art === 'review-speichern') {
        const text = inhalt.querySelector('.review.ich textarea').value.trim();
        const q = text ? sb.from('reviews').upsert({ hase_id: h.id, user_id: ich(), text, geaendert: new Date().toISOString() }, { onConflict: 'hase_id,user_id' })
          : sb.from('reviews').delete().eq('hase_id', h.id).eq('user_id', ich());
        const { error } = await q;
        if (error) { meldung('Review nicht gespeichert: ' + error.message, 5000); return; }
        await laden(); zeichne(); details(Z.hases.find((x) => x.id === h.id));
      }
    };
  }

  function formular(h) {
    const neu = !h, meinReview = '';
    blatt(`<form id="hase-form"><div class="fenster-kopf">${neu ? 'NEUER EINTRAG' : 'EINTRAG BEARBEITEN'}</div>
      <label class="beschr">NAME</label><input class="eingabe" name="name" placeholder="z. B. Lava Cake" value="${neu ? '' : esc(h.name)}" autocomplete="off">
      <div class="zwei-felder"><div><label class="beschr">THC (%)</label><input class="eingabe" name="thc" inputmode="decimal" placeholder="z. B. 24,5" value="${neu ? '' : zahl(h.thc, 2).replace(/,?0+$/, '')}"></div>
      <div><label class="beschr">BESTRAHLT</label><div class="segment" id="form-bestrahlt"><button type="button" data-w="nein" class="${neu || !h.bestrahlt ? 'aktiv' : ''}">NEIN</button><button type="button" data-w="ja" class="${!neu && h.bestrahlt ? 'aktiv' : ''}">JA</button></div></div></div>
      <label class="beschr">TERPENE</label><input class="eingabe" name="terpene" placeholder="durch Komma getrennt, z. B. Myrcen, Limonen" value="${neu ? '' : esc(h.terpene)}" autocomplete="off">
      ${neu ? `<label class="beschr">DEIN REVIEW (OPTIONAL)</label><textarea class="eingabe" name="review" rows="3" placeholder="Wie war's?">${meinReview}</textarea>` : ''}
      <p class="fehler" id="form-fehler"></p>
      <div class="knopfreihe" style="margin:8px 16px 0"><button class="knopf voll" type="submit">${neu ? 'HINZUFÜGEN' : 'SPEICHERN'}</button><button class="knopf" type="button" id="form-abbrechen">ABBRECHEN</button></div></form>`);
    const form = $('#hase-form');
    let bestrahlt = !neu && h.bestrahlt;
    $('#form-bestrahlt').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; bestrahlt = b.dataset.w === 'ja'; $$('#form-bestrahlt button').forEach((x) => x.classList.toggle('aktiv', x === b)); };
    $('#form-abbrechen').onclick = () => (neu ? blattZu() : details(h));
    setTimeout(() => form.name.focus(), 30);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const nameT = form.name.value.trim(), thcT = form.thc.value.trim().replace(',', '.'), terp = form.terpene.value.trim();
      if (!nameT || !thcT || !terp) { $('#form-fehler').textContent = 'Bitte fülle Name, THC und Terpene aus.'; return; }
      const thc = Number(thcT);
      if (!Number.isFinite(thc) || thc < 0 || thc > 100) { $('#form-fehler').textContent = 'Bitte gib einen THC-Wert zwischen 0 und 100 ein.'; form.thc.focus(); return; }
      const zeileH = { name: nameT, thc, terpene: terp, bestrahlt };
      if (neu) {
        const { data, error } = await sb.from('hases').insert(zeileH).select('id').single();
        if (error) { $('#form-fehler').textContent = 'Die Datenbank meldet: ' + error.message; return; }
        const rv = form.review.value.trim();
        if (rv) await sb.from('reviews').insert({ hase_id: data.id, user_id: ich(), text: rv });
        blattZu(); meldung('„' + nameT + '“ hinzugefügt'); neuZeichnen();
      } else {
        const { error } = await sb.from('hases').update(zeileH).eq('id', h.id);
        if (error) { $('#form-fehler').textContent = 'Die Datenbank meldet: ' + error.message; return; }
        await laden(); zeichne(); details(Z.hases.find((x) => x.id === h.id));
      }
    };
  }

  // ------------------------------------------------------------------ Statistik
  function zeichneStatistik() {
    const s = L.statistik(Z.hases);
    $('#stat-kennzahlen').innerHTML =
      kz('EINTRÄGE', s.anzahl, s.mitReview + ' mit Review') +
      kz('Ø THC', s.leer ? '–' : zahl(s.schnitt) + ' %', s.leer ? '' : 'Median ' + zahl(s.median) + ' %') +
      kz('THC-SPANNE', s.leer ? '–' : `${zahl(s.min)} – ${zahl(s.max)}`, 'Prozent THC') +
      kz('VERSCHIEDENE TERPENE', s.terpene.length, s.terpene.length ? 'am häufigsten: ' + s.terpene[0].name : '');
    const v = L.thcVerteilung(Z.hases, 2);
    $('#stat-verteilung').innerHTML = v.length ? saeulen(v.map((x) => ({ name: x.name, w: [x.wert], tip: `${x.name} % THC: ${x.wert} ${x.wert === 1 ? 'Eintrag' : 'Einträge'}` }))) : '<p class="leise">Noch keine Daten.</p>';
    $('#stat-terpene').innerHTML = balken(s.terpene.slice(0, 7).map((t) => ({ name: t.name, wert: t.wert, tip: `${t.name}: in ${t.wert} Einträgen` })));
    const ges = Math.max(1, s.anzahl);
    $('#stat-bestrahlung').innerHTML = balken([
      { name: 'Bestrahlt', wert: s.bestrahlt, tip: `${s.bestrahlt} von ${s.anzahl}` },
      { name: 'Nicht bestrahlt', wert: s.anzahl - s.bestrahlt, tip: `${s.anzahl - s.bestrahlt} von ${s.anzahl}` },
    ], (w) => Math.round(100 * w / ges) + ' %');
    $('#stat-top').innerHTML = balken(s.top.map((t) => ({ name: t.name, wert: t.wert })), (w) => zahl(w) + ' %', true);
  }

  // ------------------------------------------------------------------ Smoke-Counter
  async function setzeTag(k, n) {
    const { error } = await sb.from('rauchtage').upsert({ user_id: ich(), datum: k, anzahl: Math.max(0, n) }, { onConflict: 'user_id,datum' });
    if (error) { meldung('Nicht gespeichert: ' + error.message, 5000); return; }
    (Z.tage[ich()] = Z.tage[ich()] || {})[k] = Math.max(0, n); zeichne();
  }
  async function entferneTag(k) {
    const { error } = await sb.from('rauchtage').delete().eq('user_id', ich()).eq('datum', k);
    if (error) { meldung('Nicht entfernt: ' + error.message, 5000); return; }
    if (Z.tage[ich()]) delete Z.tage[ich()][k]; zeichne();
  }
  $('#smoke-heute').addEventListener('click', () => setzeTag(L.iso(L.heute()), 0));
  $('#kal-zurueck').addEventListener('click', () => { Z.monat = new Date(Z.monat.getFullYear(), Z.monat.getMonth() - 1, 1); zeichneSmoke(); });
  $('#kal-vor').addEventListener('click', () => { Z.monat = new Date(Z.monat.getFullYear(), Z.monat.getMonth() + 1, 1); zeichneSmoke(); });

  function zeichneSmoke() {
    const heute = L.heute(), hIso = L.iso(heute), tage = Z.tage[ich()] || {}, r = L.rauch(tage, heute);
    if (!Z.monat) Z.monat = new Date(heute.getFullYear(), heute.getMonth(), 1);
    if (!Z.tag) Z.tag = hIso;
    const m = r.monat(heute.getFullYear(), heute.getMonth());
    $('#smoke-kennzahlen').innerHTML =
      kz('AKTUELLE SERIE', `${r.serie} ${r.serie === 1 ? 'Tag' : 'Tage'}`, r.heuteEingetragen ? 'rauchfrei in Folge' : 'heute noch offen', true) +
      kz('LÄNGSTE SERIE', `${r.rekord} ${r.rekord === 1 ? 'Tag' : 'Tage'}`, 'Rekord') +
      kz('DIESER MONAT', `${m.rauchfrei} / ${m.geraucht}`, `rauchfrei / geraucht · ${m.einheiten}× insgesamt${m.offen ? ' · ' + m.offen + ' offen' : ''}`) +
      kz('Ø PRO RAUCHTAG', r.schnittProRauchtag ? zahl(r.schnittProRauchtag) + '×' : '–', r.eingetragen + ' Tage eingetragen');
    // Kalender
    const j = Z.monat.getFullYear(), mo = Z.monat.getMonth();
    $('#kal-titel').textContent = `${MONATE[mo]} ${j}`.toUpperCase();
    $('#kal-vor').disabled = new Date(j, mo + 1, 1) > heute;
    const versatz = (new Date(j, mo, 1).getDay() + 6) % 7, tageImMonat = new Date(j, mo + 1, 0).getDate();
    let k = WT_KURZ.map((w) => `<div class="wt">${w.toUpperCase()}</div>`).join('');
    for (let i = 0; i < versatz; i++) k += '<div class="kal-tag leer"></div>';
    for (let d = 1; d <= tageImMonat; d++) {
      const dat = new Date(j, mo, d), iso = L.iso(dat), a = tage[iso], zuk = dat > heute;
      k += `<button class="kal-tag${a === undefined ? '' : a === 0 ? ' frei' : ' geraucht'}${zuk ? ' zukunft' : ''}${iso === hIso ? ' heute' : ''}${iso === Z.tag ? ' gewaehlt' : ''}" data-tag="${iso}" ${zuk ? 'disabled' : ''}>
        <span>${d}</span><span class="anz">${a > 0 ? a : a === 0 ? '✓' : ''}</span></button>`;
    }
    $('#kalender').innerHTML = k;
    // Editor
    const a = tage[Z.tag], dat = L.ausIso(Z.tag);
    $('#tag-editor').innerHTML = `<div class="box-kopf"><span>AUSGEWÄHLTER TAG</span></div>
      <div class="editor-datum">${langesDatum(dat)}${Z.tag === hIso ? ' (heute)' : ''}</div>
      <div class="leise">${a === undefined ? 'NICHT EINGETRAGEN' : a === 0 ? 'RAUCHFREI' : a + '× GERAUCHT'}</div>
      <label class="beschr">WIE OFT GERAUCHT?</label>
      <div class="stepper"><button class="knopf" data-ed="minus" ${a > 0 ? '' : 'disabled'}>−</button><span class="zaehler">${a === undefined ? '–' : a}</span><button class="knopf" data-ed="plus">+</button></div>
      <div class="editor-knoepfe"><button class="knopf" data-ed="frei" ${a === 0 ? 'disabled' : ''}>RAUCHFREI ✓</button><button class="knopf gefahr" data-ed="weg" ${a === undefined ? 'disabled' : ''}>EINTRAG ENTFERNEN</button></div>`;
    // Diagramme
    $('#smoke-30').innerHTML = saeulen(r.letzteTage(30).map((t) => ({
      name: `${t.datum.getDate()}.${t.datum.getMonth() + 1}.`, w: [t.anzahl > 0 ? t.anzahl : 0],
      tip: `${WT[t.datum.getDay()].slice(0, 2)} ${t.datum.getDate()}.${t.datum.getMonth() + 1}.: ${t.anzahl === null ? 'nicht eingetragen' : t.anzahl === 0 ? 'rauchfrei' : t.anzahl + '× geraucht'}`,
    })), { labels: 10 });
    $('#smoke-woche').innerHTML = saeulen(r.proWochentag().map((v, i) => ({ name: WT_KURZ[i], w: [v], tip: `${WT[(i + 1) % 7]}: ${v}× geraucht` })));
    zeichneVergleich();
  }
  $('#kalender').addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (!b || b.disabled) return; Z.tag = b.dataset.tag; zeichneSmoke(); });
  $('#tag-editor').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ed]'); if (!b || b.disabled) return;
    const a = (Z.tage[ich()] || {})[Z.tag];
    ({ plus: () => setzeTag(Z.tag, (a || 0) + 1), minus: () => setzeTag(Z.tag, Math.max(0, (a || 0) - 1)), frei: () => setzeTag(Z.tag, 0), weg: () => entferneTag(Z.tag) })[b.dataset.ed]();
  });

  function zeichneVergleich() {
    const ps = personen(), el = $('#vergleich');
    if (ps.length < 2) {
      el.innerHTML = `<div class="box-kopf"><span>VERGLEICH</span></div><p class="leise">Sobald die zweite Person sich anmeldet und etwas einträgt, erscheint hier euer Vergleich.</p>`;
      return;
    }
    const zwei = ps.slice(0, 2), n = Z.vglTage;
    const v = L.vergleich(zwei.map((p) => ({ id: p, name: name(p), tage: Z.tage[p] || {} })), n, L.heute());
    const best = (arr, hoch) => { const z = hoch ? Math.max(...arr) : Math.min(...arr); return arr.map((x) => x === z && arr.filter((y) => y === z).length === 1); };
    const bS = best(v.serien, true), bR = best(v.rekorde, true), bF = best(v.rauchfrei, true), bG = best(v.summen, false);
    const zeilen = [
      ['Aktuelle Serie', v.serien, bS, (x) => x + (x === 1 ? ' Tag' : ' Tage')],
      ['Rekord', v.rekorde, bR, (x) => x + (x === 1 ? ' Tag' : ' Tage')],
      [`Rauchfrei (${n} T.)`, v.rauchfrei, bF, (x) => x],
      [`Mal geraucht (${n} T.)`, v.summen, bG, (x) => x + '×'],
      ['Eingetragen', v.eingetragen, [false, false], (x) => `${x} / ${n}`],
    ];
    el.innerHTML = `<div class="box-kopf"><span>VERGLEICH</span><div class="segment" id="vgl-n">${[7, 30, 90].map((x) => `<button data-n="${x}" class="${x === n ? 'aktiv' : ''}">${x} TAGE</button>`).join('')}</div></div>
      <table class="vgl-tabelle"><thead><tr><th></th>${zwei.map((p, i) => `<th><span class="punkt${i ? ' weiss' : ''}"></span>${esc(name(p))}</th>`).join('')}</tr></thead><tbody>
      ${zeilen.map(([t, w, b, f]) => `<tr><td>${t}</td>${w.map((x, i) => `<td class="${b[i] ? 'besser' : ''}">${f(x)}</td>`).join('')}</tr>`).join('')}
      </tbody></table>
      <div class="raster zwei breit-links" style="margin-top:0">
        <div><div class="box-kopf"><span>PRO TAG</span><span class="leise">${zwei.map((p, i) => `<span class="punkt${i ? ' weiss' : ''}"></span>${esc(name(p))}`).join(' &nbsp; ')}</span></div>
          ${saeulen(v.tage.map((t) => ({ name: `${t.datum.getDate()}.${t.datum.getMonth() + 1}.`, w: t.werte.map((x) => (x > 0 ? x : 0)),
            tip: `${t.datum.getDate()}.${t.datum.getMonth() + 1}.: ` + zwei.map((p, i) => `${name(p)} ${t.werte[i] === null ? '–' : t.werte[i] === 0 ? 'rauchfrei' : t.werte[i] + '×'}`).join(', ') })), { labels: 10 })}</div>
        <div><div class="box-kopf"><span>NACH WOCHENTAG</span></div>
          ${saeulen(WT_KURZ.map((w, i) => ({ name: w, w: v.wochentage.map((x) => x[i]), tip: `${WT[(i + 1) % 7]}: ` + zwei.map((p, k) => `${name(p)} ${v.wochentage[k][i]}×`).join(', ') })))}</div>
      </div>`;
    $('#vgl-n').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; Z.vglTage = +b.dataset.n; zeichneVergleich(); };
  }

  // ------------------------------------------------------------------ Einstellungen
  function zeichneEinstellungen() {
    $('#profil-name').value = name(ich());
    $('#profil-mail').textContent = 'Angemeldet als ' + (Z.user.email || '');
    try { $('#opt-3d').checked = JSON.parse(localStorage.getItem('hasedb.karte.3d') ?? 'true'); } catch (e) { /* Standard */ }
  }
  async function nameSpeichern(n) {
    n = String(n || '').trim();
    if (!n) { meldung('Bitte einen Namen eingeben'); return false; }
    const { error } = await sb.from('profile').upsert({ user_id: ich(), name: n.slice(0, 40), geaendert: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) { meldung('Name nicht gespeichert: ' + error.message, 5000); return false; }
    Z.profile[ich()] = n.slice(0, 40); meldung('Name gespeichert'); return true;
  }
  $('#profil-speichern').addEventListener('click', async () => { if (await nameSpeichern($('#profil-name').value)) zeichne(); });
  $('#abmelden').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
  $('#opt-3d').addEventListener('change', (e) => { if (!window.Karte.gestartet()) try { localStorage.setItem('hasedb.karte.3d', JSON.stringify(e.target.checked)); } catch (err) { /* egal */ } });
  $('#knopf-daten').addEventListener('click', () => { if (!window.Karte.gestartet()) meldung('Öffne zuerst einmal die Karte'); });

  function fragNachName() {
    blatt(`<form id="name-form"><div class="fenster-kopf">WIE HEISST DU?</div>
      <p class="hinweis">Dein Name erscheint bei deinen Reviews, im Smoke-Counter-Vergleich und bei geteilten Orten. Ändern kannst du ihn unter Einstellungen.</p>
      <label class="beschr">NAME</label><input class="eingabe" name="n" maxlength="40" value="${esc(name(ich()))}" autocomplete="off">
      <div class="knopfreihe" style="margin:16px 16px 0"><button class="knopf voll" type="submit">SPEICHERN</button></div></form>`);
    $('#name-form').onsubmit = async (e) => { e.preventDefault(); if (await nameSpeichern(e.target.n.value)) { blattZu(); zeichne(); } };
  }

  // ------------------------------------------------------------------ Anmeldung & Start
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-fehler').textContent = '';
    const { data, error } = await sb.auth.signInWithPassword({ email: $('#login-mail').value.trim(), password: $('#login-pw').value });
    if (error) { $('#login-fehler').textContent = 'Anmeldung fehlgeschlagen: ' + error.message; return; }
    starten(data.user);
  });
  async function starten(user) {
    Z.user = user;
    $('#login').hidden = true; $('#app').hidden = false;
    if (await laden()) {
      zeichne();
      if (!Z.profile[ich()]) fragNachName();
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && Z.user) neuZeichnen(); });
  (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) starten(data.session.user); else $('#login').hidden = false;
  })();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  window.__hase = { Z, zeigeAnsicht, laden, zeichne };
})();
