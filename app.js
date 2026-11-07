/* HaseDB – Handy-Version
 * Smoke-Counter, neuer Eintrag, Liste mit Details und Review.
 * Die Daten liegen in Supabase – dieselben Tabellen wie in der Mac-App.
 */
"use strict";

const db = window.supabase.createClient(HASE_CONFIG.supabaseUrl, HASE_CONFIG.supabaseKey);

const zustand = {
  hases: [],          // Einträge aus "hases"
  tage: {},           // "2026-11-07" -> anzahl (0 = rauchfrei)
  monat: null,        // angezeigter Kalendermonat (Date, 1. des Monats)
  bestrahlt: false,   // Auswahl im Formular
};

const $ = (id) => document.getElementById(id);

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
  "August", "September", "Oktober", "November", "Dezember"];
const WOCHENTAGE = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

// =====================================================
// DATUM (immer lokale Zeit, nie UTC)
// =====================================================

function iso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function heute() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function plusTage(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function ausIso(text) {
  const [j, m, t] = text.split("-").map(Number);
  return new Date(j, m - 1, t);
}
function langesDatum(d) {
  return WOCHENTAGE[d.getDay()] + ", " + d.getDate() + ". " + MONATE[d.getMonth()];
}
function zahl(wert, stellen) {
  return Number(wert).toLocaleString("de-DE", { minimumFractionDigits: stellen, maximumFractionDigits: stellen });
}

// =====================================================
// STATISTIK (gleiche Regeln wie in der Mac-App)
// =====================================================

/** Rauchfreie Tage in Folge bis heute. Ist heute offen, zählt die Serie bis gestern. */
function aktuelleSerie() {
  const h = heute();
  const heuteWert = zustand.tage[iso(h)];
  if (heuteWert !== undefined && heuteWert > 0) return 0;
  let tag = heuteWert === undefined ? plusTage(h, -1) : h;
  let serie = 0;
  while (zustand.tage[iso(tag)] === 0) {
    serie++;
    tag = plusTage(tag, -1);
  }
  return serie;
}

function laengsteSerie() {
  const daten = Object.keys(zustand.tage).sort();
  let laengste = 0, aktuell = 0, vorher = null;
  for (const d of daten) {
    if (zustand.tage[d] === 0) {
      const folgetag = vorher !== null && iso(plusTage(ausIso(vorher), 1)) === d;
      aktuell = folgetag ? aktuell + 1 : 1;
      laengste = Math.max(laengste, aktuell);
      vorher = d;
    } else {
      aktuell = 0;
      vorher = null;
    }
  }
  return laengste;
}

/** "ß-Myrcen" -> "Myrcen", "Limonene" -> "Limonen" (wie model/Terpene.java) */
function normalisiereTerpen(t) {
  let name = t.trim().replace(/^(?:[αβßaAbBdDlL](?:-\d+)?-)+/, "").trim();
  if (!name) return "";
  if (name.toLowerCase().endsWith("ene")) name = name.slice(0, -1);
  const varianten = { caryopyllen: "Caryophyllen", mycren: "Myrcen" };
  const klein = name.toLowerCase();
  if (varianten[klein]) return varianten[klein];
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}
function terpenListe(text) {
  return [...new Set((text || "").split(/[,;/]/).map(normalisiereTerpen).filter(Boolean))];
}

// =====================================================
// DATEN LADEN / SPEICHERN
// =====================================================

async function ladeDaten() {
  const [hases, tage] = await Promise.all([
    db.from("hases").select("*").order("name", { ascending: true }),
    db.from("rauchtage").select("*"),
  ]);
  if (hases.error || tage.error) {
    zeigeHinweis("Laden fehlgeschlagen: " + (hases.error || tage.error).message, true);
    return;
  }
  zustand.hases = hases.data.sort((a, b) => a.name.localeCompare(b.name, "de", { sensitivity: "base" }));
  zustand.tage = {};
  for (const t of tage.data) zustand.tage[t.datum] = t.anzahl;
  zeigeAlles();
}

async function setzeTag(datum, anzahl) {
  const vorher = zustand.tage[datum];
  zustand.tage[datum] = Math.max(0, anzahl);   // sofort anzeigen
  zeigeSmoke();
  const { error } = await db.from("rauchtage").upsert({ datum, anzahl: Math.max(0, anzahl) }, { onConflict: "datum" });
  if (error) {
    if (vorher === undefined) delete zustand.tage[datum]; else zustand.tage[datum] = vorher;
    zeigeSmoke();
    zeigeHinweis("Nicht gespeichert: " + error.message, true);
  }
}

async function entferneTag(datum) {
  const vorher = zustand.tage[datum];
  delete zustand.tage[datum];
  zeigeSmoke();
  const { error } = await db.from("rauchtage").delete().eq("datum", datum);
  if (error) {
    zustand.tage[datum] = vorher;
    zeigeSmoke();
    zeigeHinweis("Nicht gelöscht: " + error.message, true);
  }
}

// =====================================================
// ANZEIGE: SMOKE-COUNTER
// =====================================================

function zeigeAlles() {
  zeigeSmoke();
  zeigeListe();
}

function zeigeSmoke() {
  const h = heute();
  const serie = aktuelleSerie();
  $("serie-zahl").textContent = serie;
  $("serie-text").textContent = (serie === 1 ? "TAG" : "TAGE") + " RAUCHFREI IN FOLGE";

  const heuteWert = zustand.tage[iso(h)];
  $("heute-status").textContent =
    heuteWert === undefined ? "Heute: noch nicht eingetragen"
      : heuteWert === 0 ? "Heute: rauchfrei ✓"
        : "Heute: " + heuteWert + "× geraucht";
  $("heute-rauchfrei").disabled = heuteWert === 0;
  $("heute-minus").disabled = !(heuteWert > 0);

  // Letzte 14 Tage
  const verlauf = $("verlauf");
  verlauf.innerHTML = "";
  for (let i = 13; i >= 0; i--) {
    const d = plusTage(h, -i);
    const wert = zustand.tage[iso(d)];
    const k = document.createElement("div");
    k.className = "mini " + (wert === undefined ? "offen" : wert === 0 ? "rauchfrei" : "geraucht");
    k.title = langesDatum(d) + ": " + (wert === undefined ? "nicht eingetragen" : wert === 0 ? "rauchfrei" : wert + "× geraucht");
    verlauf.appendChild(k);
  }

  // Kennzahlen
  $("kz-rekord").textContent = laengsteSerie() + " Tage";
  const praefix = iso(h).slice(0, 7);
  const imMonat = Object.entries(zustand.tage).filter(([d]) => d.startsWith(praefix));
  const frei = imMonat.filter(([, a]) => a === 0).length;
  const geraucht = imMonat.filter(([, a]) => a > 0).length;
  $("kz-monat").textContent = frei + " / " + geraucht;

  zeigeKalender();
}

function zeigeKalender() {
  const h = heute();
  if (!zustand.monat) zustand.monat = new Date(h.getFullYear(), h.getMonth(), 1);
  const m = zustand.monat;
  $("kal-monat").textContent = MONATE[m.getMonth()] + " " + m.getFullYear();
  $("kal-vor").disabled = m.getFullYear() === h.getFullYear() && m.getMonth() === h.getMonth();

  const kalender = $("kalender");
  kalender.innerHTML = "";
  const versatz = (m.getDay() + 6) % 7;     // Montag = 0
  const start = plusTage(m, -versatz);
  const wochen = Math.ceil((versatz + new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate()) / 7);

  for (let i = 0; i < wochen * 7; i++) {
    const d = plusTage(start, i);
    const schluessel = iso(d);
    const wert = zustand.tage[schluessel];
    const zukunft = d > h;

    const tag = document.createElement("button");
    tag.type = "button";
    tag.className = "tag";
    if (zukunft) tag.classList.add("zukunft");
    else if (wert === 0) tag.classList.add("rauchfrei");
    else if (wert > 0) tag.classList.add("geraucht");
    if (d.getMonth() !== m.getMonth()) tag.classList.add("fremd");
    if (schluessel === iso(h)) tag.classList.add("heute");
    tag.disabled = zukunft;

    tag.innerHTML = "<span>" + d.getDate() + "</span>" +
      (wert === 0 && !zukunft ? '<span class="anzahl">✓</span>' : wert > 0 ? '<span class="anzahl">' + wert + "×</span>" : "");
    tag.addEventListener("click", () => oeffneTag(schluessel));
    kalender.appendChild(tag);
  }
}

/** Blatt zum Eintragen eines bestimmten Tages. */
function oeffneTag(schluessel) {
  const d = ausIso(schluessel);

  const zeichne = () => {
    const wert = zustand.tage[schluessel];
    const status = wert === undefined ? '<span class="etikett">NICHT EINGETRAGEN</span>'
      : wert === 0 ? '<span class="etikett blau">RAUCHFREI</span>'
        : '<span class="etikett rot">' + wert + "× GERAUCHT</span>";
    $("blatt-inhalt").innerHTML = `
      <p class="blatt-name">${langesDatum(d)}${schluessel === iso(heute()) ? " (heute)" : ""}</p>
      <div>${status}</div>
      <p class="feld-titel">WIE OFT GERAUCHT?</p>
      <div class="zaehler">
        <button class="knopf" id="t-minus" type="button" ${!(wert > 0) ? "disabled" : ""}>−</button>
        <span class="wert">${wert === undefined ? "–" : wert}</span>
        <button class="knopf" id="t-plus" type="button">+</button>
      </div>
      <button class="knopf primaer breit" id="t-frei" type="button" ${wert === 0 ? "disabled" : ""}>Rauchfrei ✓</button>
      <button class="knopf gefahr" id="t-weg" type="button" ${wert === undefined ? "disabled" : ""}>Eintrag entfernen</button>`;
    $("t-plus").onclick = async () => { await setzeTag(schluessel, (zustand.tage[schluessel] || 0) + 1); zeichne(); };
    $("t-minus").onclick = async () => { await setzeTag(schluessel, Math.max(0, (zustand.tage[schluessel] || 0) - 1)); zeichne(); };
    $("t-frei").onclick = async () => { await setzeTag(schluessel, 0); zeichne(); };
    $("t-weg").onclick = async () => { await entferneTag(schluessel); zeichne(); };
  };

  oeffneBlatt("Tag eintragen");
  zeichne();
}

// =====================================================
// ANZEIGE: LISTE + DETAILS
// =====================================================

function zeigeListe() {
  const begriff = $("suche").value.trim().toLowerCase();
  const sichtbar = zustand.hases.filter((h) => h.name.toLowerCase().includes(begriff));
  $("liste-zaehler").textContent = sichtbar.length === zustand.hases.length
    ? zustand.hases.length + " EINTRÄGE"
    : sichtbar.length + " VON " + zustand.hases.length + " EINTRÄGEN";

  const liste = $("liste");
  liste.innerHTML = "";
  if (sichtbar.length === 0) {
    liste.innerHTML = '<p class="leer">' + (zustand.hases.length ? "Kein Eintrag passt zur Suche." : "Noch keine Einträge.") + "</p>";
    return;
  }
  for (const h of sichtbar) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "eintrag";
    b.innerHTML = `
      <span class="name"></span>
      <span class="info">${zahl(h.thc, 2)} % THC</span>
      <span class="rechts">${h.bestrahlt ? '<span class="etikett gelb">BESTR.</span>' : ""}${h.review && h.review.trim() ? "<strong>★</strong>" : ""}</span>`;
    b.querySelector(".name").textContent = h.name;
    b.addEventListener("click", () => oeffneDetails(h.id));
    liste.appendChild(b);
  }
}

