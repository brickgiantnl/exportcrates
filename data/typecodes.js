// ============================================================================
// Export Crates — betekenis van de kisttype-codes + gewichtsklassen
// Bron: VDEP/Export Packing master-blad "Delen vurenhout / multiplex kisten".
// Dit beschrijft WAT een code betekent en de DRAAGVERMOGEN-klasse (kleuren).
// De exacte profielmaten per onderdeel staan (gevalideerd) in data/types.js.
// ============================================================================
window.TYPECODES = {
  // 1e letter = materiaal + soort klampen
  materiaal: {
    K: { naam: "Volledig vurenhout", multiplex: false, klamp: "vurenhout" },
    G: { naam: "Multiplex, geschaafde klampen", multiplex: true, klamp: "geschaafd 26×92 of 18×96 mm" },
    M: { naam: "Multiplex, multiplex-klampen", multiplex: true, klamp: "multiplex 16 mm" },
    P: { naam: "Multiplex, planken-klampen", multiplex: true, klamp: "planken 23×100 mm" },
  },
  // 2e letter = oriëntatie langsliggers
  orientatie: { S: "Langsliggers staand", L: "Langsliggers liggend (plat)" },
  // cijfers: 1e = langsligger, 2e = vloer, 3e = wanden
  cijfers: { 1: "langsligger-maat", 2: "vloerdikte", 3: "wanddikte" },

  // Gewichtsklassen (kleuren op het blad). Max-draagvermogen per klasse.
  // VOORLOPIGE koppeling van 1e cijfer (langsligger) → klasse; door Patrick te bevestigen.
  gewichtsklassen: [
    { label: "tot 100 kg",       max: 100,      kleur: "#8ec63f" },
    { label: "100 – 1000 kg",    max: 1000,     kleur: "#f4e8b0" },
    { label: "1000 – 2000 kg",   max: 2000,     kleur: "#f0a868" },
    { label: "2000 – 3000 kg",   max: 3000,     kleur: "#8fb8de" },
    { label: "boven 3000 kg",    max: Infinity, kleur: "#c9c9c9" },
  ],
  // 1e cijfer (langsligger) → index in gewichtsklassen  (VOORLOPIG)
  cijferNaarKlasse: { 0: 0, 1: 0, 2: 1, 3: 1, 4: 1, 5: 2, 6: 3, 7: 4 },

  // Dimensietabel uit het blad (breed×hoog in mm), ter referentie/controle.
  // (Geometrie die de app gebruikt komt uit data/types.js.)
  vurenhout: {
    // code: [langsligger, sleebalk, vloerdikte, wanddikte, dekseldikte]
    KS022: [null, null, "22×100", "22×100", "22×100"],
    KS122: [null, "50×100", "22×100", "22×100", "22×100"],
    KS222: ["100×22", "50×100", "22×100", "22×100", "22×100"],
    KS322: ["50×75", "100×100", "22×100", "22×100", "22×100"],
    KS332: ["50×75", "100×100", "32×200", "22×100", "22×100"],
    KS422: ["50×100", "100×100", "22×100", "22×100", "22×100"],
    KS432: ["50×100", "100×100", "32×200", "22×100", "22×100"],
    KS522: ["75×100", "100×100", "22×100", "22×100", "22×100"],
    KS532: ["75×100", "100×100", "32×200", "22×100", "22×100"],
    KS533: ["75×100", "100×100", "32×200", "32×200", "32×200"],
    KS622: ["100×150", "150×100", "22×100", "22×100", "22×100"],
    KS632: ["100×150", "150×100", "32×200", "22×100", "22×100"],
    KS633: ["100×150", "150×100", "32×200", "32×200", "32×200"],
    KS722: ["150×150", "150×100", "22×100", "22×100", "22×100"],
    KS732: ["150×150", "150×100", "32×200", "22×100", "22×100"],
    KS733: ["150×150", "150×100", "32×200", "32×200", "32×200"],
  },
  multiplex: {
    // code: [langsligger, sleebalk, vloerdikte, wanddikte, dekseldikte]  (plaat in mm)
    PS000: [null, null, "10", "10", "10"],
    PS010: [null, null, "16", "10", "10"],
    PS011: [null, null, "16", "16", "16"],
    PS100: [null, "50×100", "10", "10", "10"],
    PS110: [null, "50×100", "16", "10", "10"],
    PS111: [null, "50×100", "16", "16", "16"],
    PS200: ["100×22", "50×100", "10", "10", "10"],
    PS210: ["100×22", "50×100", "16", "10", "10"],
    PS211: ["100×22", "50×100", "16", "16", "16"],
    PS220: ["100×22", "50×100", "22×100", "10", "10"],
    PS221: ["100×22", "50×100", "22×100", "16", "16"],
    PS300: ["50×75", "100×100", "10", "10", "10"],
    PS310: ["50×75", "100×100", "16", "10", "10"],
    PS311: ["50×75", "100×100", "16", "16", "16"],
    PS320: ["50×75", "100×100", "22×100", "16", "16"],
    PS321: ["50×75", "100×100", "22×100", "16", "16"],
    PS331: ["50×75", "100×100", "32×200", "16", "16"],
    PS400: ["50×100", "100×100", "10", "10", "10"],
    PS410: ["50×100", "100×100", "16", "10", "10"],
    PS411: ["50×100", "100×100", "16", "16", "16"],
    PS420: ["50×100", "100×100", "22×100", "16", "16"],
    PS421: ["50×100", "100×100", "22×100", "16", "16"],
    PS431: ["50×100", "100×100", "32×200", "16", "16"],
    PS500: ["75×100", "100×100", "10", "10", "10"],
    PS510: ["75×100", "100×100", "16", "10", "10"],
    PS511: ["75×100", "100×100", "16", "16", "16"],
    PS520: ["75×100", "100×100", "22×100", "16", "16"],
    PS521: ["75×100", "100×100", "22×100", "16", "16"],
    PS531: ["75×100", "100×100", "32×200", "16", "16"],
    PS600: ["100×150", "150×100", "10", "10", "10"],
    PS610: ["100×150", "150×100", "16", "10", "10"],
    PS611: ["100×150", "150×100", "16", "16", "16"],
    PS620: ["100×150", "150×100", "22×100", "16", "16"],
    PS621: ["100×150", "150×100", "22×100", "16", "16"],
    PS631: ["100×150", "150×100", "32×200", "16", "16"],
  },
  // Aanvullende sleebalk-opmerkingen uit het blad:
  // PS000 t/m PS011: sleebalken 22×100 of 18×96   ·   PS100 t/m PS221: sleebalken plat
};
