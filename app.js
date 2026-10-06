"use strict";
/* ============================================================================
   Export Crates — adviseur-wizard (product → kist-advies)
   ----------------------------------------------------------------------------
   Stap 1 product (+tekening) · stap 2 bestemming/vracht · stap 3 advies:
   kisttype-voorstel, uitwendige maat, gewicht, tekening, kostprijs, alternatieven.

   LET OP: de keuzeregels hieronder (CONFIG) zijn een EERSTE VOORZET. Ze zijn
   bedoeld om te corrigeren: speling rond het product, welke familie bij welk
   gewicht/vracht, en de kostprijs-tarieven. Pas ze aan tot ze kloppen.
   ========================================================================== */
const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => (v == null || isNaN(v)) ? "—"
  : Number(v).toLocaleString("nl-NL", { minimumFractionDigits: d, maximumFractionDigits: d });
const euro = (v) => "€ " + fmt(v, 2);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------- VOORLOPIGE VAKREGELS (corrigeerbaar) ---------------- */
const CONFIG = {
  // speling rond het product → binnenmaat kist (cm per kant)
  spelingZij: 5,        // links/rechts en voor/achter
  spelingTop: 7,        // boven het product
  spelingZee: 2,        // extra speling bij zeevracht (vocht/dunnage), per kant
  // standaard familie (2-letter prefix) per vrachtsoort (eerste voorzet)
  famZee: "KS",     // zeevracht → volledig vurenhout (sterk, ISPM-15)
  famLucht: "PS",   // luchtvracht → multiplex (lichter)
  // kostprijs-tarieven
  prijsHoutM3: 350,     // € per m³ vurenhout
  prijsPlaatM3: 650,    // € per m³ plaatmateriaal (multiplex/osb)
  uurBasis: 0.6,        // vaste opbouwtijd per kist (uur)
  uurPerM2: 0.12,       // extra uur per m² uitwendig oppervlak
  uurtarief: 48,        // € per uur
  marge: 20,            // % marge op kostprijs
  volumeFactorLucht: 167, // kg per m³ (IATA 1:6000) voor volumegewicht
};

/* ---------------- TYPECODE-DECODE (uit data/typecodes.js) ---------------- */
const TC = window.TYPECODES || {};
function decode(code) {
  // basisdeel = 2 letters + 3 cijfers; eventuele achtervoegsels (varianten) negeren
  const m = /^([KPMG])([SL])(\d)(\d)(\d)(.*)$/.exec(code || "");
  if (!m) return null;
  return { mat: m[1], ori: m[2], dLL: +m[3], dVL: +m[4], dWD: +m[5], suffix: m[6] || "", prefix: m[1] + m[2] };
}
function famLabel(prefix) {
  const d = decode(prefix + "000"); if (!d) return prefix;
  const mat = (TC.materiaal && TC.materiaal[d.mat]) || { naam: prefix };
  return `${prefix} · ${mat.naam}`;
}
function famReden(prefix) {
  const d = decode(prefix + "000"); if (!d) return "";
  const mat = (TC.materiaal && TC.materiaal[d.mat]) || {};
  const ori = (TC.orientatie && TC.orientatie[d.ori]) || "";
  return `${mat.naam || ""}${mat.klamp ? " (klampen " + mat.klamp + ")" : ""} · ${ori.toLowerCase()}`;
}
// gewichtsklasse-index die bij dit draaggewicht past (VOORLOPIG)
function klasseVoorGewicht(g) {
  const kl = TC.gewichtsklassen || [];
  for (let i = 0; i < kl.length; i++) if (g <= kl[i].max) return i;
  return kl.length - 1;
}
// 1e cijfer (langsligger) dat minstens deze klasse haalt (VOORLOPIG, uit cijferNaarKlasse)
function cijferVoorKlasse(klasse) {
  const map = TC.cijferNaarKlasse || { 0: 0, 1: 0, 2: 1, 3: 1, 4: 1, 5: 2, 6: 3, 7: 4 };
  let best = 7;
  Object.keys(map).map(Number).sort((a, b) => a - b).forEach(c => {
    if (map[c] >= klasse && c < best) best = c;
  });
  return best;
}
function klasseVanCode(code) {
  const d = decode(code); if (!d) return 0;
  const map = TC.cijferNaarKlasse || {};
  return map[d.dLL] != null ? map[d.dLL] : 0;
}
function klasseLabel(i) { return (TC.gewichtsklassen && TC.gewichtsklassen[i]) ? TC.gewichtsklassen[i].label : "—"; }