function oeffneDetails(id) {
  const h = zustand.hases.find((x) => x.id === id);
  if (!h) return;
  oeffneBlatt("Details");

  const inhalt = $("blatt-inhalt");
  inhalt.innerHTML = `
    <p class="blatt-name"></p>
    <div class="werte">
      <div class="wert-karte blau"><span class="marke">THC</span><strong>${zahl(h.thc, 2)} %</strong></div>
      <div class="wert-karte ${h.bestrahlt ? "gelb" : ""}"><span class="marke">BESTRAHLT</span><strong>${h.bestrahlt ? "Ja" : "Nein"}</strong></div>
    </div>
    <p class="feld-titel">TERPENE</p>
    <div class="chips"></div>
    <label class="feld"><span class="feld-titel">REVIEW</span>
      <textarea id="d-review" rows="5" placeholder="Geschmack, Wirkung, Preis-Leistung …"></textarea></label>
    <button class="knopf primaer breit" id="d-speichern" type="button">Review speichern</button>`;
  inhalt.querySelector(".blatt-name").textContent = h.name;
  const chips = inhalt.querySelector(".chips");
  for (const t of terpenListe(h.terpene)) {
    const c = document.createElement("span");
    c.className = "etikett";
    c.textContent = t;
    chips.appendChild(c);
  }
  $("d-review").value = h.review || "";

  $("d-speichern").onclick = async () => {
    const review = $("d-review").value.trim();
    const { error } = await db.from("hases").update({ review }).eq("id", h.id);
    if (error) {
      zeigeHinweis("Nicht gespeichert: " + error.message, true);
      return;
    }
    h.review = review;
    zeigeListe();
    schliesseBlatt();
    zeigeHinweis("Review gespeichert ✓");
  };
}

