// ════════════════════════════════════════════════════════════════════
//  STEMMA FAZI LEAGUE — unica fonte per tutte le versioni dello stemma
// ════════════════════════════════════════════════════════════════════
//  Genera in public/:
//    stemma.svg            stemma completo (intestazione, caricamento, splash)
//    favicon.svg           versione semplificata per la scheda del browser
//    favicon-32.png        stessa, in PNG per i browser che non leggono SVG
//    icon-192/512.png      icone dell'app (purpose "any")
//    icon-maskable-*.png   icone con margine di sicurezza per Android (purpose "maskable")
//    apple-touch-icon.png  icona per la Home di iPhone
//
//  Le scritte sono convertite in tracciati (font Oswald), così lo stemma
//  appare identico ovunque, anche senza font caricati.
//
//  Per rigenerare dopo una modifica:
//    npm i --no-save opentype.js @resvg/resvg-js @fontsource/oswald
//    node scripts/genera-stemma.mjs
// ════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import opentype from "opentype.js";
import { Resvg } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);
const OUT = new URL("../public/", import.meta.url);
const fontFile = (w) => require.resolve(`@fontsource/oswald/files/oswald-latin-${w}-normal.woff`);
const loadFont = (w) => { const b = readFileSync(fontFile(w)); return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); };
const OSWALD_700 = loadFont(700);
const OSWALD_500 = loadFont(500);

// ─── Colori (gli stessi dell'app) ───
const C = {
  night: "#101010", pitch: "#080808", ink: "#030303",
  green1: "#1f4a33", green2: "#0b1d14",
  gold1: "#fde68a", gold2: "#eab308", gold3: "#b45309",
  silver1: "#f8fafc", silver2: "#94a3b8",
};

const f = (n) => +n.toFixed(2);

// Testo → tracciato SVG centrato su cx, con spaziatura tra le lettere (in unità SVG)
function textPath(font, text, cx, baseline, size, spacing) {
  const scale = size / font.unitsPerEm;
  const glyphs = [...text].map((ch) => font.charToGlyph(ch));
  const total = glyphs.reduce((w, g) => w + g.advanceWidth * scale, 0) + spacing * (glyphs.length - 1);
  let x = cx - total / 2;
  return glyphs.map((g) => {
    const d = g.getPath(x, baseline, size).toPathData(2);
    x += g.advanceWidth * scale + spacing;
    return d;
  }).join("");
}

// Stella a 5 punte
function star(cx, cy, R, r = R * 0.45) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    pts.push(`${f(cx + rad * Math.cos(a))},${f(cy + rad * Math.sin(a))}`);
  }
  return `M${pts.join("L")}Z`;
}

// Scudo: punta in alto al centro, fianchi dritti, punta in basso. "i" = rientro dal bordo.
function shield(i = 0) {
  const top = 8 + i * 1.15, sh = 54 + i * 0.55, side = 22 + i, mid = 160, bot = 272 - i * 1.25;
  return `M120 ${f(top)}L${f(240 - side)} ${f(sh)}L${f(240 - side)} ${mid}Q${f(240 - side)} ${f(230 - i * 0.6)} 120 ${f(bot)}Q${f(side)} ${f(230 - i * 0.6)} ${f(side)} ${mid}L${f(side)} ${f(sh)}Z`;
}

// Airone (simbolo di Fazi) in posa araldica: di fronte, ali aperte, su una zampa sola,
// testa di profilo rivolta a sinistra. Coordinate locali con lo 0 al centro del corpo;
// (x, y) = dove va lo 0, k = scala. Ingombro: x da -56 a 56, y da -21 a 80.
function heron(x, y, k) {
  // ala destra; la sinistra è la stessa specchiata
  const wing = "M5 18C12 4 30 -10 56 -20L47 -10L54 -8L45 0L51 3L41 8.5L45.5 12L35 15.5L37.5 20L26 22L27 26.5L9 30Z";
  const coverts = "M9 25C19 15 31 5 47 -7";
  const body = "M0 15C5 17 6.5 27 6 36C5.5 44 3 50 0 54C-3 50 -5.5 44 -6 36C-6.5 27 -5 17 0 15Z";
  const tail = "M-5 50L0 62L5 50Z";
  const neck = "M0 17C4.5 10 4.5 4 1 -2C-2 -6.5 -1.5 -10 1 -12.5";
  const head = "M-2.5 -17.5C0 -20 4 -19.5 5 -16.5L16 -20L5.2 -14C4.6 -11.5 2 -10.5 -0.5 -11.5L-21 -13.6Z";
  const legs = "M2 53L2 78M-4.5 79.5L2 78L7.5 79.5M-2 52L-10 61L-2.5 65.5";
  const g = 'fill="url(#fl-gold-v)"';
  return `
  <g transform="translate(${f(x)} ${f(y)}) scale(${k})">
    <path d="${legs}" stroke="url(#fl-gold-v)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="${wing}" ${g}/>
    <path d="${wing}" ${g} transform="scale(-1 1)"/>
    <path d="${coverts}" stroke="${C.green2}" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".45"/>
    <path d="${coverts}" stroke="${C.green2}" stroke-width="1.3" stroke-linecap="round" fill="none" opacity=".45" transform="scale(-1 1)"/>
    <path d="${tail}" ${g}/>
    <path d="${body}" ${g}/>
    <path d="${neck}" stroke="url(#fl-gold-v)" stroke-width="4.5" stroke-linecap="round" fill="none"/>
    <path d="${head}" ${g}/>
    <circle cx="0.6" cy="-15.6" r="1.1" fill="${C.green2}"/>
  </g>`;
}