/* ---------------- STATE ---------------- */
Engine.init(window.KIST_TYPES || {});
const state = {
  stap: 1,
  product: { l: 120, b: 80, h: 90, gewicht: 350, aantal: 1, oms: "", tekening: null, tekeningNaam: "" },
  bestemming: "", vracht: "zee",
  gekozenType: null,       // handmatige override kisttype
  gekozenFam: null,        // handmatige override familie (2-letter prefix)
};

/* ============================ STAP-NAVIGATIE ============================ */
function toonStap(n) {
  state.stap = n;
  [1, 2, 3].forEach(s => $("stap-" + s).classList.toggle("hidden", s !== n));
  document.querySelectorAll("#stepper li").forEach(li => {
    const s = +li.dataset.step;
    li.classList.toggle("actief", s === n);
    li.classList.toggle("klaar", s < n);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (n === 3) renderAdvies();
}

function leesStap1() {
  state.product.l = +$("p-l").value; state.product.b = +$("p-b").value; state.product.h = +$("p-h").value;
  state.product.gewicht = +$("p-gewicht").value || 0;
  state.product.aantal = Math.max(1, parseInt($("p-aantal").value, 10) || 1);
  state.product.oms = $("p-oms").value.trim();
}
function leesStap2() {
  state.bestemming = $("b-bestemming").value.trim();
  const r = document.querySelector('input[name="vracht"]:checked');
  state.vracht = r ? r.value : "zee";
}

/* ============================ TEKENING UPLOAD ============================ */
function wireUpload() {
  const zone = $("upload-zone"), inp = $("f-tekening");
  $("btn-kies").addEventListener("click", () => inp.click());
  inp.addEventListener("change", () => { if (inp.files[0]) laadTekening(inp.files[0]); });
  ["dragover", "dragenter"].forEach(e => zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.add("over"); }));
  ["dragleave", "drop"].forEach(e => zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.remove("over"); }));
  zone.addEventListener("drop", ev => { const f = ev.dataTransfer.files[0]; if (f) laadTekening(f); });
  $("btn-verwijder-tek").addEventListener("click", () => {
    state.product.tekening = null; state.product.tekeningNaam = "";
    $("upload-preview").classList.add("hidden"); $("upload-leeg").classList.remove("hidden");
  });
}
function laadTekening(file) {
  state.product.tekeningNaam = file.name;
  if (file.type === "application/pdf") {
    state.product.tekening = null;
    $("tekening-img").src = ""; $("tekening-img").classList.add("hidden");
  } else {
    const reader = new FileReader();
    reader.onload = () => { state.product.tekening = reader.result; $("tekening-img").src = reader.result; $("tekening-img").classList.remove("hidden"); };
    reader.readAsDataURL(file);
  }
  $("tekening-naam").textContent = file.name;
  $("upload-leeg").classList.add("hidden"); $("upload-preview").classList.remove("hidden");
}