// =====================================================
// NEUER EINTRAG
// =====================================================

async function speichereNeu(e) {
  e.preventDefault();
  const name = $("neu-name").value.trim();
  const thcText = $("neu-thc").value.trim().replace(",", ".");
  const terpene = $("neu-terpene").value.trim();
  const review = $("neu-review").value.trim();
  const thc = Number(thcText);

  if (!name || !thcText || !terpene) {
    $("neu-fehler").textContent = "Bitte fülle Name, THC und Terpene aus.";
    return;
  }
  if (!Number.isFinite(thc) || thc < 0 || thc > 100) {
    $("neu-fehler").textContent = "Bitte gib einen THC-Wert zwischen 0 und 100 ein.";
    return;
  }
  $("neu-fehler").textContent = "";

  const { error } = await db.from("hases").insert({ name, thc, terpene, bestrahlt: zustand.bestrahlt, review });
  if (error) {
    $("neu-fehler").textContent = "Nicht gespeichert: " + error.message;
    return;
  }
  $("neu-form").reset();
  waehleBestrahlt(false);
  zeigeHinweis("„" + name + "“ hinzugefügt ✓");
  await ladeDaten();
  wechsleSeite("liste");
}

function waehleBestrahlt(ja) {
  zustand.bestrahlt = ja;
  document.querySelectorAll(".segment").forEach((s) => s.classList.toggle("aktiv", (s.dataset.wert === "ja") === ja));
}