const defs = `
  <defs>
    <linearGradient id="fl-field" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.green1}"/><stop offset="1" stop-color="${C.green2}"/>
    </linearGradient>
    <linearGradient id="fl-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.gold1}"/><stop offset=".5" stop-color="${C.gold2}"/><stop offset="1" stop-color="${C.gold3}"/>
    </linearGradient>
    <linearGradient id="fl-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.gold1}"/><stop offset=".55" stop-color="${C.gold2}"/><stop offset="1" stop-color="${C.gold3}"/>
    </linearGradient>
    <linearGradient id="fl-gold-v" x1="0" y1="-21" x2="0" y2="80" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${C.gold1}"/><stop offset=".6" stop-color="${C.gold2}"/><stop offset="1" stop-color="${C.gold3}"/>
    </linearGradient>
    <linearGradient id="fl-silver" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.silver1}"/><stop offset="1" stop-color="${C.silver2}"/>
    </linearGradient>
    <clipPath id="fl-inner"><path d="${shield(9)}"/></clipPath>
  </defs>`;

// Righe del campo dentro lo scudo
const stripes = (() => {
  let d = "";
  for (let x = 22; x < 218; x += 28) d += `M${x} 0h14v280h-14z`;
  return `<path d="${d}" fill="#ffffff" opacity=".035" clip-path="url(#fl-inner)"/>`;
})();

// ─── Stemma completo ───
function crest() {
  const stars = [[92, 52, 6.5], [120, 45, 8.5], [148, 52, 6.5]].map(([x, y, r]) => star(x, y, r)).join("");
  return `
  <path d="${shield(0)}" fill="url(#fl-rim)"/>
  <path d="${shield(9)}" fill="url(#fl-field)"/>
  ${stripes}
  <path d="${shield(16)}" fill="none" stroke="url(#fl-gold)" stroke-width="1.2" opacity=".45"/>
  <path d="${stars}" fill="${C.gold2}"/>
  <path d="M62 72Q120 54 178 72" fill="none" stroke="url(#fl-gold)" stroke-width="2.2" stroke-linecap="round"/>
  <path d="${textPath(OSWALD_700, "FAZI", 120, 146, 78, 7)}" fill="url(#fl-silver)"/>
  <path d="M50 160h40M150 160h40" stroke="url(#fl-gold)" stroke-width="2" stroke-linecap="round"/>
  <path d="${textPath(OSWALD_500, "LEAGUE", 120, 169.5, 23, 7.5)}" fill="url(#fl-gold)"/>
  ${heron(120, 173 + 21 * 0.73, 0.73)}`;
}

// ─── Versione piccola (favicon): scudo, bordo oro, "F" ───
function crestMini() {
  return `
  <path d="${shield(0)}" fill="url(#fl-rim)"/>
  <path d="${shield(16)}" fill="url(#fl-field)"/>
  <path d="${textPath(OSWALD_700, "F", 120, 205, 150, 0)}" fill="url(#fl-silver)"/>`;
}

const svg = (body, vb = "0 0 240 280", extra = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${extra}>${defs}${body}\n</svg>\n`;

// Icona quadrata: sfondo dell'app + stemma centrato alto "h" su 512
function iconSvg(h, mini = false) {
  const s = h / 280, w = 240 * s;
  const x = (512 - w) / 2, y = (512 - h) / 2 + h * 0.01;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${defs}
  <linearGradient id="fl-bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${C.night}"/><stop offset=".5" stop-color="${C.pitch}"/><stop offset="1" stop-color="${C.ink}"/>
  </linearGradient>
  <rect width="512" height="512" fill="url(#fl-bg)"/>
  <radialGradient id="fl-glow" cx=".5" cy=".46" r=".5"><stop offset="0" stop-color="#16a34a" stop-opacity=".22"/><stop offset="1" stop-color="#16a34a" stop-opacity="0"/></radialGradient>
  <rect width="512" height="512" fill="url(#fl-glow)"/>
  <g transform="translate(${f(x)} ${f(y)}) scale(${f(s * 1000) / 1000})">${mini ? crestMini() : crest()}</g>
</svg>\n`;
}

const png = (svgText, size) => new Resvg(svgText, { fitTo: { mode: "width", value: size } }).render().asPng();
const write = (name, data) => { writeFileSync(new URL(name, OUT), data); console.log("✓", name); };

const crestSvg = svg(crest());
const miniSvg = svg(crestMini());
write("stemma.svg", crestSvg);
write("favicon.svg", miniSvg);
// favicon PNG: scudo su quadrato trasparente
write("favicon-32.png", png(svg(crestMini(), "-20 0 280 280"), 32));
// "any": stemma grande; "maskable": dentro il cerchio di sicurezza (80% centrale)
const anySvg = iconSvg(420), maskSvg = iconSvg(320);
write("icon-512.png", png(anySvg, 512));
write("icon-192.png", png(anySvg, 192));
write("icon-maskable-512.png", png(maskSvg, 512));
write("icon-maskable-192.png", png(maskSvg, 192));
write("apple-touch-icon.png", png(iconSvg(400), 180));