/* ============================ BINNENMAAT + KEUZE ============================ */
function binnenmaat() {
  const p = state.product;
  const extra = state.vracht === "zee" ? CONFIG.spelingZee : 0;
  const zij = CONFIG.spelingZij + extra, top = CONFIG.spelingTop + extra;
  return { il: p.l + 2 * zij, ib: p.b + 2 * zij, ih: p.h + top + extra };
}
// aanwezige families (2-letter prefix) in de data
function families() {
  const set = new Set();
  Engine.typeLijst().forEach(t => { const d = decode(t.code); if (d) set.add(d.prefix); });
  return [...set].sort();
}
// standaard-familie volgens vrachtsoort (voorzet), terugvallend op wat aanwezig is
function standaardFam() {
  const wens = state.vracht === "zee" ? CONFIG.famZee : CONFIG.famLucht;
  const aanwezig = families();
  return aanwezig.includes(wens) ? wens : aanwezig[0];
}
function kistVoor(code) {
  const bm = binnenmaat();
  return Engine.berekenKist(code, {
    il: bm.il, ib: bm.ib, ih: bm.ih, aantal: state.product.aantal,
    uithouders: false, uitvullen: false, materiaal: "multiplex",
  });
}
// alle types binnen een familie (prefix), met berekening + kostprijs + klasse
function kandidaten(prefix) {
  return Engine.typeLijst()
    .filter(t => t.code.slice(0, 2) === prefix)
    .map(t => {
      const res = kistVoor(t.code);
      return res ? { code: t.code, res, kost: kostprijs(res), klasse: klasseVanCode(t.code), dec: decode(t.code) } : null;
    })
    .filter(Boolean);
}
// kies binnen de familie het aanbevolen type: het standaard-basistype dat de
// benodigde gewichtsklasse haalt — langsligger-cijfer dichtbij wat nodig is,
// en zo min mogelijk over-gedimensioneerd in vloer/wand; anders het zwaarste.
function kiesAanbevolen(cands, nodigKlasse) {
  const nodigCijfer = cijferVoorKlasse(nodigKlasse);
  const geschikt = cands.filter(c => c.klasse >= nodigKlasse);
  const pool = geschikt.length ? geschikt : cands.slice();
  pool.sort((a, b) => {
    const da = Math.abs(a.dec.dLL - nodigCijfer), db = Math.abs(b.dec.dLL - nodigCijfer);
    if (da !== db) return da - db;                               // dichtst bij benodigde langsligger
    const ra = a.dec.dVL + a.dec.dWD, rb = b.dec.dVL + b.dec.dWD;
    if (ra !== rb) return ra - rb;                               // minst over-gedimensioneerd (vloer+wand)
    return a.res.kpi.tarra - b.res.kpi.tarra;                    // dan het lichtste
  });
  return { aanbevolen: pool[0], geschiktAanwezig: geschikt.length > 0 };
}

/* ============================ KOSTPRIJS ============================ */
function kostprijs(res) {
  let houtM3 = 0, plaatM3 = 0;
  res.delen.forEach(d => {
    const v = d.aantal * d.lengte * d.b * (d.dk || 0) / 1e6;  // m³
    if (d.cat === "plaat") plaatM3 += v; else houtM3 += v;
  });
  const materiaal = houtM3 * CONFIG.prijsHoutM3 + plaatM3 * CONFIG.prijsPlaatM3;
  const uren = CONFIG.uurBasis + CONFIG.uurPerM2 * res.kpi.M2;
  const arbeid = uren * CONFIG.uurtarief;
  const kost = materiaal + arbeid;
  const verkoop = kost * (1 + CONFIG.marge / 100);
  return { houtM3, plaatM3, materiaal, uren, arbeid, kost, verkoop };
}

/* ============================ TEKENING KIST (SVG) ============================ */
// Maatlijn-helpers (lijn met eind-streepjes + label op witte achtergrond)
function dimH(x1, x2, y, label) {
  const t = 4, mx = (x1 + x2) / 2;
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" class="tk-dim"/>
    <line x1="${x1}" y1="${y - t}" x2="${x1}" y2="${y + t}" class="tk-dim"/>
    <line x1="${x2}" y1="${y - t}" x2="${x2}" y2="${y + t}" class="tk-dim"/>
    <rect x="${mx - 20}" y="${y - 8}" width="40" height="11" class="tk-dimbg"/>
    <text x="${mx}" y="${y}" class="tk-dimtext" text-anchor="middle">${label}</text>`;
}
function dimV(y1, y2, x, label) {
  const t = 4, my = (y1 + y2) / 2;
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" class="tk-dim"/>
    <line x1="${x - t}" y1="${y1}" x2="${x + t}" y2="${y1}" class="tk-dim"/>
    <line x1="${x - t}" y1="${y2}" x2="${x + t}" y2="${y2}" class="tk-dim"/>
    <text x="${x}" y="${my}" class="tk-dimtext" text-anchor="middle" transform="rotate(-90 ${x} ${my})">${label}</text>`;
}

