/*! Lucide v1.78.0 – Auswahl für HaseDB (house, leaf, cigarette, map, x, arrow-left, locate, locate-fixed, sliders-horizontal, chevron-left, chevron-right). ISC-Lizenz, siehe LICENSE. */
(function () {
  var ICONS = {"house":[["path",{"d":"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"}],["path",{"d":"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"}]],"leaf":[["path",{"d":"M11 20a10 10 0 0010-10 25.9 25.9 0 00-1.04-7.281 1 1 0 00-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0011 20"}],["path",{"d":"M2 21a5 5 0 012.911-4.544C7.613 15.212 8.351 15.24 11 13"}]],"cigarette":[["path",{"d":"M17 12H3a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h14"}],["path",{"d":"M18 8c0-2.5-2-2.5-2-5"}],["path",{"d":"M21 16a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"}],["path",{"d":"M22 8c0-2.5-2-2.5-2-5"}],["path",{"d":"M7 12v4"}]],"map":[["path",{"d":"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"}],["path",{"d":"M15 5.764v15"}],["path",{"d":"M9 3.236v15"}]],"x":[["path",{"d":"M18 6 6 18"}],["path",{"d":"m6 6 12 12"}]],"arrow-left":[["path",{"d":"m12 19-7-7 7-7"}],["path",{"d":"M19 12H5"}]],"locate":[["line",{"x1":"2","x2":"5","y1":"12","y2":"12"}],["line",{"x1":"19","x2":"22","y1":"12","y2":"12"}],["line",{"x1":"12","x2":"12","y1":"2","y2":"5"}],["line",{"x1":"12","x2":"12","y1":"19","y2":"22"}],["circle",{"cx":"12","cy":"12","r":"7"}]],"locate-fixed":[["line",{"x1":"2","x2":"5","y1":"12","y2":"12"}],["line",{"x1":"19","x2":"22","y1":"12","y2":"12"}],["line",{"x1":"12","x2":"12","y1":"2","y2":"5"}],["line",{"x1":"12","x2":"12","y1":"19","y2":"22"}],["circle",{"cx":"12","cy":"12","r":"7"}],["circle",{"cx":"12","cy":"12","r":"3"}]],"sliders-horizontal":[["path",{"d":"M10 5H3"}],["path",{"d":"M12 19H3"}],["path",{"d":"M14 3v4"}],["path",{"d":"M16 17v4"}],["path",{"d":"M21 12h-9"}],["path",{"d":"M21 19h-5"}],["path",{"d":"M21 5h-7"}],["path",{"d":"M8 10v4"}],["path",{"d":"M8 12H3"}]],"chevron-left":[["path",{"d":"m15 18-6-6 6-6"}]],"chevron-right":[["path",{"d":"m9 18 6-6-6-6"}]]};
  var STANDARD = { xmlns: 'http://www.w3.org/2000/svg', width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  var NS = 'http://www.w3.org/2000/svg';
  function svg(name, attrs) {
    var knoten = ICONS[name]; if (!knoten) return null;
    var el = document.createElementNS(NS, 'svg'), a = Object.assign({}, STANDARD, attrs || {});
    for (var k in a) el.setAttribute(k, a[k]);
    el.setAttribute('aria-hidden', 'true'); el.setAttribute('class', 'lucide lucide-' + name);
    knoten.forEach(function (t) { var c = document.createElementNS(NS, t[0]); for (var k in t[1]) c.setAttribute(k, t[1][k]); el.appendChild(c); });
    return el;
  }
  function createIcons(opt) {
    var attrs = (opt && opt.attrs) || {}, wurzel = (opt && opt.root) || document;
    wurzel.querySelectorAll('[data-lucide]').forEach(function (i) {
      var s = svg(i.getAttribute('data-lucide'), attrs); if (!s) return;
      if (i.className && typeof i.className === 'string') s.setAttribute('class', s.getAttribute('class') + ' ' + i.className);
      i.replaceWith(s);
    });
  }
  window.lucide = { icons: ICONS, createIcons: createIcons, svg: svg };
})();
