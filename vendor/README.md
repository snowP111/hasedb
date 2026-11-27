# vendor/ – fertige Bibliotheken (lokal, damit die App offline läuft)

| Ordner | Bibliothek | Version | Lizenz | Inhalt |
|---|---|---|---|---|
| `webawesome/` | Web Awesome | 3.15.0 | MIT | nur Theme, Loader und die genutzten Komponenten: dialog, drawer, switch, radio-group, radio, tooltip (+ button, icon) samt Abhängigkeiten |
| `lucide/` | Lucide | 1.78.0 | ISC | `lucide-auswahl.js`: nur die genutzten Icons (house, leaf, cigarette, map, x, arrow-left, locate, locate-fixed, sliders-horizontal, chevron-left, chevron-right) |
| `chartjs/` | Chart.js | 4.6.1 | MIT | `chart.umd.min.js` |

Quelle: die npm-Pakete `@awesome.me/webawesome`, `lucide`, `chart.js` (offizielle Registry).
Neue Web-Awesome-Komponente nötig? Den Ordner aus `dist-cdn/components/<name>/` samt der importierten `chunks/` ergänzen.