// =====================================================
// NAVIGATION, BLATT, HINWEIS
// =====================================================

function wechsleSeite(name) {
  for (const s of ["smoke", "neu", "liste"]) $("seite-" + s).hidden = s !== name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("aktiv", t.dataset.seite === name));
  window.scrollTo(0, 0);
}

function oeffneBlatt(titel) {
  $("blatt-titel").textContent = titel;
  $("blatt").hidden = false;
  $("blatt-hintergrund").hidden = false;
}
function schliesseBlatt() {
  $("blatt").hidden = true;
  $("blatt-hintergrund").hidden = true;
}

let hinweisTimer;
function zeigeHinweis(text, fehler = false) {
  const t = $("toast");
  t.textContent = text;
  t.classList.toggle("fehler-toast", fehler);
  t.hidden = false;
  clearTimeout(hinweisTimer);
  hinweisTimer = setTimeout(() => (t.hidden = true), fehler ? 5000 : 2200);
}

// =====================================================
// LOGIN & START
// =====================================================

function zeigeLogin(eingeloggt) {
  $("login").hidden = eingeloggt;
  $("app").hidden = !eingeloggt;
}

async function anmelden(e) {
  e.preventDefault();
  $("login-fehler").textContent = "";
  const { error } = await db.auth.signInWithPassword({
    email: $("login-email").value.trim(),
    password: $("login-passwort").value,
  });
  if (error) {
    $("login-fehler").textContent = error.message.includes("Invalid login") ? "E-Mail oder Passwort stimmt nicht." : error.message;
    return;
  }
  zeigeLogin(true);
  await ladeDaten();
}

async function start() {
  // Ereignisse
  $("login-form").addEventListener("submit", anmelden);
  $("neu-form").addEventListener("submit", speichereNeu);
  $("suche").addEventListener("input", zeigeListe);
  $("neu-laden").addEventListener("click", async () => { await ladeDaten(); zeigeHinweis("Aktualisiert ✓"); });
  $("blatt-zu").addEventListener("click", schliesseBlatt);
  $("blatt-hintergrund").addEventListener("click", schliesseBlatt);
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => wechsleSeite(t.dataset.seite)));
  document.querySelectorAll(".segment").forEach((s) => s.addEventListener("click", () => waehleBestrahlt(s.dataset.wert === "ja")));

  const h = heute();
  $("heute-rauchfrei").addEventListener("click", () => setzeTag(iso(heute()), 0));
  $("heute-plus").addEventListener("click", () => setzeTag(iso(heute()), (zustand.tage[iso(heute())] || 0) + 1));
  $("heute-minus").addEventListener("click", () => setzeTag(iso(heute()), Math.max(0, (zustand.tage[iso(heute())] || 0) - 1)));
  $("kal-zurueck").addEventListener("click", () => { zustand.monat = new Date(zustand.monat.getFullYear(), zustand.monat.getMonth() - 1, 1); zeigeKalender(); });
  $("kal-vor").addEventListener("click", () => { zustand.monat = new Date(zustand.monat.getFullYear(), zustand.monat.getMonth() + 1, 1); zeigeKalender(); });
  zustand.monat = new Date(h.getFullYear(), h.getMonth(), 1);

  // Beim Zurückkehren in die App neu laden (z. B. nach Einträgen am Mac)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !$("app").hidden) ladeDaten();
  });

  const { data } = await db.auth.getSession();
  zeigeLogin(Boolean(data.session));
  if (data.session) await ladeDaten();
}

start();