function tekenKist(res) {
  const p = state.product;
  const uL = res.uL, uB = res.uB, uH = res.uH;
  const sbPos = (res.sb && res.sb.pos && res.sb.pos.length) ? res.sb.pos : [uL / 2];
  const sbW = (res.sb && res.sb.w) ? res.sb.w : 10;
  const skidH = Math.max(uH * 0.07, 6);            // visuele skid/onderstel-hoogte (cm)
  const nLL = 4;                                    // langsliggers

  /* ---------- orthografische weergave ---------- */
  const ortho = (titel, w, h, binnen, opts) => {
    opts = opts || {};
    const target = 215, pad = 38, s = target / Math.max(w, h);
    const W = w * s + pad * 2, H = h * s + pad * 2, ox = pad, oy = pad;
    const X = cm => ox + cm * s, Y = cm => oy + cm * s;        // vanaf linksboven kist
    const YB = cm => oy + h * s - cm * s;                       // vanaf onderkant kist
    let extra = opts.draw ? opts.draw({ X, Y, YB, s, ox, oy, w, h }) : "";
    // product (gestreept); bij aanzichten op de bodem, bovenaanzicht gecentreerd
    const iw = binnen.w * s, ih = binnen.h * s;
    const ix = ox + (w * s - iw) / 2;
    const iy = binnen.opBodem ? (oy + h * s - ih - (opts.vloerCm || 0) * s) : (oy + (h * s - ih) / 2);
    const prod = `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" class="tk-prod" rx="1"/>
      <text x="${ix + iw / 2}" y="${iy + ih / 2}" class="tk-prodtxt">product</text>`;
    return `<figure class="tek-fig"><svg viewBox="0 0 ${W} ${H}" class="tek-svg" preserveAspectRatio="xMidYMid meet">
      <rect x="${ox}" y="${oy}" width="${w * s}" height="${h * s}" class="tk-kist"/>
      ${extra}${prod}
      ${dimH(ox, ox + w * s, oy + h * s + 20, fmt(w) + " cm")}
      ${dimV(oy, oy + h * s, ox - 18, fmt(h) + " cm")}
    </svg><figcaption>${titel}</figcaption></figure>`;
  };

  // bovenaanzicht (bodem/onderstel): langsliggers (lengte) + sleebalken (dwars)
  const boven = ortho("Bovenaanzicht — bodem", uL, uB, { w: p.l, h: p.b, opBodem: false }, {
    draw: ({ X, Y, s }) => {
      let g = "";
      for (let i = 0; i < nLL; i++) {               // 4 langsliggers over de breedte
        const yc = uB * (i + 0.5) / nLL, hh = Math.max(2.5 * s, 3);
        g += `<rect x="${X(0)}" y="${Y(yc) - hh / 2}" width="${uL * s}" height="${hh}" class="tk-ll"/>`;
      }
      sbPos.forEach(x => {                           // sleebalken dwars (volle breedte)
        g += `<rect x="${X(x - sbW / 2)}" y="${Y(0)}" width="${sbW * s}" height="${uB * s}" class="tk-sb2"/>`;
      });
      return g;
    }
  });

  // zijaanzicht (lengte × hoogte): wand met klampen + onderstel + skids
  const zij = ortho("Zijaanzicht", uL, uH, { w: p.l, h: p.h, opBodem: true, }, {
    vloerCm: skidH,
    draw: ({ X, Y, YB, s, ox, oy }) => {
      let g = wandKlampen(ox, oy, uL * s, uH * s, 3);
      g += `<rect x="${X(0)}" y="${YB(skidH)}" width="${uL * s}" height="${skidH * s}" class="tk-floor"/>`;
      sbPos.forEach(x => {                           // skids/voeten onder de kist
        g += `<rect x="${X(x - sbW / 2)}" y="${YB(0)}" width="${sbW * s}" height="${Math.max(skidH * s * 0.8, 5)}" class="tk-skid"/>`;
      });
      return g;
    }
  });

  // kopaanzicht (breedte × hoogte)
  const kop = ortho("Kopaanzicht", uB, uH, { w: p.b, h: p.h, opBodem: true }, {
    vloerCm: skidH,
    draw: ({ X, Y, YB, s, ox, oy }) => {
      let g = wandKlampen(ox, oy, uB * s, uH * s, 2);
      g += `<rect x="${X(0)}" y="${YB(skidH)}" width="${uB * s}" height="${skidH * s}" class="tk-floor"/>`;
      return g;
    }
  });

  const iso = isoKist(res, uL, uB, uH, sbPos, sbW, skidH);

  return `<div class="tek-iso">${iso}</div>
    <div class="tek-ortho">${boven}${zij}${kop}</div>
    <p class="muted small" style="margin-top:10px">Buitenmaat ${fmt(uL)} × ${fmt(uB)} × ${fmt(uH)} cm · onderstel met ${sbPos.length} sleebalk${sbPos.length === 1 ? "" : "ken"} · schematisch, maatvast op schaal per aanzicht.</p>`;
}

