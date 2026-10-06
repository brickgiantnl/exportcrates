"use strict";
/* ============================================================================
   Export Crates — rekenmotor voor exportkisten
   ----------------------------------------------------------------------------
   Data-gestuurde motor: leest per kisttype de profielen (breedte×dikte per
   onderdeel) uit de master-data (window.KIST_TYPES) en berekent uitwendige
   maat, M², M³, tarra (gewicht) en de volledige zaaglijst.

   De geometrie (offsets uL=iL+10 / uB=iB+10 / uH=iH+25, aantallen/lengtes en
   de opvulklos-regel) is EXACT gevalideerd tegen 4 GLS-rekenschermen voor type
   KS322. Voor andere types zijn dezelfde regels toegepast; die staan als
   "te valideren" gemarkeerd tot er een GLS-voorbeeld per constructie-familie is.

   Faithful port van de bewezen motor uit de kistcalc-module; hier als zelf-
   standige, serverloze bibliotheek (geen opslag, geen DOM).
   ========================================================================== */

const Engine = (() => {
  const ceil = Math.ceil, floor = Math.floor;
  const r1 = (v) => Math.round(v * 10) / 10;

  /* onderdeel-codes → naam (uit master-data, met fallback) */
  let NAMEN = {
    LL: "Langsliggers", OV: "Opvulklossen", SK: "Sleebalken", SP: "Sleeplanken",
    VD: "Vloerdelen", XK: "Klosplanken", ZD: "Zijdelen", ZH: "Zijklampen horz.",
    ZV: "Zijklampen vert.", KD: "Kopdelen", KH: "Kopklampen horz.",
    KV: "Kopklampen vert.", DD: "Dekseldelen", DK: "Dekselklampen",
    UH: "Uithouders", LS: "Lasstukken",
  };
  let VOLGORDE = ["LL","OV","SK","SP","VD","XK","ZD","ZH","ZV","KD","KH","KV","DD","DK","UH","LS"];
  const DELEN = ["VD", "ZD", "KD", "DD"];          // vlakken (bij multiplex = panelen)
  const VALIDATED = { KS322: true };               // bevestigde geometrie

  let TYPES = {};   // code -> {code, soort, familie, delen:{LL:{b,d},...}}

  /* Maten/toeslagen: 0 = automatisch afleiden uit de profielen van het type.
     Voor KS322 geeft dat 10 / 10 / 25 / 5 / 5 / 10 (exact conform GLS). */
  const MATEN_DEF = {
    toeslagL: 0, toeslagB: 0, toeslagH: 0,
    sleeOverstek: 0, zijklampOverlengte: 0, deelExtraHoogte: 0,
    kopdelenExtra: 1, sleebalkPer: 100, klosplankGrens: 200,
    derdeDekselklampGrens: 250, klampAfstand: 0,
  };
  const INST = {
    dichtheidVuren: 430,                           // kg/m³ (reproduceert GLS-tarra)
    materialen: [
      { id: "multiplex", naam: "Multiplex", dichtheid: 560, l: 244, b: 122 },
      { id: "osb",       naam: "OSB",       dichtheid: 620, l: 250, b: 125 },
    ],
    maten: Object.assign({}, MATEN_DEF),
  };

  const matVan = (k) => INST.materialen.find(m => m.id === (k && k.materiaal)) || INST.materialen[0];
  const isMultiplex = (t) => /MULTIPLEX/i.test(t.soort);
  const heeftDeel = (t, k) => t.delen[k] && (t.delen[k].b > 0 || t.delen[k].d > 0);
  const dim = (t, k) => (t.delen[k] ? { b: +t.delen[k].b || 0, d: +t.delen[k].d || 0 } : { b: 0, d: 0 });
  const fmt1 = (v) => (Math.round(v * 10) / 10);

  function profiel(t, k, matNaam) {
    const c = t.delen[k]; if (!c) return null;
    const paneel = DELEN.includes(k) && c.b === 0;
    const klasse = paneel ? "plaat"
      : (c.d >= 5 || (c.b >= 10 && c.d >= 7.5) ? "balk"
      : ((c.b >= 15 || c.d >= 7.5) ? "hout" : "plaat"));
    return { b: c.b, d: c.d, paneel, klasse,
      oms: paneel ? `${matNaam || "Plaat"} ${fmt1(c.d)} cm` : `${fmt1(c.b)}×${fmt1(c.d)} cm` };
  }

  /* ---- sleebalk-posities (auto; handmatige overrides optioneel via kist) ---- */
  function sleebalkPosities(k, t, uL, iL, M) {
    const w = dim(t, "SK").b || dim(t, "SP").b || 10;
    const autoN = floor(iL / (M.sleebalkPer || 100)) + 1;
    const randAuto = r1(M.toeslagL / 2 + (dim(t, "XK").b || dim(t, "VD").b || 10));
    const randHand = k.sbRand != null && k.sbRand !== "" && !isNaN(+k.sbRand);
    const rand = randHand ? Math.max(0, +k.sbRand) : randAuto;
    let n = k.sbAantal > 0 ? Math.round(+k.sbAantal) : autoN, pos, bron = "auto";
    if (Array.isArray(k.sbPos) && k.sbPos.length) {
      pos = k.sbPos.map(Number).filter(v => !isNaN(v)).sort((a, b) => a - b); n = pos.length; bron = "posities";
    } else if (k.sbHoh > 0 && n > 1) {
      pos = Array.from({ length: n }, (_, i) => rand + w / 2 + i * +k.sbHoh); bron = "hoh";
    } else {
      const span = uL - 2 * rand - w;
      pos = n <= 1 ? [uL / 2] : Array.from({ length: n }, (_, i) => rand + w / 2 + i * span / (n - 1));
      if (k.sbAantal > 0 || randHand) bron = "verdeeld";
    }
    pos = pos.map(r1);
    let hijs = [];
    if (Array.isArray(k.hpPos) && k.hpPos.length) hijs = k.hpPos.map(Number).filter(v => !isNaN(v)).sort((a, b) => a - b);
    else if (k.hpAantal > 0) {
      const nh = Math.round(+k.hpAantal), hr = k.hpRand > 0 ? +k.hpRand : r1(uL / 4);
      hijs = nh <= 1 ? [uL / 2] : Array.from({ length: nh }, (_, i) => hr + i * (uL - 2 * hr) / (nh - 1));
    }
    hijs = hijs.map(r1);
    const regulier = pos.filter(p => !hijs.some(h => Math.abs(p - h) < 1.5 * w - 0.01));
    const units = [...regulier.map(x => ({ x, hijs: false, w })), ...hijs.map(x => ({ x, hijs: true, w: 2 * w }))].sort((a, b) => a.x - b.x);
    const balken = units.flatMap(u => u.hijs
      ? [{ x: r1(u.x - w / 2), hijs: true }, { x: r1(u.x + w / 2), hijs: true }]
      : [{ x: u.x, hijs: false }]);
    pos = units.map(u => u.x);
    const hoh = pos.slice(1).map((p, i) => r1(p - pos[i]));
    const fouten = [];
    if (units.some(u => u.x - u.w / 2 < -0.01 || u.x + u.w / 2 > uL + 0.01))
      fouten.push(units.some(u => u.hijs && (u.x - u.w / 2 < -0.01 || u.x + u.w / 2 > uL + 0.01))
        ? "Een hijspunt valt buiten de kist." : "Een sleebalk valt buiten de kist.");
    if (units.some((u, i) => i > 0 && u.x - u.w / 2 < units[i - 1].x + units[i - 1].w / 2 - 0.01))
      fouten.push("Sleebalken / hijspunten overlappen elkaar.");
    return { n: balken.length, w, pos, units, balken, hijs, hoh, rand, randAuto, randHand, autoN, bron, fouten };
  }

  /* ---- maten/toeslagen zoals ze voor dit type gelden (auto of ingesteld) ---- */
  function effectieveMaten(t) {
    const M = INST.maten, d = (key) => (heeftDeel(t, key) ? dim(t, key).d : 0), mp = isMultiplex(t);
    const kopKlamp = Math.max(d("KH"), d("KV")), zijKlamp = Math.max(d("ZH"), d("ZV"));
    const toeslagB = M.toeslagB > 0 ? M.toeslagB : r1(2 * (d("ZD") + zijKlamp));
    return Object.assign({}, M, {
      toeslagL: M.toeslagL > 0 ? M.toeslagL : r1(2 * (d("KD") + kopKlamp)),
      toeslagB,
      toeslagH: M.toeslagH > 0 ? M.toeslagH : r1(d("SP") + d("SK") + d("LL") + d("VD") + d("DD") + d("DK")),
      sleeOverstek: M.sleeOverstek > 0 ? M.sleeOverstek : (mp ? toeslagB : r1(2 * d("ZD"))),
      zijklampOverlengte: M.zijklampOverlengte > 0 ? M.zijklampOverlengte : (mp ? 0 : r1(2 * d("KD"))),
      deelExtraHoogte: M.deelExtraHoogte > 0 ? M.deelExtraHoogte : r1(d("LL") + d("VD")),
    });
  }

  function paneelStukken(L, H, pl, pb) {
    const a = { nV: ceil(L / pl - 1e-9), nH: ceil(H / pb - 1e-9) };
    const b = { nV: ceil(L / pb - 1e-9), nH: ceil(H / pl - 1e-9) };
    const k = (a.nV * a.nH <= b.nV * b.nH) ? a : b;
    return { nV: k.nV, nH: k.nH, w: L / k.nV, h: H / k.nH, L, H };
  }

  function berekenKist(code, k) {
    const t = TYPES[code]; if (!t) return null;
    const M = effectieveMaten(t), iL = +k.il, iB = +k.ib, iH = +k.ih;
    const mp = isMultiplex(t), mat = matVan(k), P = { l: mat.l || 244, b: mat.b || 122 };
    const uL = iL + M.toeslagL, uB = iB + M.toeslagB, uH = iH + M.toeslagH;
    const sbi = sleebalkPosities(k, t, uL, iL, M), sb = sbi.n;
    const klosRijen = 2 + ((k.uitvullen && sb >= 3) ? sb : 0);
    const bw = (key, def) => (t.delen[key] && t.delen[key].b > 0) ? t.delen[key].b : def;
    const llB = dim(t, "LL").b || 5;
    const rows = [];
    const add = (key, aantal, lengte, breedte) => {
      if (!heeftDeel(t, key) || aantal <= 0) return;
      const p = profiel(t, key, mat.naam);
      if (p.paneel) rows.push({ key, naam: NAMEN[key] || key, aantal, lengte: r1(Math.max(lengte, breedte)), b: r1(Math.min(lengte, breedte)), dk: p.d, paneel: true, klasse: "plaat", oms: p.oms, cat: "plaat", mat: mat.naam, matId: mat.id, rho: mat.dichtheid });
      else rows.push({ key, naam: NAMEN[key] || key, aantal, lengte: r1(lengte), b: p.b, dk: p.d, paneel: false, klasse: p.klasse, oms: p.oms, cat: "hout" });
    };
    const stukken = {};
    const deel = (key, boardAantal, boardLengte, vlakA, vlakB, vlakken) => {
      if (!heeftDeel(t, key)) return null;
      if (t.delen[key].b > 0) { add(key, boardAantal, boardLengte); return null; }
      const st = paneelStukken(vlakA, vlakB, P.l, P.b); stukken[key] = st;
      add(key, (vlakken || 1) * st.nV * st.nH, st.w, st.h);
      return st;
    };
    const las = (naam, st, vlakken, lenStaand, lenLiggend) => {
      if (!st || !heeftDeel(t, "LS")) return;
      const p = profiel(t, "LS", mat.naam);
      const push = (n, lengte, oms) => { if (n > 0) rows.push({ key: "LS", naam: `Lasstukken ${naam} ${oms}`, aantal: n, lengte: r1(lengte), b: p.b, dk: p.d, paneel: false, klasse: "plaat", oms: `${mat.naam} ${fmt1(p.d)} cm, ${fmt1(p.b)} breed`, cat: "plaat", mat: mat.naam, matId: mat.id, rho: mat.dichtheid }); };
      push(vlakken * (st.nV - 1), lenStaand, "staand"); push(vlakken * (st.nH - 1), lenLiggend, "liggend");
    };
    const hw = iH + M.deelExtraHoogte;              // hoogte zij- en kopdelen
    // frame
    add("LL", 4, iL);
    add("OV", 3 * klosRijen, (iB - 4 * llB) / 3);
    add("SK", sb, iB + M.sleeOverstek);
    add("SP", sb, iB + M.sleeOverstek);
    add("XK", iL >= M.klosplankGrens ? 2 : 0, iB);
    // vloer
    deel("VD", ceil(iL / bw("VD", 10)), iB, iL, iB, 1);
    // wanden
    const zhB = dim(t, "ZH").b, khB = dim(t, "KH").b;
    add("ZH", mp ? 2 : 4, iL + M.zijklampOverlengte);
    add("ZV", mp ? 4 : (heeftDeel(t, "ZV") && !heeftDeel(t, "ZH") ? 4 : 0), mp ? hw - zhB : hw);
    add("KH", mp ? 2 : 4, uB);
    add("KV", !mp && heeftDeel(t, "KV") && !heeftDeel(t, "KH") ? 4 : 0, hw);
    const kdL = mp ? uB : iB + 2 * dim(t, "ZD").d;
    las("zijdelen", deel("ZD", 2 * ceil(iL / bw("ZD", 10)), hw, iL, hw, 2), 2, hw - zhB, iL);
    las("kopdelen", deel("KD", 2 * ceil(iB / bw("KD", 10)) + M.kopdelenExtra, hw, kdL, hw, 2), 2, hw - khB, kdL);
    // deksel
    const nDK = heeftDeel(t, "DK") ? (uL <= M.derdeDekselklampGrens ? 2 : 3) : 0;
    las("deksel", deel("DD", ceil(uL / bw("DD", 10)), uB, uL, uB, 1), 1, uB, uL);
    add("DK", nDK, uL);
    // extra
    add("UH", k.uithouders ? 2 * sb : 0, iB);

    const res = { code, type: t, uL, uB, uH, hw, sb: sbi, klosRijen, nDK, delen: rows, stukken, M, mat, mp, fouten: sbi.fouten.slice() };
    res.kpi = kpiVan(t, res);
    return res;
  }

  function kpiVan(t, res) {
    const L = ceil(res.uL - 1e-9) / 100, B = ceil(res.uB - 1e-9) / 100, H = ceil(res.uH - 1e-9) / 100;
    const M3 = L * B * H, M2 = 2 * (L * B + L * H + B * H);
    let tarra = 0;
    res.delen.forEach(d => { tarra += d.aantal * d.lengte * d.b * (d.dk || 0) / 1e6 * (d.cat === "plaat" ? (d.rho || 560) : INST.dichtheidVuren); });
    return { M2, M3, tarra };
  }

  /* zaaglijst van één kist, gegroepeerd op onderdeel+maat (aantal opgeteld) */
  function zaaglijst(res) {
    const map = new Map();
    res.delen.forEach(d => {
      const key = [d.key, d.naam, d.matId || "", r1(d.lengte), r1(d.b), r1(d.dk)].join("|");
      if (!map.has(key)) map.set(key, Object.assign({}, d, { aantal: 0 }));
      map.get(key).aantal += d.aantal;
    });
    const ord = (x) => { const i = VOLGORDE.indexOf(x.key); return i < 0 ? 99 : i; };
    return [...map.values()].sort((a, b) => ord(a) - ord(b) || b.lengte - a.lengte);
  }

  function init(raw) {
    if (!raw) return;
    if (raw.namen) NAMEN = Object.assign({}, NAMEN, raw.namen);
    if (Array.isArray(raw.volgorde) && raw.volgorde.length) VOLGORDE = raw.volgorde.slice();
    TYPES = {};
    (raw.types || []).forEach(t => { TYPES[t.code] = t; });
    return TYPES;
  }

  const typeLijst = () => Object.values(TYPES);
  const isValidated = (code) => !!VALIDATED[code];

  return { init, berekenKist, zaaglijst, typeLijst, isValidated, TYPES: () => TYPES, NAMEN: () => NAMEN, INST, isMultiplexCode: (c) => TYPES[c] ? isMultiplex(TYPES[c]) : false };
})();

if (typeof window !== "undefined") window.Engine = Engine;
