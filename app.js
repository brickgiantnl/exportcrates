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
  // verpakkingsruimte rond het product → binnenmaat kist (cm per zijde).
  // Standaard 10 cm rondom (links/rechts, voor/achter en boven); product op de bodem.
  spelingRondom: 10,
  // standaard familie (2-letter prefix) per vrachtsoort (eerste voorzet)
  famZee: "KS",     // zeevracht → volledig vurenhout (sterk, ISPM-15)
  famLucht: "PS",   // luchtvracht → multiplex (lichter)
  // kostprijs-tarieven
  // Hout/planken: prijs per STREKKENDE METER, per profiel. Staat er geen prijs
  // voor een profiel in houtPrijzen, dan afgeleid uit houtBasisM3 (€/m³ × doorsnede).
  houtBasisM3: 350,     // € per m³ (voor afgeleide €/m waar geen vaste prijs is)
  houtPrijzen: {},      // bv. {"5x7.5": 1.20, "10x2.5": 0.95}  (€ per strekkende meter)
  prijsPlaatM2: 15,     // € per m² plaatmateriaal (multiplex/osb)
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
  const base = d.prefix + d.dLL + d.dVL + d.dWD;           // 5-teken basistype
  if (TC.klasseMap && TC.klasseMap[base] != null) return TC.klasseMap[base];  // exact van blad
  const map = TC.cijferNaarKlasse || {};                    // terugval: 1e cijfer
  return map[d.dLL] != null ? map[d.dLL] : 0;
}
// is de klasse van dit type exact van het blad (true) of afgeleid (false)?
function klasseVanBlad(code) {
  const d = decode(code); if (!d) return false;
  return !!(TC.klasseMap && TC.klasseMap[d.prefix + d.dLL + d.dVL + d.dWD] != null);
}
function klasseLabel(i) { return (TC.gewichtsklassen && TC.gewichtsklassen[i]) ? TC.gewichtsklassen[i].label : "—"; }

/* ---------------- STATE ---------------- */
Engine.init(window.KIST_TYPES || {});
const state = {
  stap: 1,
  product: { l: 120, b: 80, h: 90, gewicht: 350, aantal: 1, oms: "", tekening: null, tekeningNaam: "", tekeningType: "" },
  bestemming: "", vracht: "zee",
  gekozenType: null,       // handmatige override kisttype
  gekozenFam: null,        // handmatige override familie (2-letter prefix)
  // onderstel & drukpunten (voor positioneren heftruckbalken / sleebalken)
  onderstel: { sbAantal: null, sbPosTxt: "", drukpunten: [], overlay: 0.65 },
  gekozenCode: null,        // laatst geadviseerde/ gekozen kisttype (voor Optimaliseren)
  opt: { voorraad: [300, 400, 500], plaatL: 244, plaatB: 122, kerf: 0.4, eenheid: "20ft", stapelen: false, maxLagen: 2 },
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
    state.product.tekening = null; state.product.tekeningNaam = ""; state.product.tekeningType = "";
    $("tekening-prev").innerHTML = "";
    $("upload-preview").classList.add("hidden"); $("upload-leeg").classList.remove("hidden");
  });
}
// Bouwt de preview (afbeelding of PDF) uit een data-URL
function tekeningPreviewHTML(dataUrl, type) {
  if (!dataUrl) return "";
  return type === "application/pdf"
    ? `<embed src="${dataUrl}" type="application/pdf" class="tek-upload-embed" />`
    : `<img src="${dataUrl}" class="tek-upload-img" alt="Producttekening" />`;
}
function laadTekening(file) {
  state.product.tekeningNaam = file.name;
  state.product.tekeningType = file.type;
  const reader = new FileReader();
  reader.onload = () => {
    state.product.tekening = reader.result;                 // data-URL (afbeelding óf PDF)
    $("tekening-prev").innerHTML = tekeningPreviewHTML(reader.result, file.type);
  };
  reader.readAsDataURL(file);
  $("tekening-naam").textContent = file.name;
  $("upload-leeg").classList.add("hidden"); $("upload-preview").classList.remove("hidden");
}

/* ============================ MEET-TOOL (kalibreren + meten) ============================ */
const meet = { img: null, scale: null, pts: [], laatste: null, metingen: { l: null, b: null, h: null }, disp: 1 };
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

async function pdfNaarImage(dataUrl) {
  const b = atob(dataUrl.split(",")[1]), arr = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
  const pdf = await pdfjsLib.getDocument({ data: arr }).promise;
  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
  return c.toDataURL("image/png");
}
async function openMeetTool() {
  if (!state.product.tekening) return;
  meet.scale = null; meet.pts = []; meet.laatste = null; meet.metingen = { l: null, b: null, h: null };
  let src = state.product.tekening;
  if ((state.product.tekeningType || "") === "application/pdf") {
    if (!window.pdfjsLib) { alert("PDF-lezer nog niet geladen — probeer zo nog eens, of upload een afbeelding."); return; }
    try { src = await pdfNaarImage(src); } catch (e) { alert("Kon de PDF niet openen. Upload eventueel een afbeelding."); return; }
  }
  const img = new Image();
  img.onload = () => { meet.img = img; $("meet-modal").classList.remove("hidden"); meetLayout(); meetDraw(); meetUpdate(); };
  img.onerror = () => alert("Kon de afbeelding niet laden.");
  img.src = src;
}
function meetLayout() {
  const canvas = $("meet-canvas"), wrap = canvas.parentElement;
  const maxW = wrap.clientWidth || 600, maxH = wrap.clientHeight || 520;
  meet.disp = Math.min(maxW / meet.img.width, maxH / meet.img.height);
  canvas.width = Math.round(meet.img.width * meet.disp);
  canvas.height = Math.round(meet.img.height * meet.disp);
}
function meetPos(e) {
  const canvas = $("meet-canvas"), rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (canvas.width / rect.width) / meet.disp,
           y: (e.clientY - rect.top) * (canvas.height / rect.height) / meet.disp };
}
function meetDraw() {
  const canvas = $("meet-canvas"), ctx = canvas.getContext("2d"), d = meet.disp;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(meet.img, 0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = meet.scale == null ? "#1f6b4a" : "#c0392b"; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 2;
  meet.pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x * d, p.y * d, 4, 0, 7); ctx.fill(); });
  if (meet.pts.length === 2) { ctx.beginPath(); ctx.moveTo(meet.pts[0].x * d, meet.pts[0].y * d); ctx.lineTo(meet.pts[1].x * d, meet.pts[1].y * d); ctx.stroke(); }
}
function meetPixelDist() { const a = meet.pts[0], b = meet.pts[1]; return Math.hypot(b.x - a.x, b.y - a.y); }
function meetUpdate() {
  $("meet-schaal-status").textContent = meet.scale
    ? `Schaal ingesteld ✓ (klik nu twee punten om te meten)`
    : (meet.pts.length === 2 ? "Vul de echte lengte in en klik 'Zet schaal'." : "Klik twee punten op een bekende maat.");
  const kanSchaal = meet.scale == null && meet.pts.length === 2;
  $("meet-echt").disabled = !kanSchaal; $("meet-schaal-ok").disabled = !kanSchaal;
  $("meet-stap2").classList.toggle("meet-dim", meet.scale == null);
  $("meet-laatste").textContent = meet.laatste != null ? fmt(meet.laatste) + " cm" : "—";
  document.querySelectorAll(".meet-wijs").forEach(b => b.disabled = meet.laatste == null);
  $("meet-l").textContent = meet.metingen.l != null ? fmt(meet.metingen.l) : "—";
  $("meet-b").textContent = meet.metingen.b != null ? fmt(meet.metingen.b) : "—";
  $("meet-h").textContent = meet.metingen.h != null ? fmt(meet.metingen.h) : "—";
}
function wireMeet() {
  $("btn-meten").addEventListener("click", openMeetTool);
  $("meet-sluit").addEventListener("click", () => $("meet-modal").classList.add("hidden"));
  $("meet-canvas").addEventListener("click", e => {
    const p = meetPos(e);
    if (meet.pts.length >= 2) meet.pts = [];
    meet.pts.push(p);
    if (meet.pts.length === 2 && meet.scale != null) meet.laatste = Math.round(meetPixelDist() * meet.scale * 10) / 10;
    meetDraw(); meetUpdate();
  });
  $("meet-schaal-ok").addEventListener("click", () => {
    const echt = +$("meet-echt").value; if (!(echt > 0) || meet.pts.length !== 2) return;
    const cm = $("meet-eenheid").value === "mm" ? echt / 10 : echt;
    meet.scale = cm / meetPixelDist(); meet.pts = []; meet.laatste = null;
    meetDraw(); meetUpdate();
  });
  document.querySelectorAll(".meet-wijs").forEach(b => b.addEventListener("click", () => {
    if (meet.laatste == null) return; meet.metingen[b.dataset.dim] = meet.laatste; meetUpdate();
  }));
  $("meet-reset").addEventListener("click", () => { meet.scale = null; meet.pts = []; meet.laatste = null; meet.metingen = { l: null, b: null, h: null }; meetDraw(); meetUpdate(); });
  $("meet-overnemen").addEventListener("click", () => {
    const m = meet.metingen;
    if (m.l != null) $("p-l").value = m.l;
    if (m.b != null) $("p-b").value = m.b;
    if (m.h != null) $("p-h").value = m.h;
    $("meet-modal").classList.add("hidden");
  });
}