// klampen-raster op een wandvlak (rechthoek ox,oy,w,h in px): rand + n verticale klampen
function wandKlampen(ox, oy, w, h, nVert) {
  let g = `<rect x="${ox + 3}" y="${oy + 3}" width="${w - 6}" height="${h - 6}" class="tk-frame"/>`;
  for (let i = 1; i <= nVert; i++) {
    const x = ox + w * i / (nVert + 1);
    g += `<line x1="${x}" y1="${oy + 3}" x2="${x}" y2="${oy + h - 3}" class="tk-klamp"/>`;
  }
  // bovenklamp
  g += `<line x1="${ox + 3}" y1="${oy + 10}" x2="${ox + w - 3}" y2="${oy + 10}" class="tk-klamp"/>`;
  return g;
}

// isometrische 3D-weergave
function isoKist(res, uL, uB, uH, sbPos, sbW, skidH) {
  const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
  const pr = (x, y, z) => [(x - y) * c, (x + y) * s - z];
  const corners = [];
  for (const x of [0, uL]) for (const y of [0, uB]) for (const z of [0, uH]) corners.push(pr(x, y, z));
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const target = 300, pad = 42;
  const sc = target / Math.max(maxX - minX, maxY - minY);
  const W = (maxX - minX) * sc + pad * 2, H = (maxY - minY) * sc + pad * 2 + 14;
  const P = (x, y, z) => { const [px, py] = pr(x, y, z); return [(px - minX) * sc + pad, (py - minY) * sc + pad]; };
  const pts = arr => arr.map(a => P(a[0], a[1], a[2]).map(v => v.toFixed(1)).join(",")).join(" ");
  const poly = (cls, arr) => `<polygon class="${cls}" points="${pts(arr)}"/>`;
  const line = (a, b, cls) => { const p1 = P(...a), p2 = P(...b); return `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" class="${cls}"/>`; };

  // vlakken: top, voorkant (y=0), rechterkant (x=uL)
  let g = poly("tk-face-top", [[0, 0, uH], [uL, 0, uH], [uL, uB, uH], [0, uB, uH]]);
  g += poly("tk-face-side", [[uL, 0, 0], [uL, uB, 0], [uL, uB, uH], [uL, 0, uH]]);
  g += poly("tk-face-front", [[0, 0, 0], [uL, 0, 0], [uL, 0, uH], [0, 0, uH]]);
  // klampen op voorkant (verticaal) en rechterkant
  for (let i = 1; i <= 3; i++) { const x = uL * i / 4; g += line([x, 0, 0], [x, 0, uH], "tk-klamp3"); }
  for (let i = 1; i <= 2; i++) { const y = uB * i / 3; g += line([uL, y, 0], [uL, y, uH], "tk-klamp3"); }
  // bovenklamp-randen
  g += line([0, 0, uH * 0.92], [uL, 0, uH * 0.92], "tk-klamp3");
  // skids (voeten) onder de voorkant
  sbPos.forEach(x => {
    const a = P(x - sbW / 2, 0, 0), b = P(x + sbW / 2, 0, 0);
    const hh = Math.max(skidH * sc * 0.5, 7);
    g += `<polygon class="tk-skid" points="${a[0].toFixed(1)},${a[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)} ${b[0].toFixed(1)},${(b[1] + hh).toFixed(1)} ${a[0].toFixed(1)},${(a[1] + hh).toFixed(1)}"/>`;
  });
  // randen
  const edges = [[[0, 0, 0], [uL, 0, 0]], [[0, 0, 0], [0, uB, 0]], [[0, 0, 0], [0, 0, uH]],
    [[uL, 0, 0], [uL, uB, 0]], [[uL, 0, 0], [uL, 0, uH]], [[0, uB, 0], [uL, uB, 0]],
    [[0, 0, uH], [uL, 0, uH]], [[0, 0, uH], [0, uB, uH]], [[uL, 0, uH], [uL, uB, uH]],
    [[0, uB, uH], [uL, uB, uH]], [[uL, uB, 0], [uL, uB, uH]], [[0, uB, 0], [0, uB, uH]]];
  edges.forEach(e => g += line(e[0], e[1], "tk-edge"));
  // maat-labels bij de 3 richtingen
  const mid = (a, b) => { const p1 = P(...a), p2 = P(...b); return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]; };
  const mL = mid([0, 0, 0], [uL, 0, 0]), mB = mid([uL, 0, 0], [uL, uB, 0]), mH = mid([uL, uB, 0], [uL, uB, uH]);
  g += `<text x="${mL[0]}" y="${mL[1] + 16}" class="tk-dimtext" text-anchor="middle">L ${fmt(uL)}</text>`;
  g += `<text x="${mB[0] + 14}" y="${mB[1] + 12}" class="tk-dimtext" text-anchor="middle">B ${fmt(uB)}</text>`;
  g += `<text x="${mH[0] + 16}" y="${mH[1]}" class="tk-dimtext" text-anchor="middle">H ${fmt(uH)}</text>`;

  return `<figure class="tek-fig"><svg viewBox="0 0 ${W} ${H}" class="tek-svg" preserveAspectRatio="xMidYMid meet">${g}</svg><figcaption>3D-weergave</figcaption></figure>`;
}

