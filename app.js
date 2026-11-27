/* HaseDB – Web-App für Mac und iPhone, mehrere Personen in Gruppen.
 * Sorten je Gruppe (Lucas + patong teilen eine Liste) mit Reviews je Person, Statistik,
 * Smoke-Counter je Person mit Vergleich aller, Karte (Orte für alle oder für die eigene Gruppe).
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
    user: null, profile: {}, gruppe: {}, hases: [], tage: {}, ansicht: 'start',
    sort: { k: 'name', auf: true },
    filter: { name: '', thcMin: null, thcMax: null, terpene: [], bestrahlt: null, mitReview: null },
    monat: null, tag: null, vglTage: 30, vglSort: 'serie', vglMit: null,
  };

  let meldungT = 0;
  /** Kurze Meldung unten/oben – als Popover im Top-Layer, damit sie auch über offenen Dialogen steht. */
  function meldung(t, ms) {
    const el = $('#meldung'); el.textContent = t; el.hidden = false;
    try { if (el.showPopover && !el.matches(':popover-open')) el.showPopover(); } catch (e) { /* ältere Browser: normal anzeigen */ }
    clearTimeout(meldungT);
    meldungT = setTimeout(() => { el.hidden = true; try { if (el.hidePopover) el.hidePopover(); } catch (e) { /* egal */ } }, ms || 2600);
  }

  // ------------------------------------------------------------------ Bibliotheken: Icons, Diagramme, Rückfrage
  const IKON = { 'stroke-width': 1.5, width: 22, height: 22 };
  const ikonen = (wurzel) => { if (window.lucide) window.lucide.createIcons({ attrs: IKON, root: wurzel }); };
  ikonen();

  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  if (window.Chart) {
    const D = Chart.defaults;
    D.font.family = css('--sans'); D.font.size = 11; D.color = css('--muted'); D.borderColor = css('--line');
    D.plugins.legend.display = false;
    Object.assign(D.plugins.tooltip, { backgroundColor: css('--surface-2'), borderColor: css('--line-strong'), borderWidth: 1, cornerRadius: 0, titleColor: css('--text'), bodyColor: css('--text'), padding: 10, displayColors: false, caretSize: 0 });
    D.elements.bar.borderRadius = 0;
    D.animation.duration = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250;
  }
  const diagramme = new Map();
  /** Säulendiagramm (Chart.js) in el. reihen: [{ daten:[…] }] – Reihe 0 rot (du), Reihe 1 weiß. tips(i) = Text beim Antippen. */
  function saeulen(el, labels, reihen, tips, opts) {
    opts = opts || {};
    if (diagramme.has(el.id)) { diagramme.get(el.id).destroy(); diagramme.delete(el.id); }
    if (!window.Chart) { el.innerHTML = '<p class="leise">Diagramm nicht geladen.</p>'; return; }
    el.innerHTML = '<div class="diagramm"><canvas></canvas></div>';
    const farben = opts.farbe ? [opts.farbe] : [css('--accent'), css('--text')];
    diagramme.set(el.id, new Chart(el.querySelector('canvas'), {
      type: 'bar',
      data: { labels, datasets: reihen.map((r, k) => ({ data: r.daten, backgroundColor: farben[k] || css('--muted'), hoverBackgroundColor: opts.farbe ? css('--text') : k ? '#fff' : css('--accent-hell'), barPercentage: reihen.length > 1 ? 0.9 : 0.72, categoryPercentage: 0.8 })) },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { color: css('--line') }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: opts.labels || 15 } },
          y: { display: !opts.schlicht, beginAtZero: true, border: { display: false }, grid: { color: css('--line') }, ticks: { precision: 0, maxTicksLimit: 4 } },
        },
        plugins: { tooltip: { filter: (c) => c.datasetIndex === 0, callbacks: { title: () => '', label: (c) => tips(c.dataIndex) } } },
      },
    }));
  }

  /** Rückfrage vor dem Löschen (Dialog statt confirm()). Liefert true bei „Löschen“. */
  function frage(titel, text) {
    const d = $('#bestaetigen');
    d.label = titel; $('#bestaetigen-text').textContent = text || '';
    return new Promise((fertig) => {
      let antwort = false;
      const ja = () => { antwort = true; d.open = false; };
      const nein = () => { d.open = false; };
      $('#bestaetigen-ja').onclick = ja; $('#bestaetigen-nein').onclick = nein;
      d.addEventListener('wa-after-hide', function zu(e) { if (e.target !== d) return; d.removeEventListener('wa-after-hide', zu); fertig(antwort); });
      d.open = true;
    });
  }

  // Drawer: auf dem iPhone von unten, auf dem Mac von rechts
  const schmal = matchMedia('(max-width: 820px)');
  function drawerSeite() { for (const d of $$('wa-drawer')) d.placement = schmal.matches ? 'bottom' : 'end'; }
  drawerSeite(); schmal.addEventListener('change', drawerSeite);

  // ------------------------------------------------------------------ Personen
  const ich = () => Z.user.id;
  function name(uid) {
    if (Z.profile[uid]) return Z.profile[uid];
    if (uid === ich()) return (Z.user.email || 'Ich').split('@')[0];
    return 'Unbenannt';
  }
  const kuerzel = (uid) => name(uid).charAt(0).toUpperCase();
  const gruppeVon = (uid) => Z.gruppe[uid] || uid;
  /** Personen, die dieselbe Sortenliste teilen (Reviews). */
  const gruppe = () => personen().filter((p) => gruppeVon(p) === gruppeVon(ich()));
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
      sb.from('profile').select('user_id,name,gruppe'),
    ]);
    const fehler = h.error || r.error || t.error || p.error;
    if (fehler) {
      const umbau = /reviews|profile|user_id|gruppe|does not exist|schema cache/i.test(fehler.message);
      meldung(umbau ? 'Datenbank noch nicht umgebaut – bitte supabase/umbau-gruppen.sql ausführen.' : 'Laden fehlgeschlagen: ' + fehler.message, 8000);
      return false;
    }
    const rev = new Map();
    for (const x of r.data) { if (!rev.has(x.hase_id)) rev.set(x.hase_id, []); rev.get(x.hase_id).push(x); }
    Z.hases = h.data.map((x) => ({ ...x, reviews: (rev.get(x.id) || []).filter((y) => y.text && y.text.trim()) }));
    Z.tage = {};
    for (const x of t.data) { (Z.tage[x.user_id] = Z.tage[x.user_id] || {})[x.datum] = x.anzahl; }
    Z.profile = {}; Z.gruppe = {};
    for (const x of p.data) { Z.profile[x.user_id] = x.name; Z.gruppe[x.user_id] = x.gruppe; }
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
      if (!window.Karte.gestartet()) window.Karte.start({ sb, user: Z.user, name, gruppeVon, meldung, frage });
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
  function balken(werte, fmt, weiss) {
    const max = Math.max(1e-9, ...werte.map((x) => x.wert));
    if (!werte.length) return '<p class="leise">Noch keine Daten.</p>';
    return '<div class="balken">' + werte.map((x) => `<div class="balken-zeile" title="${esc(x.tip || '')}"><span class="bn">${esc(x.name)}</span><span class="bb"><i class="${weiss ? 'weiss' : ''}" style="width:${(100 * x.wert / max).toFixed(1)}%"></i></span><span class="bw">${esc(fmt ? fmt(x.wert) : x.wert)}</span></div>`).join('') + '</div>';
  }

  // ------------------------------------------------------------------ Übersicht
  // Zwei klar getrennte Teile: oben/links der Smoke-Counter als große Aussage mit Verlauf und einer Hauptaktion,
  // unten/rechts die Sorten mit einer Kennzahl, kleiner THC-Grafik und den neuesten Einträgen.
  const WT_BUCHST = ['S', 'M', 'D', 'M', 'D', 'F', 'S'];
  function zeichneStart() {
    const heute = L.heute(), r = L.rauch(Z.tage[ich()] || {}, heute);
    const status = r.heute === undefined ? 'Heute noch offen' : r.heute === 0 ? 'Heute rauchfrei' : `Heute ${r.heute}× geraucht`;
    // Platz im Vergleich (nach Serie)
    const ps = personen(), serien = ps.map((p) => L.rauch(Z.tage[p] || {}, heute).serie);
    const platz = 1 + serien.filter((x) => x > r.serie).length;
    // Verlauf der letzten 14 Tage: rauchfrei = weißer Block, geraucht = rote Säule (Höhe = Anzahl), offen = Linie
    const t14 = r.letzteTage(14), max = Math.max(1, ...t14.map((t) => t.anzahl || 0));
    const verlauf = t14.map((t, i) => {
      const art = t.anzahl === null ? 'offen' : t.anzahl === 0 ? 'frei' : 'geraucht';
      const h = art === 'geraucht' ? Math.max(18, Math.round(100 * t.anzahl / max)) : art === 'frei' ? 100 : 0;
      const text = `${t.datum.getDate()}.${t.datum.getMonth() + 1}.: ${art === 'offen' ? 'nicht eingetragen' : art === 'frei' ? 'rauchfrei' : t.anzahl + '× geraucht'}`;
      return `<div class="v-tag ${art}${i === 13 ? ' heute' : ''}" title="${text}" aria-label="${text}"><div class="v-saeule"><i style="height:${h}%"></i></div><span>${WT_BUCHST[t.datum.getDay()]}</span></div>`;
    }).join('');
    $('#start-smoke').innerHTML = `<div class="label">${esc(langesDatum(heute))}</div>
      <h1 class="held"><span class="rot">${r.serie}</span> ${r.serie === 1 ? 'Tag' : 'Tage'}<br>rauchfrei.</h1>
      <p class="held-unter">${status} · Rekord ${r.rekord} ${r.rekord === 1 ? 'Tag' : 'Tage'}</p>
      <div class="verlauf" role="img" aria-label="Die letzten 14 Tage">${verlauf}</div>
      <div class="start-aktion">
        <button class="knopf voll" data-smoke="frei" ${r.heute === 0 ? 'disabled' : ''}>HEUTE RAUCHFREI</button>
        <button class="knopf" data-smoke="plus" aria-label="Einmal geraucht">+1</button>
        <button class="knopf" data-smoke="minus" aria-label="Eins weniger" ${r.heute > 0 ? '' : 'disabled'}>−1</button>
      </div>
      <div class="start-links">
        <button class="textlink" data-geh="smoke">Kalender</button>
        ${ps.length > 1 ? `<button class="textlink" data-geh="smoke" data-ziel="vergleich">Platz ${platz} von ${ps.length}</button>` : ''}
      </div>`;

    // Sorten
    const s = L.statistik(Z.hases), neu = Z.hases.slice().sort((a, b) => b.id - a.id).slice(0, 3);
    $('#start-sorten').innerHTML = `<div class="label rot-label">SORTEN</div>
      <div class="sorten-zahl"><span>${s.anzahl}</span>${s.anzahl === 1 ? 'Sorte' : 'Sorten'}</div>
      <p class="held-unter">${s.leer ? 'Noch keine Einträge.' : `Ø ${zahl(s.schnitt)} % THC · ${s.mitReview} mit Review`}</p>
      <div id="start-thc" class="start-grafik"></div>
      <button class="textlink" data-geh="statistik">Statistik</button>
      ${neu.length ? `<div class="label start-neu">NEU DABEI</div>
        <div class="liste-zeilen">${neu.map((h) => `<button class="zeile" data-hase="${h.id}"><span><b>${esc(h.name)}</b><small>${zahl(h.thc, 2)} % THC</small></span><span class="pfeil">→</span></button>`).join('')}</div>` : ''}`;
    const v = L.thcVerteilung(Z.hases, 2);
    if (v.length) saeulen($('#start-thc'), v.map((x) => x.name), [{ daten: v.map((x) => x.wert) }], (i) => `${v[i].name} % THC: ${v[i].wert} ${v[i].wert === 1 ? 'Sorte' : 'Sorten'}`, { labels: 6, schlicht: true, farbe: css('--line-strong') });
    else $('#start-thc').hidden = true;
  }
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-geh]'); if (g) { zeigeAnsicht(g.dataset.geh); if (g.dataset.ziel) { const z = document.getElementById(g.dataset.ziel); if (z) z.scrollIntoView(); } return; }
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
  $('#filter-auf').addEventListener('click', () => { $('#filterfeld').open = true; });
  $('#f-terpene').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    const t = b.dataset.t, l = Z.filter.terpene;
    Z.filter.terpene = l.includes(t) ? l.filter((x) => x !== t) : [...l, t];
    zeichneSorten();
  });
  for (const [id, feld] of [['#f-bestrahlt', 'bestrahlt'], ['#f-review', 'mitReview']]) {
    $(id).addEventListener('change', (e) => {
      const w = e.target.closest('wa-radio-group').value;
      Z.filter[feld] = !w ? null : w === 'ja';
      zeichneSorten();
    });
  }
  $('#filter-reset').addEventListener('click', () => {
    Z.filter = { name: '', thcMin: null, thcMax: null, terpene: [], bestrahlt: null, mitReview: null };
    for (const id of ['#such-name', '#f-thc-min', '#f-thc-max']) $(id).value = '';
    for (const id of ['#f-bestrahlt', '#f-review']) $(id).value = '';
    zeichneSorten();
  });
  $$('#tabelle th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    Z.sort = { k: th.dataset.sort, auf: Z.sort.k === th.dataset.sort ? !Z.sort.auf : th.dataset.sort !== 'thc' };
    zeichneSorten();
  }));
  $('#sorte-neu').addEventListener('click', () => formular(null));

  // ------------------------------------------------------------------ Blatt: Details, Formular
  function blatt(titel, html) { const d = $('#blatt'); d.label = titel; $('#blatt-inhalt').innerHTML = html; ikonen($('#blatt-inhalt')); d.open = true; }
  function blattZu() { $('#blatt').open = false; }
  $('#blatt').addEventListener('wa-after-hide', (e) => { if (e.target.id === 'blatt') $('#blatt-inhalt').innerHTML = ''; });

  function details(h) {
    if (!h) return;
    const reviews = gruppe().map((p) => {
      const r = h.reviews.find((x) => x.user_id === p), meins = p === ich();
      return `<div class="review${meins ? ' ich' : ''}" data-person="${p}">
        <div class="review-wer"><span>${esc(name(p)).toUpperCase()}</span>${meins ? `<button class="verlinkt" data-aktion="review">${r ? 'BEARBEITEN' : 'SCHREIBEN'}</button>` : ''}</div>
        <div class="review-text${r ? '' : ' leer'}">${r ? esc(r.text) : 'Noch kein Review.'}</div></div>`;
    }).join('');
    blatt(h.name, `<div class="detail-werte"><div><span>THC</span><b>${zahl(h.thc, 2)} %</b></div><div><span>BESTRAHLT</span><b>${h.bestrahlt ? 'Ja' : 'Nein'}</b></div></div>
      <label class="beschr">TERPENE</label>
      <div class="detail-terp">${L.terpenListe(h.terpene).map((t) => `<span class="etikett">${esc(t)}</span>`).join('') || '<span class="leise">–</span>'}</div>
      <div class="detail-orig">Originaleingabe: ${esc(h.terpene)}</div>
      <label class="beschr">REVIEWS</label>${reviews}
      <div class="knopfreihe"><button class="knopf" data-aktion="bearbeiten">BEARBEITEN</button><button class="knopf gefahr" data-aktion="loeschen">LÖSCHEN</button></div>`);
    const inhalt = $('#blatt-inhalt');
    inhalt.onclick = async (e) => {
      const a = e.target.closest('[data-aktion]'); if (!a) return;
      const art = a.dataset.aktion;
      if (art === 'bearbeiten') formular(h);
      if (art === 'loeschen') {
        if (!(await frage(`„${h.name}“ löschen?`, 'Auch alle Reviews dazu werden gelöscht. Das lässt sich nicht rückgängig machen.'))) return;
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
    blatt(neu ? 'Neuer Eintrag' : 'Eintrag bearbeiten', `<form id="hase-form">
      <label class="beschr">NAME</label><input class="eingabe" name="name" placeholder="z. B. Lava Cake" value="${neu ? '' : esc(h.name)}" autocomplete="off">
      <div class="zwei-felder"><div><label class="beschr">THC (%)</label><input class="eingabe" name="thc" inputmode="decimal" placeholder="z. B. 24,5" value="${neu ? '' : zahl(h.thc, 2).replace(/,?0+$/, '')}"></div>
      <div><wa-radio-group id="form-bestrahlt" label="Bestrahlt" orientation="horizontal" value="${!neu && h.bestrahlt ? 'ja' : 'nein'}"><wa-radio appearance="button" value="nein">Nein</wa-radio><wa-radio appearance="button" value="ja">Ja</wa-radio></wa-radio-group></div></div>
      <label class="beschr">TERPENE</label><input class="eingabe" name="terpene" placeholder="durch Komma getrennt, z. B. Myrcen, Limonen" value="${neu ? '' : esc(h.terpene)}" autocomplete="off">
      ${neu ? `<label class="beschr">DEIN REVIEW (OPTIONAL)</label><textarea class="eingabe" name="review" rows="3" placeholder="Wie war's?">${meinReview}</textarea>` : ''}
      <p class="fehler" id="form-fehler"></p>
      <div class="knopfreihe"><button class="knopf voll" type="submit">${neu ? 'HINZUFÜGEN' : 'SPEICHERN'}</button>${neu ? '' : '<button class="knopf" type="button" id="form-abbrechen">ABBRECHEN</button>'}</div></form>`);
    const form = $('#hase-form');
    if (!neu) $('#form-abbrechen').onclick = () => details(h);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const nameT = form.name.value.trim(), thcT = form.thc.value.trim().replace(',', '.'), terp = form.terpene.value.trim();
      if (!nameT || !thcT || !terp) { $('#form-fehler').textContent = 'Bitte fülle Name, THC und Terpene aus.'; return; }
      const thc = Number(thcT);
      if (!Number.isFinite(thc) || thc < 0 || thc > 100) { $('#form-fehler').textContent = 'Bitte gib einen THC-Wert zwischen 0 und 100 ein.'; form.thc.focus(); return; }
      const zeileH = { name: nameT, thc, terpene: terp, bestrahlt: $('#form-bestrahlt').value === 'ja' };
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
    if (v.length) saeulen($('#stat-verteilung'), v.map((x) => x.name), [{ daten: v.map((x) => x.wert) }], (i) => `${v[i].name} % THC: ${v[i].wert} ${v[i].wert === 1 ? 'Eintrag' : 'Einträge'}`);
    else $('#stat-verteilung').innerHTML = '<p class="leise">Noch keine Daten.</p>';
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
    const t30 = r.letzteTage(30), tag = (t) => `${t.datum.getDate()}.${t.datum.getMonth() + 1}.`;
    saeulen($('#smoke-30'), t30.map(tag), [{ daten: t30.map((t) => (t.anzahl > 0 ? t.anzahl : 0)) }],
      (i) => { const t = t30[i]; return `${WT[t.datum.getDay()].slice(0, 2)} ${tag(t)}: ${t.anzahl === null ? 'nicht eingetragen' : t.anzahl === 0 ? 'rauchfrei' : t.anzahl + '× geraucht'}`; }, { labels: 6 });
    const pw = r.proWochentag();
    saeulen($('#smoke-woche'), WT_KURZ, [{ daten: pw }], (i) => `${WT[(i + 1) % 7]}: ${pw[i]}× geraucht`);
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
      el.innerHTML = `<div class="box-kopf"><span>VERGLEICH</span></div><p class="leise">Erscheint, sobald weitere Personen etwas eintragen.</p>`;
      return;
    }
    const n = Z.vglTage;
    const v = L.vergleich(ps.map((p) => ({ id: p, name: name(p), tage: Z.tage[p] || {} })), n, L.heute());
    // Rangliste: Personen als Zeilen – funktioniert für beliebig viele Personen und jede Displaybreite
    const SP = [
      { k: 'serie', t: 'SERIE', w: v.serien, hoch: true, f: (x) => x },
      { k: 'frei', t: 'RAUCH&shy;FREI', w: v.rauchfrei, hoch: true, f: (x) => x },
      { k: 'geraucht', t: 'GE&shy;RAUCHT', w: v.summen, hoch: false, f: (x) => x + '×' },
    ];
    const best = (s) => { const z = s.hoch ? Math.max(...s.w) : Math.min(...s.w); const anz = s.w.filter((x) => x === z).length; return s.w.map((x) => x === z && anz < s.w.length); };
    const bester = SP.map(best);
    const sp = SP.find((s) => s.k === Z.vglSort) || SP[0];
    const reihe = ps.map((p, i) => i).sort((a, b) => (sp.hoch ? sp.w[b] - sp.w[a] : sp.w[a] - sp.w[b]) || v.serien[b] - v.serien[a] || name(ps[a]).localeCompare(name(ps[b]), 'de'));
    // Diagramme: ich + eine gewählte Person
    const andere = ps.filter((p) => p !== ich());
    if (!andere.includes(Z.vglMit)) Z.vglMit = andere[0];
    const zwei = [ich(), Z.vglMit], idx = zwei.map((p) => ps.indexOf(p));
    el.innerHTML = `<div class="box-kopf"><span>VERGLEICH</span><wa-radio-group id="vgl-n" label="Zeitraum" orientation="horizontal" value="${n}">${[7, 30, 90].map((x) => `<wa-radio appearance="button" value="${x}">${x} Tage</wa-radio>`).join('')}</wa-radio-group></div>
      <table class="vgl-tabelle rangliste"><thead><tr><th></th>${SP.map((s) => `<th><button data-vs="${s.k}" class="${s === sp ? 'aktiv' : ''}">${s.t}</button></th>`).join('')}</tr></thead><tbody>
      ${reihe.map((i, platz) => `<tr class="${ps[i] === ich() ? 'ich' : ''}"><td><span class="platz">${platz + 1}</span>${esc(name(ps[i]))}<small>${v.eingetragen[i]} / ${n} eingetragen</small></td>${SP.map((s, k) => `<td class="${bester[k][i] ? 'besser' : ''}">${s.f(s.w[i])}</td>`).join('')}</tr>`).join('')}
      </tbody></table>
      <div class="vgl-mit"><span class="beschr-inline">DU UND</span><div class="chips" id="vgl-mit">${andere.map((p) => `<button data-p="${esc(p)}" class="${p === Z.vglMit ? 'aktiv' : ''}">${esc(name(p))}</button>`).join('')}</div></div>
      <div class="raster zwei breit-links" style="margin-top:0">
        <div><div class="box-kopf"><span>PRO TAG</span><span class="leise">${zwei.map((p, i) => `<span class="punkt${i ? ' weiss' : ''}"></span>${esc(name(p))}`).join(' &nbsp; ')}</span></div><div id="vgl-tag"></div></div>
        <div><div class="box-kopf"><span>NACH WOCHENTAG</span></div><div id="vgl-woche"></div></div>
      </div>`;
    const wert = (t) => (t === null ? '–' : t === 0 ? 'rauchfrei' : t + '×');
    const tg = (t) => `${t.datum.getDate()}.${t.datum.getMonth() + 1}.`;
    saeulen($('#vgl-tag'), v.tage.map(tg), idx.map((j) => ({ daten: v.tage.map((t) => (t.werte[j] > 0 ? t.werte[j] : 0)) })),
      (i) => `${tg(v.tage[i])}: ` + zwei.map((p, k) => `${name(p)} ${wert(v.tage[i].werte[idx[k]])}`).join(', '), { labels: 6 });
    saeulen($('#vgl-woche'), WT_KURZ, idx.map((j) => ({ daten: v.wochentage[j] })),
      (i) => `${WT[(i + 1) % 7]}: ` + zwei.map((p, k) => `${name(p)} ${v.wochentage[idx[k]][i]}×`).join(', '));
    $('#vgl-n').addEventListener('change', (e) => { Z.vglTage = +e.target.closest('wa-radio-group').value; zeichneVergleich(); });
    el.querySelector('thead').onclick = (e) => { const b = e.target.closest('[data-vs]'); if (!b) return; Z.vglSort = b.dataset.vs; zeichneVergleich(); };
    $('#vgl-mit').onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; Z.vglMit = b.dataset.p; zeichneVergleich(); };
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
    blatt('Wie heißt du?', `<form id="name-form">
      <p class="hinweis">Erscheint bei Reviews, im Vergleich und bei deinen Orten.</p>
      <label class="beschr">NAME</label><input class="eingabe" name="n" maxlength="40" value="${esc(name(ich()))}" autocomplete="off">
      <div class="knopfreihe"><button class="knopf voll" type="submit">SPEICHERN</button></div></form>`);
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
