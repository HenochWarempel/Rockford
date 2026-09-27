# Rockford

Een eigen, speelbare interpretatie van het klassieke *Boulder Dash* / *Rockford*
(zoals op [classicreload.com/rockford.html](https://classicreload.com/rockford.html)),
gebouwd als installeerbare **web-app voor mobiel (Android)**. Geen app store,
geen build-stap — puur HTML/CSS/JS.

## Spelprincipe

Graaf door aarde, verzamel genoeg diamanten om de uitgang te openen en haal die
uitgang voordat de tijd om is. Rotsblokken kun je opzij duwen, maar ze vallen
naar beneden en verpletteren je als je eronder staat. Vanaf grot B kom je
vuurvliegjes en vlinders tegen (dodelijk bij aanraking, maar je kunt ze
verpletteren met een vallend rotsblok — vlinders laten dan diamanten achter).
Vanaf grot D groeit er ook een levende, dodelijke amoebe.

Er zijn 6 grotten, elk groter en moeilijker dan de vorige, met een score,
levens en een countdown-timer.

## Bestanden

- `index.html` — pagina-structuur, HUD en het touch-D-pad
- `style.css` — mobiel-eerst styling (dark theme, safe-area insets)
- `game.js` — de hele game-engine: level-generatie, fysica, AI, rendering
- `manifest.json` + `service-worker.js` — maakt de site installeerbaar en
  offline speelbaar (PWA)
- `icons/` — app-iconen (gegenereerd, geen externe afbeeldingen nodig)

## Lokaal uitproberen

Omdat de service worker en manifest een echte HTTP-origin nodig hebben (niet
`file://`), start je een simpele statische server in deze map:

```bash
python3 -m http.server 8000
```

Open daarna `http://localhost:8000` op je Android-telefoon (zelfde wifi-netwerk
als je computer, of gebruik `adb reverse`), of in Chrome op je computer via de
mobiele device-toolbar voor een preview.

## Als Android-app installeren

1. Host deze map ergens met **HTTPS** (bijv. GitHub Pages, Netlify, Vercel,
   Cloudflare Pages — allemaal gratis en zonder server-code nodig, want het is
   pure statische HTML/JS).
2. Open de URL in **Chrome op Android**.
3. Tik op het menu (⋮) → **"App toevoegen aan startscherm"** /
   **"Installeren"**.
4. Rockford verschijnt als een volwaardig app-icoon en start in fullscreen
   (staande stand), inclusief offline-ondersteuning dankzij de service worker.

## Besturing

- **Mobiel:** het D-pad onderin het scherm (duwen op een rotsblok = duwen,
  lopen tegen aarde = graven).
- **Desktop (voor testen):** pijltjestoetsen of WASD, `Esc`/`P` voor pauze.

## Techniek in het kort

- Elke grot wordt **proceduraal** gegenereerd met een seed per levelnummer
  (dus altijd hetzelfde grot-ontwerp per level, wel steeds anders dan het
  vorige level).
- Spelfysica draait op een vaste logica-tick (~170 ms): vallende/rollende
  rotsblokken en diamanten, vuurvliegjes/vlinders met klassieke
  wand-volg-AI, en een groeiende amoebe.
- Rendering gebeurt op een `<canvas>` met een camera die de speler op ieder
  schermformaat soepel blijft volgen (mobiel, tablet, desktop, staand en
  liggend).
