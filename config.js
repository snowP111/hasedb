// Verbindung zu Supabase (Projekt „Hase Project“).
// Beide Werte sind öffentlich – geschützt werden die Daten durch den Login
// und die Zugriffsregeln (Row Level Security) in Supabase.
window.HASE_CONFIG = {
  supabaseUrl: "https://chszrsvyjjshpluljlzt.supabase.co",
  supabaseKey: "sb_publishable_9gs6XWNRmCqDfCAxrzYZdg_P9CakwGm",

  // Reiter KARTE
  karte: {
    muenchen: { s: 48.035, w: 11.335, n: 48.265, o: 11.745 },          // weiter raus geht die Karte nicht
    gebiet: { s: 48.128, w: 11.420, n: 48.188, o: 11.500 },            // Wegfinder: Pasing + Obermenzing
    start: { lat: 48.1497, lon: 11.4613, zoom: 14.6, pitch: 58, bearing: -18 },
    kartenstil: "https://tiles.openfreemap.org/styles/liberty",
    overpass: ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"],
  },
};