/* ============================ RENDER ADVIES ============================ */
function renderAdvies() {
  const p = state.product;
  if (!(p.l > 0 && p.b > 0 && p.h > 0)) {
    $("advies-inhoud").innerHTML = `<div class="banner fout"><span class="ic">⛔</span><div>Vul eerst geldige productafmetingen in bij stap 1.</div></div>`;
    return;
  }
  // familie (prefix): handmatige override of standaard volgens vracht
  const fam = (state.gekozenFam && families().includes(state.gekozenFam)) ? state.gekozenFam : standaardFam();
  const cands = kandidaten(fam);
  if (!cands.length) { $("advies-inhoud").innerHTML = `<div class="banner fout"><span class="ic">⛔</span><div>Geen kisttypes gevonden voor familie ${esc(fam)}.</div></div>`; return; }

  // benodigde gewichtsklasse uit het productgewicht
  const nodigKlasse = klasseVoorGewicht(p.gewicht);

  // aanbevolen type binnen de familie (haalt de klasse; dan lichtste/goedkoopste)
  const { aanbevolen, geschiktAanwezig } = kiesAanbevolen(cands, nodigKlasse);
  const aanbevolenCode = (state.gekozenType && cands.find(c => c.code === state.gekozenType))
    ? state.gekozenType : aanbevolen.code;
  const gekozen = cands.find(c => c.code === aanbevolenCode) || aanbevolen;
  const res = gekozen.res, k = gekozen.kost;
  const bm = binnenmaat();

  // gewichten
  const tarra = res.kpi.tarra, bruto = tarra + p.gewicht;
  const volGew = res.kpi.M3 * CONFIG.volumeFactorLucht;
  const chargeable = Math.max(bruto, volGew);

  // dropdowns
  const famOpties = families().map(f =>
    `<option value="${f}" ${f === fam ? "selected" : ""}>${esc(famLabel(f))}</option>`).join("");
  // types gesorteerd op klasse, dan gewicht
  const candsGesorteerd = cands.slice().sort((a, b) => a.klasse - b.klasse || a.res.kpi.tarra - b.res.kpi.tarra);
  const typeOpties = candsGesorteerd.map(c =>
    `<option value="${c.code}" ${c.code === aanbevolenCode ? "selected" : ""}>${c.code}${Engine.isValidated(c.code) ? " ✓" : ""} — ${klasseLabel(c.klasse)} · ${fmt(c.res.kpi.tarra)} kg · ${euro(c.kost.verkoop)}</option>`).join("");

  const validatie = Engine.isValidated(gekozen.code)
    ? `<span class="chip hout">geometrie gevalideerd</span>`
    : `<span class="chip">geometrie te valideren</span>`;
  const klasseOk = gekozen.klasse >= nodigKlasse;

  $("advies-inhoud").innerHTML = `
  <div class="advies-grid">
    <!-- LINKS: advies + tekening -->
    <div>
      <div class="kaart advies-kaart">
        <div class="kaart-kop">Ons advies</div>
        <div class="kaart-body">
          <div class="advies-top">
            <div>
              <div class="advies-fam">${esc(gekozen.code)} <span class="muted" style="font-weight:500;font-size:14px">— ${esc(klasseLabel(gekozen.klasse))}</span></div>
              <div class="muted small">${esc(famReden(fam))} · ${state.vracht === "zee" ? "zeevracht" : "luchtvracht"}${state.bestemming ? " → " + esc(state.bestemming) : ""}</div>
            </div>
          </div>

          ${!klasseOk ? `<div class="banner fout" style="margin:12px 0 0"><span class="ic">⛔</span><div>Let op: dit type valt in klasse <strong>${esc(klasseLabel(gekozen.klasse))}</strong>, maar het product weegt ${fmt(p.gewicht)} kg (${esc(klasseLabel(nodigKlasse))}). Kies een zwaarder type of andere familie.</div></div>` : ""}

          <div class="rij2" style="margin-top:12px">
            <div class="veld">
              <label for="a-fam">Familie (materiaal)</label>
              <select id="a-fam">${famOpties}</select>
            </div>
            <div class="veld">
              <label for="a-type">Kisttype ${validatie}</label>
              <select id="a-type">${typeOpties}</select>
            </div>
          </div>
          <div class="muted small">Benodigde klasse voor ${fmt(p.gewicht)} kg: <strong>${esc(klasseLabel(nodigKlasse))}</strong>. Aanbevolen = lichtste/goedkoopste type dat die klasse haalt. Je kunt zelf een ander type of familie kiezen.</div>

          <div class="kpi-rij" style="margin:14px 0 0">
            <div class="kpi"><div class="lbl">Buitenmaat</div><div class="val" style="font-size:16px">${fmt(res.uL)}×${fmt(res.uB)}×${fmt(res.uH)} <small>cm</small></div></div>
            <div class="kpi"><div class="lbl">Volume</div><div class="val">${fmt(res.kpi.M3, 2)} <small>m³</small></div></div>
            <div class="kpi"><div class="lbl">Leeggewicht kist</div><div class="val">${fmt(tarra)} <small>kg</small></div></div>
            <div class="kpi accent"><div class="lbl">${state.vracht === "lucht" ? "Vrachtgewicht" : "Brutogewicht"}</div><div class="val">${fmt(state.vracht === "lucht" ? chargeable : bruto)} <small>kg</small></div></div>
          </div>
          ${state.vracht === "lucht" ? `<p class="muted small" style="margin:8px 0 0">Bruto ${fmt(bruto)} kg · volumegewicht ${fmt(volGew)} kg (1 m³ ≈ ${CONFIG.volumeFactorLucht} kg). Luchtvracht rekent met het hoogste.</p>` : ""}
        </div>
      </div>
    </div>

    <!-- RECHTS: kostprijs + alternatieven -->
    <div>
      <div class="kaart">
        <div class="kaart-kop">Kostprijs <span class="muted small">per kist</span></div>
        <div class="kaart-body">
          <table class="lijst mini">
            <tr><td>Materiaal — hout</td><td class="num">${fmt(k.houtM3, 3)} m³</td><td class="num">${euro(k.houtM3 * CONFIG.prijsHoutM3)}</td></tr>
            <tr><td>Materiaal — plaat</td><td class="num">${fmt(k.plaatM3, 3)} m³</td><td class="num">${euro(k.plaatM3 * CONFIG.prijsPlaatM3)}</td></tr>
            <tr><td>Arbeid</td><td class="num">${fmt(k.uren, 2)} u</td><td class="num">${euro(k.arbeid)}</td></tr>
            <tr class="subtot"><td>Kostprijs</td><td></td><td class="num">${euro(k.kost)}</td></tr>
            <tr><td>Marge ${CONFIG.marge}%</td><td></td><td class="num">${euro(k.verkoop - k.kost)}</td></tr>
            <tr class="tot"><td><strong>Verkoop excl. btw</strong></td><td></td><td class="num"><strong>${euro(k.verkoop)}</strong></td></tr>
            ${p.aantal > 1 ? `<tr class="tot"><td>Totaal · ${p.aantal} kisten</td><td></td><td class="num"><strong>${euro(k.verkoop * p.aantal)}</strong></td></tr>` : ""}
          </table>
        </div>
      </div>

      <div class="kaart" style="margin-top:18px">
        <div class="kaart-kop">Alternatieven <span class="muted small">zelfde familie &amp; maat</span></div>
        <div class="kaart-body" style="padding:0">
          <table class="lijst">
            <thead><tr><th>Type</th><th>Klasse</th><th class="num">Gewicht</th><th class="num">Prijs</th></tr></thead>
            <tbody>${candsGesorteerd.slice(0, 8).map(c => `<tr class="${c.code === aanbevolenCode ? "gekozen" : ""}">
              <td>${c.code}${Engine.isValidated(c.code) ? " ✓" : ""}</td>
              <td class="small">${esc(klasseLabel(c.klasse))}</td>
              <td class="num">${fmt(c.res.kpi.tarra)} kg</td>
              <td class="num">${euro(c.kost.verkoop)}</td></tr>`).join("")}</tbody>
          </table>
        </div>
      </div>

      <details class="kaart aannames" style="margin-top:18px">
        <summary class="kaart-kop">⚙️ Aannames &amp; tarieven <span class="muted small">(voorlopig — pas aan)</span></summary>
        <div class="kaart-body">
          <div class="rij2">
            <div class="veld"><label>Speling per kant (cm)</label><input type="number" id="c-spelingZij" value="${CONFIG.spelingZij}" step="0.5"></div>
            <div class="veld"><label>Speling boven (cm)</label><input type="number" id="c-spelingTop" value="${CONFIG.spelingTop}" step="0.5"></div>
          </div>
          <div class="rij2">
            <div class="veld"><label>Hout € / m³</label><input type="number" id="c-prijsHoutM3" value="${CONFIG.prijsHoutM3}"></div>
            <div class="veld"><label>Plaat € / m³</label><input type="number" id="c-prijsPlaatM3" value="${CONFIG.prijsPlaatM3}"></div>
          </div>
          <div class="rij2">
            <div class="veld"><label>Uurtarief €</label><input type="number" id="c-uurtarief" value="${CONFIG.uurtarief}"></div>
            <div class="veld"><label>Marge %</label><input type="number" id="c-marge" value="${CONFIG.marge}"></div>
          </div>
          <div class="muted small">Binnenmaat nu: ${fmt(bm.il)} × ${fmt(bm.ib)} × ${fmt(bm.ih)} cm (product + speling).</div>
        </div>
      </details>
    </div>
  </div>

  <div class="kaart" style="margin-top:18px">
    <div class="kaart-kop">Tekening <span class="muted small">— ${esc(gekozen.code)}</span></div>
    <div class="kaart-body" id="tek-slot"></div>
  </div>`;

  $("tek-slot").innerHTML = tekenKist(res);

  // wiring
  $("a-type").addEventListener("change", e => { state.gekozenType = e.target.value; renderAdvies(); });
  $("a-fam").addEventListener("change", e => { state.gekozenFam = e.target.value; state.gekozenType = null; renderAdvies(); });
  [["c-spelingZij", "spelingZij"], ["c-spelingTop", "spelingTop"], ["c-prijsHoutM3", "prijsHoutM3"],
   ["c-prijsPlaatM3", "prijsPlaatM3"], ["c-uurtarief", "uurtarief"], ["c-marge", "marge"]]
    .forEach(([id, key]) => {
      const el = $(id); if (!el) return;
      el.addEventListener("change", () => {
        const details = el.closest("details"); const open = details ? details.open : false;
        CONFIG[key] = +el.value || 0; renderAdvies();
        if (open) { const d = $(id) && $(id).closest("details"); if (d) d.open = true; }
      });
    });
}

