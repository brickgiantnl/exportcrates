# Export Crates

Web-app voor het **ontwikkelen, tekenen, optimaliseren en (later) bestellen** van
exportkisten. Je voert een product in (afmetingen + gewicht), kiest bestemming en
vrachtsoort (zee/lucht), en de app stelt een kisttype voor met ontwerp, tekening,
optimalisatie en kostprijs.

Losstaand van het kistenportal — eigen domein **exportcrates.nl**.

## Lokaal draaien

De app is volledig **statisch** (geen server, geen database nodig). Twee manieren:

1. **Dubbelklikken** op `index.html` — werkt direct in de browser.
2. **Met een mini-webserver** (aanbevolen, voorkomt browserbeperkingen):
   ```
   npx serve .
   ```
   of met Python:
   ```
   python -m http.server 8077
   ```
   Open daarna http://localhost:8077

## Structuur

| Bestand | Doel |
|---|---|
| `index.html` | App-shell + adviseur-wizard |
| `app.js` | Schermlogica + keuzeregels (CONFIG bovenin) |
| `engine.js` | Rekenmotor (uitwendige maat, gewicht, zaaglijst) — gevalideerd voor KS322 |
| `app.css` | Huisstijl |
| `data/types.js` | Alle 177 kisttypes (profielmaten per onderdeel) |
| `data/typecodes.js` | Betekenis van de typecodes + gewichtsklassen |

## Deploy (statische site)

Geen build-stap nodig. Publiceer de **hele map** als statische site:
- **Render Static Site:** Publish directory = `.`, Build command = *(leeg)*.
- **Cloudflare Pages / Netlify:** Output directory = `/` (root), geen build command.

Daarna domein `exportcrates.nl` koppelen via het hosting-dashboard + DNS.

**Belangrijk — cache-busting:** de scripts/stylesheet in `index.html` hebben een
`?v=…`-versie. **Hoog die op bij elke wijziging** (bijv. de datum + een letter),
anders laden terugkerende bezoekers de oude (gecachete) versie.

## Status / nog te doen

- Keuzeregels (gewichtsklasse, speling) en kostprijs-tarieven zijn een **voorzet** —
  staan instelbaar bovenin `app.js` (CONFIG) en in `data/typecodes.js`.
- Later: tekening automatisch uitlezen, optimalisatie-module, bestel-module (met
  backend + database).