/* ============================ BINNENMAAT + KEUZE ============================ */
function binnenmaat() {
  const p = state.product, r = CONFIG.spelingRondom;
  // 10 cm rondom: beide zijden in lengte/breedte, één keer boven (product op de bodem)
  return { il: p.l + 2 * r, ib: p.b + 2 * r, ih: p.h + r };
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
  const bm = binnenmaat(), o = state.onderstel;
  const sbPos = o.sbPosTxt
    ? o.sbPosTxt.split(/[,; ]+/).map(Number).filter(n => !isNaN(n))
    : null;
  return Engine.berekenKist(code, {
    il: bm.il, ib: bm.ib, ih: bm.ih, aantal: state.product.aantal,
    uithouders: false, uitvullen: false, materiaal: "multiplex",
    sbAantal: o.sbAantal || null, sbPos,
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
function houtPrijsPerM(d) {
  // vaste prijs per profiel (b×d) als die bekend is, anders afgeleid uit €/m³
  const key = `${fmt(d.b)}x${fmt(d.dk)}`;
  if (CONFIG.houtPrijzen && CONFIG.houtPrijzen[key] != null) return CONFIG.houtPrijzen[key];
  return (d.b * (d.dk || 0) / 1e4) * CONFIG.houtBasisM3;      // doorsnede (m²) × €/m³ = €/m
}
function kostprijs(res) {
  let houtMeter = 0, houtKost = 0, plaatM2 = 0;
  res.delen.forEach(d => {
    if (d.cat === "plaat") {
      plaatM2 += d.aantal * d.lengte * (d.b || 0) / 1e4;     // m²
    } else {
      const m = d.aantal * d.lengte / 100;                    // strekkende meter
      houtMeter += m;
      houtKost += m * houtPrijsPerM(d);
    }
  });
  const plaatKost = plaatM2 * CONFIG.prijsPlaatM2;
  const materiaal = houtKost + plaatKost;
  const uren = CONFIG.uurBasis + CONFIG.uurPerM2 * res.kpi.M2;
  const arbeid = uren * CONFIG.uurtarief;
  const kost = materiaal + arbeid;
  const verkoop = kost * (1 + CONFIG.marge / 100);
  return { houtMeter, houtKost, plaatM2, plaatKost, materiaal, uren, arbeid, kost, verkoop };
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

  // geüploade afbeelding (alleen echte afbeeldingen; PDF kan niet als overlay)
  const overlayImg = (state.product.tekening && (state.product.tekeningType || "").startsWith("image/"))
    ? state.product.tekening : null;
  const druk = state.onderstel.drukpunten || [];

  /* ---------- orthografische weergave ---------- */
  const ortho = (titel, w, h, binnen, opts) => {
    opts = opts || {};
    const target = 215, pad = 38, s = target / Math.max(w, h);
    const W = w * s + pad * 2, H = h * s + pad * 2, ox = pad, oy = pad;
    const X = cm => ox + cm * s, Y = cm => oy + cm * s;        // vanaf linksboven kist
    const YB = cm => oy + h * s - cm * s;                       // vanaf onderkant kist
    const extra = opts.draw ? opts.draw({ X, Y, YB, s, ox, oy, w, h }) : "";
    // product (gestreept); bij aanzichten op de bodem, bovenaanzicht gecentreerd
    const iw = binnen.w * s, ih = binnen.h * s;
    const ix = ox + (w * s - iw) / 2;
    const iy = binnen.opBodem ? (oy + h * s - ih - (opts.vloerCm || 0) * s) : (oy + (h * s - ih) / 2);
    const overlay = opts.overlay
      ? `<image href="${opts.overlay}" x="${ix}" y="${iy}" width="${iw}" height="${ih}" opacity="${opts.overlayOpacity}" preserveAspectRatio="none"/>` : "";
    const prod = `<rect x="${ix}" y="${iy}" width="${iw}" height="${ih}" class="tk-prod" rx="1"/>` +
      (opts.overlay ? "" : `<text x="${ix + iw / 2}" y="${iy + ih / 2}" class="tk-prodtxt">product</text>`);
    // zwaartepunt-lijn
    const cogSvg = opts.cog
      ? `<line x1="${X(opts.cog.x)}" y1="${oy - 4}" x2="${X(opts.cog.x)}" y2="${oy + h * s + 4}" class="tk-cog-lijn"/>
         <text class="tk-cog-txt" x="${X(opts.cog.x)}" y="${oy - 8}">ZP ${fmt(opts.cog.x)}</text>` : "";
    // drukpunten: maatlijn-kruis + sleepbaar punt + coördinaat
    const drukM = (opts.drukpunten || []).map((d, i) => {
      const cx = X(d.x), cy = Y(d.y);
      return `<line x1="${cx}" y1="${oy}" x2="${cx}" y2="${oy + h * s}" class="tk-druk-lijn"/>
        <line x1="${ox}" y1="${cy}" x2="${ox + w * s}" y2="${cy}" class="tk-druk-lijn"/>
        <g class="tk-druk" data-kind="druk" data-i="${i}"><circle cx="${cx}" cy="${cy}" r="5.5"/><text x="${cx}" y="${cy}">${i + 1}</text></g>
        <text class="tk-druk-coord" x="${cx + 8}" y="${cy - 7}">${fmt(d.x)};${fmt(d.y)}</text>`;
    }).join("");
    const attrs = opts.klikbaar
      ? `id="${opts.svgId}" class="tek-svg klikbaar" data-ox="${ox}" data-oy="${oy}" data-s="${s}" data-w="${w}" data-h="${h}"`
      : `class="tek-svg"`;
    return `<figure class="tek-fig"><svg viewBox="0 0 ${W} ${H}" ${attrs} preserveAspectRatio="xMidYMid meet">
      <rect x="${ox}" y="${oy}" width="${w * s}" height="${h * s}" class="tk-kist"/>
      ${extra}${overlay}${prod}${cogSvg}${drukM}
      ${dimH(ox, ox + w * s, oy + h * s + 20, fmt(w) + " cm")}
      ${dimV(oy, oy + h * s, ox - 18, fmt(h) + " cm")}
    </svg><figcaption>${titel}</figcaption></figure>`;
  };

  // bovenaanzicht (bodem/onderstel): langsliggers (lengte) + sleebalken (dwars),
  // met overlay-afbeelding + drukpunten; klikbaar om drukpunten te plaatsen.
  const boven = ortho("Bovenaanzicht — bodem · klik voor drukpunt, sleep om te verplaatsen", uL, uB, { w: p.l, h: p.b, opBodem: false }, {
    overlay: overlayImg, overlayOpacity: state.onderstel.overlay, drukpunten: druk, cog: zwaartepunt(),
    klikbaar: true, svgId: "svg-boven",
    draw: ({ X, Y, s }) => {
      let g = "";
      for (let i = 0; i < nLL; i++) {               // 4 langsliggers over de breedte
        const yc = uB * (i + 0.5) / nLL, hh = Math.max(2.5 * s, 3);
        g += `<rect x="${X(0)}" y="${Y(yc) - hh / 2}" width="${uL * s}" height="${hh}" class="tk-ll"/>`;
      }
      sbPos.forEach((x, idx) => {                    // sleebalken dwars (volle breedte), sleepbaar
        g += `<rect x="${X(x - sbW / 2)}" y="${Y(0)}" width="${sbW * s}" height="${uB * s}" class="tk-sb2" data-kind="balk" data-i="${idx}"/>`;
        g += `<text x="${X(x)}" y="${Y(uB) + 11}" class="tk-sblabel" data-i="${idx}">${fmt(x)}</text>`;
      });
      return g;
    }
  });

  // zijaanzicht (lengte × hoogte): wand met klampen + onderstel + skids
  const zij = ortho("Zijaanzicht", uL, uH, { w: p.l, h: p.h, opBodem: true, }, {
    vloerCm: skidH, overlay: overlayImg, overlayOpacity: state.onderstel.overlay,
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
    vloerCm: skidH, overlay: overlayImg, overlayOpacity: state.onderstel.overlay,
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

// is er een afbeelding (geen PDF) die als overlay in de kist kan?
function overlayBeschikbaar() {
  return !!(state.product.tekening && (state.product.tekeningType || "").startsWith("image/"));
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
  state.gekozenCode = gekozen.code;   // onthouden voor de Optimaliseren-module

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

          <div class="kpi-rij vijf" style="margin:14px 0 0">
            <div class="kpi"><div class="lbl">Binnenmaat <span class="hint">incl. speling</span></div><div class="val" style="font-size:16px">${fmt(bm.il)}×${fmt(bm.ib)}×${fmt(bm.ih)} <small>cm</small></div></div>
            <div class="kpi"><div class="lbl">Buitenmaat</div><div class="val" style="font-size:16px">${fmt(res.uL)}×${fmt(res.uB)}×${fmt(res.uH)} <small>cm</small></div></div>
            <div class="kpi"><div class="lbl">Volume</div><div class="val">${fmt(res.kpi.M3, 2)} <small>m³</small></div></div>
            <div class="kpi"><div class="lbl">Leeggewicht kist</div><div class="val">${fmt(tarra)} <small>kg</small></div></div>
            <div class="kpi accent"><div class="lbl">${state.vracht === "lucht" ? "Vrachtgewicht" : "Brutogewicht"}</div><div class="val">${fmt(state.vracht === "lucht" ? chargeable : bruto)} <small>kg</small></div></div>
          </div>
          <p class="muted small" style="margin:8px 0 0">Binnenmaat = product ${fmt(p.l)}×${fmt(p.b)}×${fmt(p.h)} cm + ${fmt(CONFIG.spelingRondom)} cm speling rondom. Buitenmaat = binnenmaat + wanden/vloer/deksel van het kisttype.</p>
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
            <tr><td>Hout / planken</td><td class="num">${fmt(k.houtMeter)} m</td><td class="num">${euro(k.houtKost)}</td></tr>
            <tr><td>Plaatmateriaal</td><td class="num">${fmt(k.plaatM2, 2)} m²</td><td class="num">${euro(k.plaatKost)}</td></tr>
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
            <div class="veld"><label>Speling rondom (cm)</label><input type="number" id="c-spelingRondom" value="${CONFIG.spelingRondom}" step="0.5"></div>
            <div class="veld"></div>
          </div>
          <div class="rij2">
            <div class="veld"><label>Hout basis € / m³ <span class="hint">(→ €/m per profiel)</span></label><input type="number" id="c-houtBasisM3" value="${CONFIG.houtBasisM3}"></div>
            <div class="veld"><label>Plaat € / m²</label><input type="number" id="c-prijsPlaatM2" value="${CONFIG.prijsPlaatM2}"></div>
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
    <div class="kaart-kop">Tekening &amp; onderstel <span class="muted small">— ${esc(gekozen.code)}</span></div>
    <div class="kaart-body">
      <div class="onderstel-panel">
        <div class="op-rij">
          <div class="veld"><label>Aantal heftruckbalken <span class="hint">(leeg = auto)</span></label>
            <input type="number" id="o-aantal" min="1" step="1" value="${state.onderstel.sbAantal || ""}" placeholder="auto"></div>
          <div class="veld"><label>Posities vanaf links (cm) <span class="hint">(leeg = auto)</span></label>
            <input type="text" id="o-pos" value="${esc(state.onderstel.sbPosTxt)}" placeholder="bv. 30, 120, 210"></div>
        </div>
        <div class="op-acties">
          <button type="button" class="btn ghost small-btn" id="o-auto">↺ Auto</button>
          <button type="button" class="btn ghost small-btn" id="o-onder-druk">Balken onder drukpunten</button>
          <button type="button" class="btn ghost small-btn" id="o-wis-druk">Drukpunten wissen (${(state.onderstel.drukpunten || []).length})</button>
          ${overlayBeschikbaar() ? `<label class="op-slider">Tekening-overlay <input type="range" id="o-overlay" min="0" max="1" step="0.05" value="${state.onderstel.overlay}"></label>` : ""}
        </div>
        <p class="muted small" style="margin:2px 0 0">Klik in het <strong>bovenaanzicht</strong> om een drukpunt te plaatsen; <strong>sleep</strong> drukpunten of balken om ze exact te positioneren. Typ hieronder de exacte maat in.${overlayBeschikbaar() ? "" : " Upload een <strong>afbeelding</strong> (foto/PNG/JPG) bij stap 1 om 'm als overlay in de kist te leggen; een PDF kan niet als overlay."}</p>
        ${drukTabelHTML(res)}
      </div>
      <div id="upload-tek-slot"></div>
      <div id="tek-slot"></div>
    </div>
  </div>`;

  $("tek-slot").innerHTML = tekenKist(res);
  // geüploade producttekening (afbeelding of PDF) tonen boven de gegenereerde tekening
  if (state.product.tekening) {
    $("upload-tek-slot").innerHTML =
      `<div class="tek-upload"><div class="tek-upload-kop">Jouw producttekening <span class="muted small">${esc(state.product.tekeningNaam)}</span></div>${tekeningPreviewHTML(state.product.tekening, state.product.tekeningType)}</div>`;
  }

  // wiring
  $("a-type").addEventListener("change", e => { state.gekozenType = e.target.value; renderAdvies(); });
  $("a-fam").addEventListener("change", e => { state.gekozenFam = e.target.value; state.gekozenType = null; renderAdvies(); });
  [["c-spelingRondom", "spelingRondom"], ["c-houtBasisM3", "houtBasisM3"],
   ["c-prijsPlaatM2", "prijsPlaatM2"], ["c-uurtarief", "uurtarief"], ["c-marge", "marge"]]
    .forEach(([id, key]) => {
      const el = $(id); if (!el) return;
      el.addEventListener("change", () => {
        const details = el.closest("details"); const open = details ? details.open : false;
        CONFIG[key] = +el.value || 0; renderAdvies();
        if (open) { const d = $(id) && $(id).closest("details"); if (d) d.open = true; }
      });
    });

  // --- onderstel & drukpunten ---
  const O = state.onderstel;
  $("o-aantal").addEventListener("change", e => {
    const v = parseInt(e.target.value, 10); O.sbAantal = v > 0 ? v : null; O.sbPosTxt = ""; renderAdvies();
  });
  $("o-pos").addEventListener("change", e => { O.sbPosTxt = e.target.value.trim(); renderAdvies(); });
  $("o-auto").addEventListener("click", () => { O.sbAantal = null; O.sbPosTxt = ""; renderAdvies(); });
  $("o-wis-druk").addEventListener("click", () => { O.drukpunten = []; renderAdvies(); });
  $("o-onder-druk").addEventListener("click", () => {
    if (!O.drukpunten.length) return;
    const xs = [...new Set(O.drukpunten.map(d => Math.round(d.x)))].sort((a, b) => a - b);
    O.sbPosTxt = xs.join(", "); O.sbAantal = null; renderAdvies();
  });
  const ov = $("o-overlay"); if (ov) ov.addEventListener("input", e => { O.overlay = +e.target.value; renderAdvies(); });

  // klik in het bovenaanzicht → drukpunt plaatsen
  const svg = $("svg-boven");
  if (svg) svg.addEventListener("click", e => {
    if (e.target.closest("[data-kind]")) return;                      // op balk/drukpunt geklikt
    const rect = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const px = (e.clientX - rect.left) * (vb.width / rect.width);
    const py = (e.clientY - rect.top) * (vb.height / rect.height);
    const ox = +svg.dataset.ox, oy = +svg.dataset.oy, s = +svg.dataset.s, w = +svg.dataset.w, h = +svg.dataset.h;
    if (svg._sleepte) { svg._sleepte = false; return; }               // net gesleept → geen nieuw punt
    const xcm = (px - ox) / s, ycm = (py - oy) / s;
    if (xcm < -2 || xcm > w + 2 || ycm < -2 || ycm > h + 2) return;   // buiten de kist
    O.drukpunten.push({ x: Math.max(0, Math.min(w, Math.round(xcm * 10) / 10)), y: Math.max(0, Math.min(h, Math.round(ycm * 10) / 10)), gewicht: 0 });
    renderAdvies();
  });
  if (svg) wireSleep(svg, res);

  // drukpunten-tabel wiring
  state.onderstel.drukpunten.forEach((d, i) => {
    const bind = (cls, key) => { const el = document.querySelector(`.${cls}[data-i="${i}"]`); if (el) el.addEventListener("change", e => { d[key] = +e.target.value || 0; renderAdvies(); }); };
    bind("dp-x", "x"); bind("dp-y", "y"); bind("dp-kg", "gewicht");
    const del = document.querySelector(`.dp-del[data-i="${i}"]`);
    if (del) del.addEventListener("click", () => { state.onderstel.drukpunten.splice(i, 1); renderAdvies(); });
  });
}

// zwaartepunt (center of gravity) uit drukpunten met gewicht
function zwaartepunt() {
  const d = (state.onderstel.drukpunten || []).filter(p => p.gewicht > 0);
  const W = d.reduce((a, p) => a + p.gewicht, 0);
  if (!W) return null;
  return { x: d.reduce((a, p) => a + p.gewicht * p.x, 0) / W, y: d.reduce((a, p) => a + p.gewicht * p.y, 0) / W, W };
}

// drukpunten-tabel (exacte X/Y/gewicht) + zwaartepunt-controle t.o.v. de balken
function drukTabelHTML(res) {
  const d = state.onderstel.drukpunten || [];
  if (!d.length) return "";
  const rows = d.map((p, i) => `<tr>
    <td>${i + 1}</td>
    <td><input class="dp-x" data-i="${i}" type="number" step="0.5" value="${p.x}"></td>
    <td><input class="dp-y" data-i="${i}" type="number" step="0.5" value="${p.y}"></td>
    <td><input class="dp-kg" data-i="${i}" type="number" step="1" value="${p.gewicht || 0}"></td>
    <td><button type="button" class="dp-del" data-i="${i}" title="verwijderen">×</button></td></tr>`).join("");
  const cog = zwaartepunt();
  let foot = "";
  if (cog) {
    const pos = (res.sb && res.sb.pos) ? res.sb.pos : [];
    const mn = Math.min(...pos), mx = Math.max(...pos);
    const binnen = pos.length && cog.x >= mn - 1 && cog.x <= mx + 1;
    const dichtst = pos.length ? Math.min(...pos.map(x => Math.abs(x - cog.x))) : null;
    foot = `<div class="druk-cog ${binnen ? "ok" : "waarsch"}">
      <strong>Zwaartepunt: X ${fmt(cog.x)} cm</strong> · totaal ${fmt(cog.W)} kg —
      ${binnen ? `✓ valt tussen de balken${dichtst != null ? ` (dichtstbijzijnde balk ${fmt(dichtst)} cm)` : ""}` : "⚠ valt buiten de balken — verplaats een balk eronder"}</div>`;
  } else {
    foot = `<div class="muted small">Vul het gewicht per drukpunt in voor het zwaartepunt en de balkcontrole.</div>`;
  }
  return `<table class="druk-lijst"><thead><tr><th>#</th><th>X cm</th><th>Y cm</th><th>kg</th><th></th></tr></thead><tbody>${rows}</tbody></table>${foot}`;
}

// slepen van drukpunten en heftruckbalken in het bovenaanzicht
function wireSleep(svg, res) {
  const O = state.onderstel;
  const geo = () => ({ ox: +svg.dataset.ox, oy: +svg.dataset.oy, s: +svg.dataset.s, w: +svg.dataset.w, h: +svg.dataset.h });
  const toCm = (e) => {
    const rect = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, g = geo();
    const px = (e.clientX - rect.left) * (vb.width / rect.width), py = (e.clientY - rect.top) * (vb.height / rect.height);
    return { x: (px - g.ox) / g.s, y: (py - g.oy) / g.s, g };
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v * 10) / 10));
  let drag = null;
  svg.addEventListener("pointerdown", e => {
    const t = e.target.closest("[data-kind]"); if (!t) return;
    drag = { kind: t.dataset.kind, i: +t.dataset.i, moved: false };
    if (drag.kind === "balk" && !O.sbPosTxt) O.sbPosTxt = (res.sb.pos || []).map(x => Math.round(x * 10) / 10).join(", ");
    try { svg.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  });
  svg.addEventListener("pointermove", e => {
    if (!drag) return;
    const { x, y, g } = toCm(e); drag.moved = true; svg._sleepte = true;
    if (drag.kind === "druk") {
      const d = O.drukpunten[drag.i]; if (!d) return;
      d.x = clamp(x, 0, g.w); d.y = clamp(y, 0, g.h);
      const grp = svg.querySelector(`g.tk-druk[data-i="${drag.i}"]`);
      if (grp) { const cx = g.ox + d.x * g.s, cy = g.oy + d.y * g.s; grp.querySelector("circle").setAttribute("cx", cx); grp.querySelector("circle").setAttribute("cy", cy); const tx = grp.querySelector("text"); tx.setAttribute("x", cx); tx.setAttribute("y", cy); }
    } else if (drag.kind === "balk") {
      const arr = O.sbPosTxt.split(/[,; ]+/).map(Number).filter(n => !isNaN(n));
      arr[drag.i] = clamp(x, 0, g.w); O.sbPosTxt = arr.join(", ");
      const rect = svg.querySelector(`rect.tk-sb2[data-i="${drag.i}"]`);
      if (rect) { const sbW = (+rect.getAttribute("width")) / g.s; rect.setAttribute("x", g.ox + (arr[drag.i] - sbW / 2) * g.s); }
      const lbl = svg.querySelector(`text.tk-sblabel[data-i="${drag.i}"]`);
      if (lbl) { lbl.setAttribute("x", g.ox + arr[drag.i] * g.s); lbl.textContent = fmt(arr[drag.i]); }
    }
  });
  const end = () => { if (drag) { const moved = drag.moved; drag = null; if (moved) renderAdvies(); } };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("pointerleave", end);
}

/* ============================ OPTIMALISEREN (zaagplan) ============================ */
// 1D afkorten: pak stukken (cm) in voorraadlengtes (First Fit Decreasing, beste lengte wint)
function pack1D(stukken, voorraad, kerf) {
  voorraad = voorraad.filter(l => l > 0).sort((a, b) => a - b);
  if (!voorraad.length || !stukken.length) return { stokken: [], teLang: [], benutting: 0, netto: 0, bruto: 0 };
  const maxL = voorraad[voorraad.length - 1];
  const teLang = stukken.filter(s => s > maxL);
  const ok = stukken.filter(s => s <= maxL).sort((a, b) => b - a);
  let beste = null;
  for (const basis of voorraad) {
    const stokken = [];
    for (const len of ok) {
      let st = stokken.find(s => s.gebruikt + len + (s.stukken.length ? kerf : 0) <= basis);
      if (!st) { st = { gebruikt: 0, stukken: [] }; stokken.push(st); }
      const pos = st.gebruikt + (st.stukken.length ? kerf : 0);
      st.stukken.push({ len, pos }); st.gebruikt = pos + len;
    }
    stokken.forEach(s => { s.lengte = voorraad.find(l => l >= s.gebruikt) || basis; s.rest = Math.round((s.lengte - s.gebruikt) * 10) / 10; });
    const bruto = stokken.reduce((a, s) => a + s.lengte, 0), netto = ok.reduce((a, l) => a + l, 0);
    if (!beste || (bruto - netto) < beste.afval) beste = { stokken, afval: bruto - netto, bruto, netto };
  }
  return { stokken: beste.stokken, teLang, benutting: beste.bruto ? beste.netto / beste.bruto : 0, netto: beste.netto, bruto: beste.bruto };
}

// 2D nesten — drie pogingen, de beste wint (minste platen, dan de leegste laatste plaat)
function prep2D(rects, SW, SH) {
  const items = rects.map(r => {
    let w = r.w, h = r.h;
    if (w > SW || h > SH) { const t = w; w = h; h = t; }   // draaien als het anders niet past
    return { w, h, naam: r.naam };
  }).filter(r => r.w <= SW + 0.01 && r.h <= SH + 0.01);
  return { items, teGroot: rects.length - items.length };
}
// a) strookgewijs (shelf / First-Fit Decreasing Height) — eenvoudig te zagen
function shelf2D(items, SW, SH, kerf) {
  items = items.slice().sort((a, b) => b.h - a.h);
  const sheets = [];
  const tryPlace = (s, it) => {
    for (const sh of s.shelves) {
      const x = sh.x + (sh.x > 0 ? kerf : 0);
      if (it.h <= sh.h + 0.01 && x + it.w <= SW + 0.01) {
        s.rects.push({ x, y: sh.y, w: it.w, h: it.h, naam: it.naam }); sh.x = x + it.w; return true;
      }
    }
    const last = s.shelves[s.shelves.length - 1];
    const y = last ? last.y + last.h + kerf : 0;
    if (y + it.h <= SH + 0.01) { s.shelves.push({ y, h: it.h, x: it.w }); s.rects.push({ x: 0, y, w: it.w, h: it.h, naam: it.naam }); return true; }
    return false;
  };
  for (const it of items) {
    let done = false;
    for (const s of sheets) if (tryPlace(s, it)) { done = true; break; }
    if (!done) { const s = { rects: [], shelves: [] }; sheets.push(s); tryPlace(s, it); }
  }
  return sheets;
}
// b) MaxRects (Best Short Side Fit, met rotatie) — dichter op elkaar
function maxRects2D(items, SW, SH, kerf, sortFn) {
  items = items.slice().sort(sortFn);
  const W = SW + kerf, H = SH + kerf;       // elk stuk krijgt een zaagsnede mee; de plaatrand niet
  const sheets = [];
  const nieuw = () => { const s = { rects: [], free: [{ x: 0, y: 0, w: W, h: H }] }; sheets.push(s); return s; };
  const zoek = (s, w, h) => {
    let best = null;
    for (const f of s.free) for (const [rw, rh] of [[w, h], [h, w]]) {
      if (rw <= f.w + 0.01 && rh <= f.h + 0.01) {
        const kort = Math.min(f.w - rw, f.h - rh), lang = Math.max(f.w - rw, f.h - rh);
        if (!best || kort < best.kort || (kort === best.kort && lang < best.lang)) best = { x: f.x, y: f.y, w: rw, h: rh, kort, lang };
      }
    }
    return best;
  };
  const plaats = (s, p) => {
    const nf = [];
    for (const f of s.free) {
      if (p.x >= f.x + f.w || p.x + p.w <= f.x || p.y >= f.y + f.h || p.y + p.h <= f.y) { nf.push(f); continue; }
      if (p.x > f.x) nf.push({ x: f.x, y: f.y, w: p.x - f.x, h: f.h });
      if (p.x + p.w < f.x + f.w) nf.push({ x: p.x + p.w, y: f.y, w: f.x + f.w - p.x - p.w, h: f.h });
      if (p.y > f.y) nf.push({ x: f.x, y: f.y, w: f.w, h: p.y - f.y });
      if (p.y + p.h < f.y + f.h) nf.push({ x: f.x, y: p.y + p.h, w: f.w, h: f.y + f.h - p.y - p.h });
    }
    // opruimen: vrije ruimtes die volledig binnen een andere vallen weg (bij duplicaten de eerste houden)
    const binnen = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    s.free = nf.filter((a, i) => a.w > 0.01 && a.h > 0.01 &&
      !nf.some((b, j) => j !== i && binnen(a, b) && (!binnen(b, a) || j < i)));
  };
  for (const it of items) {
    const w = it.w + kerf, h = it.h + kerf;
    let s = null, p = null;
    for (const sh of sheets) { p = zoek(sh, w, h); if (p) { s = sh; break; } }
    if (!p) { s = nieuw(); p = zoek(s, w, h); if (!p) continue; }
    plaats(s, p);
    s.rects.push({ x: p.x, y: p.y, w: p.w - kerf, h: p.h - kerf, naam: it.naam });
  }
  return sheets;
}
function pack2D(rects, SW, SH, kerf) {
  const { items, teGroot } = prep2D(rects, SW, SH);
  const netto = items.reduce((a, r) => a + r.w * r.h, 0);
  const pogingen = [
    { methode: "strookgewijs", sheets: shelf2D(items, SW, SH, kerf) },
    { methode: "MaxRects (oppervlak)", sheets: maxRects2D(items, SW, SH, kerf, (a, b) => b.w * b.h - a.w * a.h) },
    { methode: "MaxRects (langste zijde)", sheets: maxRects2D(items, SW, SH, kerf, (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h)) },
  ];
  // minste platen; bij gelijk: de laatste plaat zo leeg mogelijk (grootste herbruikbare rest)
  const laatsteVol = (sh) => sh.length ? sh[sh.length - 1].rects.reduce((a, r) => a + r.w * r.h, 0) : 0;
  const volgorde = pogingen.slice().sort((a, b) => a.sheets.length - b.sheets.length || laatsteVol(a.sheets) - laatsteVol(b.sheets));
  const beste = volgorde[0], bruto = beste.sheets.length * SW * SH;
  return { sheets: beste.sheets, aantal: beste.sheets.length, benutting: bruto ? netto / bruto : 0, netto, bruto, teGroot,
    methode: beste.methode, strook: pogingen[0].sheets.length };
}

/* ---- laden: containers / trailer (binnenmaten cm, deuropening cm, max. lading kg) ---- */
const LAADRUIMTES = {
  "20ft":    { naam: "20ft container",   L: 589,  B: 235, H: 239, deurB: 234, deurH: 228, kg: 28200 },
  "40ft":    { naam: "40ft container",   L: 1203, B: 235, H: 239, deurB: 234, deurH: 228, kg: 26700 },
  "40hc":    { naam: "40ft high cube",   L: 1203, B: 235, H: 269, deurB: 234, deurH: 258, kg: 26500 },
  "trailer": { naam: "Trailer 13,6 m",   L: 1360, B: 245, H: 270, deurB: 245, deurH: 270, kg: 24000 },
};
// beste vloerindeling: rijen in oriëntatie A over de lengte, de restlengte gevuld met gedraaide kisten
function vloerPlan(R, kL, kB) {
  let best = { n: 0, plaats: [] };
  for (const [a, b] of [[kL, kB], [kB, kL]]) {
    const perRijA = Math.floor(R.B / b);
    if (perRijA < 1) continue;
    const maxRijen = Math.floor(R.L / a);
    for (let rijen = maxRijen; rijen >= Math.max(0, maxRijen - 4); rijen--) {
      const restL = R.L - rijen * a;
      const perRijB = Math.floor(R.B / a), rijenB = perRijB >= 1 ? Math.floor(restL / b) : 0;
      const n = rijen * perRijA + perRijB * rijenB;
      if (n > best.n) {
        const plaats = [];
        for (let r = 0; r < rijen; r++) for (let c = 0; c < perRijA; c++) plaats.push({ x: r * a, y: c * b, l: a, b });
        for (let r = 0; r < rijenB; r++) for (let c = 0; c < perRijB; c++) plaats.push({ x: rijen * a + r * b, y: c * a, l: b, b: a });
        best = { n, plaats };
      }
    }
  }
  return best;
}
function laadPlan(res, key, O) {
  const R = LAADRUIMTES[key];
  const kL = Math.ceil(res.uL - 1e-9), kB = Math.ceil(res.uB - 1e-9), kH = Math.ceil(res.uH - 1e-9);
  const brutoKist = res.kpi.tarra + (+state.product.gewicht || 0);
  const pastDeur = kH <= R.deurH && Math.min(kL, kB) <= R.deurB;
  const vloer = vloerPlan(R, kL, kB);
  const lagen = Math.max(0, Math.min(Math.floor(R.H / kH), O.stapelen ? (O.maxLagen || 1) : 1));
  const capVol = vloer.n * lagen;
  const capKg = brutoKist > 0 ? Math.floor(R.kg / brutoKist) : capVol;
  const cap = pastDeur ? Math.min(capVol, capKg) : 0;
  const n = state.product.aantal;
  const units = cap > 0 ? Math.ceil(n / cap) : null;
  const inEerste = Math.min(n, cap);
  const volBenut = cap ? (inEerste * kL * kB * kH) / (R.L * R.B * R.H) : 0;
  const kgBenut = (inEerste * brutoKist) / R.kg;
  return { key, R, kL, kB, kH, brutoKist, pastDeur, vloer, lagen, capVol, capKg, cap, units, inEerste, volBenut, kgBenut,
    beperking: !pastDeur ? "past niet door de deur" : capVol === 0 ? "te groot" : capKg < capVol ? "gewicht" : "ruimte" };
}

function renderOptimalisatie() {
  const el = $("opt-inhoud");
  const code = state.gekozenCode;
  if (!code) { el.innerHTML = `<div class="banner waarsch"><span class="ic">⚠️</span><div>Ga eerst naar <strong>Adviseur</strong> en bepaal een kist; het zaagplan rekent op het geadviseerde type.</div></div>`; return; }
  const res = kistVoor(code); if (!res) { el.innerHTML = `<div class="banner fout"><span class="ic">⛔</span><div>Kon de kist niet berekenen.</div></div>`; return; }
  const n = state.product.aantal, O = state.opt;

  // groeperen
  const hout = {}, plaat = {};
  res.delen.forEach(d => {
    if (d.cat === "hout") {
      const key = `${fmt(d.b)}x${fmt(d.dk)}`;
      (hout[key] = hout[key] || { b: d.b, dk: d.dk, stukken: [], namen: new Set() });
      for (let i = 0; i < d.aantal * n; i++) hout[key].stukken.push(d.lengte);
      hout[key].namen.add(d.naam);
    } else {
      const key = `${d.matId || "plaat"}-${fmt(d.dk)}`;
      (plaat[key] = plaat[key] || { dk: d.dk, mat: d.mat || "Plaat", rects: [] });
      for (let i = 0; i < d.aantal * n; i++) plaat[key].rects.push({ w: d.lengte, h: d.b, naam: d.naam });
    }
  });

  // ---- 1D hout ----
  let totStokken = 0, houtHtml = "", houtInkoop = 0, houtNetto = 0;
  const inkoopRijen = [];
  Object.keys(hout).sort().forEach(key => {
    const g = hout[key], r = pack1D(g.stukken, O.voorraad, O.kerf);
    const pm = houtPrijsPerM(g);
    totStokken += r.stokken.length;
    houtInkoop += r.bruto / 100 * pm; houtNetto += r.netto / 100 * pm;
    // inkooplijst per voorraadlengte
    const perLengte = {};
    r.stokken.forEach(s => { perLengte[s.lengte] = (perLengte[s.lengte] || 0) + 1; });
    Object.keys(perLengte).sort((a, b) => a - b).forEach(l =>
      inkoopRijen.push({ wat: `Hout ${fmt(g.b)}×${fmt(g.dk)} cm`, maat: `${fmt(+l, 0)} cm`, aantal: perLengte[l], eenh: "st", bedrag: perLengte[l] * l / 100 * pm }));
    // identieke stokken groeperen
    const groepen = new Map();
    r.stokken.forEach(s => { const k = s.lengte + "|" + s.stukken.map(x => Math.round(x.len * 10)).join(","); if (!groepen.has(k)) groepen.set(k, { aantal: 0, s }); groepen.get(k).aantal++; });
    const bars = [...groepen.values()].map(({ aantal, s }) => stokBar(s, O, aantal)).join("");
    houtHtml += `<div class="opt-groep">
      <div class="opt-groep-kop">Profiel ${fmt(g.b)}×${fmt(g.dk)} cm <span class="muted small">(${[...g.namen].join(", ")})</span></div>
      <div class="opt-meta">${g.stukken.length} stuks · ${r.stokken.length} voorraadlengtes · benutting ${fmt(r.benutting * 100, 0)}% · rest ${fmt((r.bruto - r.netto) / 100)} m · ${euro(pm)}/m${r.teLang.length ? ` · <span class="rood">${r.teLang.length} te lang!</span>` : ""}</div>
      ${bars}</div>`;
  });

  // ---- 2D plaat ----
  let totPlaten = 0, plaatHtml = "", plaatInkoop = 0, plaatNetto = 0;
  const plaatM2 = O.plaatL * O.plaatB / 1e4;
  Object.keys(plaat).sort().forEach(key => {
    const g = plaat[key], r = pack2D(g.rects, O.plaatL, O.plaatB, O.kerf);
    totPlaten += r.aantal;
    plaatInkoop += r.aantal * plaatM2 * CONFIG.prijsPlaatM2; plaatNetto += r.netto / 1e4 * CONFIG.prijsPlaatM2;
    inkoopRijen.push({ wat: `${g.mat} ${fmt(g.dk)} cm`, maat: `${fmt(O.plaatL, 0)}×${fmt(O.plaatB, 0)} cm`, aantal: r.aantal, eenh: "plaat", bedrag: r.aantal * plaatM2 * CONFIG.prijsPlaatM2 });
    const sheets = r.sheets.slice(0, 8).map((s, i) => sheetSvg(s, O, i + 1)).join("");
    const winst = r.strook - r.aantal;
    plaatHtml += `<div class="opt-groep">
      <div class="opt-groep-kop">${esc(g.mat)} ${fmt(g.dk)} cm</div>
      <div class="opt-meta">${g.rects.length} panelen · ${r.aantal} platen (${fmt(O.plaatL)}×${fmt(O.plaatB)}) · benutting ${fmt(r.benutting * 100, 0)}% · methode: ${r.methode}${winst > 0 ? ` <span class="groen-txt">(${winst} ${winst > 1 ? "platen" : "plaat"} minder dan strookgewijs)</span>` : ""}${r.teGroot ? ` · <span class="rood">${r.teGroot} te groot!</span>` : ""}</div>
      <div class="opt-sheets">${sheets}</div>${r.aantal > 8 ? `<div class="muted small">…en nog ${r.aantal - 8} vergelijkbare platen</div>` : ""}</div>`;
  });

  // ---- materiaalkosten: netto (kostprijs-model) vs. inkoop volgens zaagplan ----
  const inkoop = houtInkoop + plaatInkoop, netto = houtNetto + plaatNetto, afval = inkoop - netto;
  const kostTabel = `
    <table class="lijst opt-inkoop">
      <thead><tr><th>Inkopen</th><th>Maat</th><th class="num">Aantal</th><th class="num">Bedrag</th></tr></thead>
      <tbody>${inkoopRijen.map(r => `<tr><td>${esc(r.wat)}</td><td>${r.maat}</td><td class="num">${r.aantal} ${r.eenh}</td><td class="num">${euro(r.bedrag)}</td></tr>`).join("")}</tbody>
      <tfoot>
        <tr><td colspan="3">Materiaal inkoop (hele lengtes/platen)</td><td class="num"><strong>${euro(inkoop)}</strong></td></tr>
        <tr class="muted"><td colspan="3">waarvan netto in de kist${n > 1 ? `en (× ${n})` : ""}</td><td class="num">${euro(netto)}</td></tr>
        <tr class="muted"><td colspan="3">waarvan zaagverlies / rest</td><td class="num">${euro(afval)} <small>(${fmt(inkoop ? afval / inkoop * 100 : 0, 0)}%)</small></td></tr>
      </tfoot>
    </table>
    <p class="muted small" style="margin:8px 0 0">Prijzen uit de kostprijs-aannames van de Adviseur (hout ${CONFIG.houtPrijzen && Object.keys(CONFIG.houtPrijzen).length ? "vaste €/m" : `afgeleid uit € ${fmt(CONFIG.houtBasisM3, 0)}/m³`}, plaat ${euro(CONFIG.prijsPlaatM2)}/m²). De kostprijs in het advies rekent netto; dit is wat je werkelijk inkoopt.</p>`;

  el.innerHTML = `
    <div class="opt-acties"><button class="btn ghost" id="opt-print">🖨️ Werkbon afdrukken</button></div>
    <div class="kpi-rij">
      <div class="kpi"><div class="lbl">Kist</div><div class="val" style="font-size:18px">${esc(code)}${n > 1 ? ` <small>× ${n}</small>` : ""}</div></div>
      <div class="kpi"><div class="lbl">Hout — voorraadlengtes</div><div class="val">${totStokken}</div></div>
      <div class="kpi"><div class="lbl">Platen</div><div class="val">${totPlaten}</div></div>
      <div class="kpi accent"><div class="lbl">Materiaal inkoop</div><div class="val" style="font-size:20px">${euro(inkoop)}</div></div>
    </div>
    ${houtHtml ? `<div class="kaart"><div class="kaart-kop">Hout afkorten <span class="muted small">1D-zaagplan</span></div><div class="kaart-body">${houtHtml}</div></div>` : ""}
    ${plaatHtml ? `<div class="kaart" style="margin-top:18px"><div class="kaart-kop">Platen nesten <span class="muted small">2D-zaagplan</span></div><div class="kaart-body">${plaatHtml}</div></div>` : ""}
    ${!houtHtml && !plaatHtml ? `<p class="muted">Geen onderdelen gevonden.</p>` : ""}
    ${inkoopRijen.length ? `<div class="kaart" style="margin-top:18px"><div class="kaart-kop">Inkooplijst &amp; materiaalkosten</div><div class="kaart-body">${kostTabel}</div></div>` : ""}
    <div class="kaart opt-laden" style="margin-top:18px"><div class="kaart-kop">Laden <span class="muted small">container / trailer</span></div><div class="kaart-body">${ladenHTML(res)}</div></div>`;
  $("opt-print").addEventListener("click", () => window.print());
  wireLaden();
}

// ---- laadplanning: vergelijk alle laadruimtes + plattegrond van de gekozen ----
function ladenHTML(res) {
  const O = state.opt, n = state.product.aantal;
  const plannen = Object.keys(LAADRUIMTES).map(k => laadPlan(res, k, O));
  const pl = plannen.find(p => p.key === O.eenheid) || plannen[0];
  const rijen = plannen.map(p => `
    <tr class="${p.key === pl.key ? "actief" : ""}" data-eenheid="${p.key}">
      <td><strong>${p.R.naam}</strong><br><span class="muted small">${fmt(p.R.L, 0)}×${fmt(p.R.B, 0)}×${fmt(p.R.H, 0)} cm</span></td>
      <td class="num">${p.cap ? `${p.vloer.n} × ${p.lagen}` : "—"}</td>
      <td class="num"><strong>${p.cap || "—"}</strong></td>
      <td class="num">${p.units ?? "—"}</td>
      <td class="num">${p.cap ? fmt(p.volBenut * 100, 0) + "%" : "—"}</td>
      <td>${p.cap ? `<span class="muted small">beperkt door ${p.beperking}</span>` : `<span class="rood">${p.beperking}</span>`}</td>
    </tr>`).join("");
  return `
    <div class="rij3 laad-inst">
      <div class="veld"><label>Laadruimte</label><select id="opt-eenheid">${Object.keys(LAADRUIMTES).map(k => `<option value="${k}" ${k === pl.key ? "selected" : ""}>${LAADRUIMTES[k].naam}</option>`).join("")}</select></div>
      <div class="veld"><label class="vink" style="margin-top:22px"><input type="checkbox" id="opt-stapel" ${O.stapelen ? "checked" : ""}><span>Kisten stapelbaar</span></label></div>
      <div class="veld"><label>Max. lagen</label><input type="number" id="opt-lagen" min="1" max="5" value="${O.maxLagen}" ${O.stapelen ? "" : "disabled"}></div>
    </div>
    <p class="muted small" style="margin:0 0 10px">Kist ${fmt(pl.kL, 0)}×${fmt(pl.kB, 0)}×${fmt(pl.kH, 0)} cm · bruto ${fmt(pl.brutoKist, 0)} kg per kist · ${n} kist${n > 1 ? "en" : ""} te verladen.</p>
    <table class="lijst laad-tabel">
      <thead><tr><th>Laadruimte</th><th class="num">Vloer × lagen</th><th class="num">Per stuk</th><th class="num">Nodig</th><th class="num">Vulling</th><th></th></tr></thead>
      <tbody>${rijen}</tbody>
    </table>
    ${pl.cap ? laadSvg(pl) : `<div class="banner fout" style="margin-top:12px"><span class="ic">⛔</span><div>Deze kist past niet in een ${pl.R.naam} (${pl.beperking}).</div></div>`}`;
}

function laadSvg(p) {
  const R = p.R, n = state.product.aantal;
  const W = 760, sc = (W - 20) / R.L, H = R.B * sc;
  const perLaag = p.vloer.n, inEerste = p.inEerste;
  // per vloerpositie: hoeveel kisten staan erop (gestapeld)
  const stapel = p.vloer.plaats.map((_, i) => { let c = 0; for (let l = 0; l < p.lagen; l++) if (l * perLaag + i < inEerste) c++; return c; });
  const kisten = p.vloer.plaats.map((k, i) => {
    const c = stapel[i], x = 10 + k.x * sc, y = 10 + k.y * sc, w = k.l * sc, h = k.b * sc;
    return `<rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="${h - 2}" class="${c ? "laad-kist" : "laad-leeg"}"/>
      ${c && w > 26 ? `<text x="${x + w / 2}" y="${y + h / 2}" class="laad-txt">${c > 1 ? c + "×" : ""}${fmt(k.l, 0)}×${fmt(k.b, 0)}</text>` : ""}`;
  }).join("");
  const kgVol = inEerste * p.brutoKist;
  return `
    <div class="laad-plan">
      <svg viewBox="0 0 ${W} ${H + 34}" class="laad-svg" style="max-width:${Math.max(45, R.L / 1360 * 100)}%">
        <rect x="10" y="10" width="${R.L * sc}" height="${H}" class="laad-ruimte"/>
        ${kisten}
        <line x1="${10 + R.L * sc}" y1="10" x2="${10 + R.L * sc}" y2="${10 + H}" class="laad-deur"/>
        <text x="${10 + R.L * sc - 4}" y="${H + 26}" class="laad-lbl" text-anchor="end">deuren →</text>
        <text x="10" y="${H + 26}" class="laad-lbl">${R.naam} · bovenaanzicht · ${inEerste} kist${inEerste > 1 ? "en" : ""} in de eerste${p.units > 1 ? ` (totaal ${p.units} nodig, laatste met ${n - (p.units - 1) * p.cap})` : ""}</text>
      </svg>
      <div class="laad-meters">
        <div><span class="lbl">Volume</span><div class="meter"><i style="width:${Math.min(100, p.volBenut * 100)}%"></i></div><span>${fmt(p.volBenut * 100, 0)}%</span></div>
        <div><span class="lbl">Gewicht</span><div class="meter ${p.kgBenut > 0.95 ? "vol" : ""}"><i style="width:${Math.min(100, p.kgBenut * 100)}%"></i></div><span>${fmt(kgVol, 0)} / ${fmt(R.kg, 0)} kg</span></div>
      </div>
      ${p.lagen > 1 ? `<p class="muted small" style="margin:6px 0 0">Gestapeld tot ${p.lagen} lagen — controleer of de kistdeksel de bovenlast (${fmt(p.brutoKist * (p.lagen - 1), 0)} kg) kan dragen.</p>` : ""}
    </div>`;
}

function wireLaden() {
  const sel = $("opt-eenheid"); if (!sel) return;
  sel.addEventListener("change", () => { state.opt.eenheid = sel.value; renderOptimalisatie(); });
  $("opt-stapel").addEventListener("change", e => { state.opt.stapelen = e.target.checked; renderOptimalisatie(); });
  $("opt-lagen").addEventListener("change", e => { state.opt.maxLagen = Math.max(1, Math.min(5, +e.target.value || 1)); renderOptimalisatie(); });
  document.querySelectorAll(".laad-tabel tbody tr").forEach(tr =>
    tr.addEventListener("click", () => { state.opt.eenheid = tr.dataset.eenheid; renderOptimalisatie(); }));
}

// visuele voorraadlengte-balk (1D)
function stokBar(s, O, aantal) {
  const W = 620, H = 26, pad = 2, maxL = Math.max(...O.voorraad);
  const sc = (W - 70) / maxL;
  const segs = s.stukken.map(st =>
    `<rect x="${pad + st.pos * sc}" y="${pad}" width="${Math.max(st.len * sc - 1, 1)}" height="${H - 2 * pad}" class="opt-seg"/>
     <text x="${pad + (st.pos + st.len / 2) * sc}" y="${H / 2 + 3}" class="opt-seg-txt">${fmt(st.len)}</text>`).join("");
  const rest = s.rest > 0.5 ? `<rect x="${pad + s.gebruikt * sc}" y="${pad}" width="${Math.max((s.lengte - s.gebruikt) * sc - 1, 1)}" height="${H - 2 * pad}" class="opt-rest"/>` : "";
  return `<div class="opt-bar-rij"><span class="opt-bar-aantal">${aantal}×</span>
    <svg viewBox="0 0 ${W} ${H}" class="opt-bar"><rect x="0" y="0" width="${s.lengte * sc + pad * 2}" height="${H}" class="opt-stok"/>${segs}${rest}</svg>
    <span class="opt-bar-info muted small">${fmt(s.lengte)} cm · rest ${fmt(s.rest)}</span></div>`;
}

// visuele plaat met panelen (2D)
function sheetSvg(s, O, nr) {
  const target = 150, sc = target / Math.max(O.plaatL, O.plaatB);
  const W = O.plaatL * sc, H = O.plaatB * sc;
  const rects = s.rects.map(r =>
    `<rect x="${r.x * sc}" y="${r.y * sc}" width="${r.w * sc}" height="${r.h * sc}" class="opt-paneel"/>
     <text x="${(r.x + r.w / 2) * sc}" y="${(r.y + r.h / 2) * sc}" class="opt-paneel-txt">${fmt(r.w)}×${fmt(r.h)}</text>`).join("");
  return `<figure class="opt-sheet"><svg viewBox="-1 -1 ${W + 2} ${H + 2}"><rect x="0" y="0" width="${W}" height="${H}" class="opt-plaat"/>${rects}</svg><figcaption>plaat ${nr}</figcaption></figure>`;
}

function wireOpt() {
  const lees = () => {
    const vr = $("opt-voorraad").value.split(/[,; ]+/).map(Number).filter(x => x > 0);
    if (vr.length) state.opt.voorraad = vr;
    const pl = $("opt-plaat").value.split(/[x×,; ]+/i).map(Number).filter(x => x > 0);
    if (pl.length >= 2) { state.opt.plaatL = pl[0]; state.opt.plaatB = pl[1]; }
    state.opt.kerf = Math.max(0, +$("opt-kerf").value || 0);
    renderOptimalisatie();
  };
  ["opt-voorraad", "opt-plaat", "opt-kerf"].forEach(id => $(id).addEventListener("change", lees));
}

/* ============================ MODULE-NAV ============================ */
function toonModule(naam) {
  ["ontwikkelen", "tekenen", "optimaliseren", "bestellen"].forEach(m =>
    $("mod-" + m).classList.toggle("hidden", m !== naam));
  document.querySelectorAll("#modnav button").forEach(b =>
    b.classList.toggle("actief", b.dataset.mod === naam));
  if (naam === "optimaliseren") renderOptimalisatie();
}
document.querySelectorAll("#modnav button").forEach(b => {
  if (!b.disabled) b.addEventListener("click", () => toonModule(b.dataset.mod));
});

/* ============================ START ============================ */
wireUpload();
wireMeet();
wireOpt();
$("naar-2").addEventListener("click", () => { leesStap1(); toonStap(2); });
function resetOnderstel() { state.onderstel = { sbAantal: null, sbPosTxt: "", drukpunten: [], overlay: 0.65 }; }
$("naar-3").addEventListener("click", () => { leesStap2(); state.gekozenType = null; state.gekozenFam = null; resetOnderstel(); toonStap(3); });
$("terug-1").addEventListener("click", () => toonStap(1));
$("terug-2").addEventListener("click", () => toonStap(2));
$("opnieuw").addEventListener("click", () => { state.gekozenType = null; state.gekozenFam = null; resetOnderstel(); toonStap(1); });
$("btn-print").addEventListener("click", () => window.print());
document.querySelectorAll("#stepper li").forEach(li =>
  li.addEventListener("click", () => { const s = +li.dataset.step; if (s < state.stap) toonStap(s); }));
toonStap(1);