/* ============================ MODULE-NAV ============================ */
function toonModule(naam) {
  ["ontwikkelen", "tekenen", "optimaliseren", "bestellen"].forEach(m =>
    $("mod-" + m).classList.toggle("hidden", m !== naam));
  document.querySelectorAll("#modnav button").forEach(b =>
    b.classList.toggle("actief", b.dataset.mod === naam));
}
document.querySelectorAll("#modnav button").forEach(b => {
  if (!b.disabled) b.addEventListener("click", () => toonModule(b.dataset.mod));
});

/* ============================ START ============================ */
wireUpload();
$("naar-2").addEventListener("click", () => { leesStap1(); toonStap(2); });
$("naar-3").addEventListener("click", () => { leesStap2(); state.gekozenType = null; state.gekozenFam = null; toonStap(3); });
$("terug-1").addEventListener("click", () => toonStap(1));
$("terug-2").addEventListener("click", () => toonStap(2));
$("opnieuw").addEventListener("click", () => { state.gekozenType = null; state.gekozenFam = null; toonStap(1); });
$("btn-print").addEventListener("click", () => window.print());
document.querySelectorAll("#stepper li").forEach(li =>
  li.addEventListener("click", () => { const s = +li.dataset.step; if (s < state.stap) toonStap(s); }));
toonStap(1);
