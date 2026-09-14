'use strict';
/*
 * Bouwt de Pitwall-pagina voor lee-ai.nl uit dezelfde bron als het artifact.
 *
 * De pagina komt NIET als los bestand in de website-repo: dan zou de CDN hem
 * kunnen uitleveren buiten de wachtwoordcontrole om. In plaats daarvan wordt hij
 * als base64 in netlify/lib/pitwall-html.js gezet, en levert de edge function
 * hem pas uit na een geldige login.
 *
 * Verschil met de versie op claude.ai:
 *  - altijd lichte weergave, ongeacht de systeeminstelling van de bezoeker
 *  - opslag van een goedgekeurde opstelling via localStorage in plaats van de
 *    db-capability van claude.ai
 *
 * Gebruik: node src/build-pitwall.js [pad-naar-bron.html]
 */
const fs = require('fs');
const path = require('path');

// De bron hoort naast dit script te staan, niet in een tijdelijke map: een
// scratchpad wordt opgeruimd en dan is de pagina niet meer te bouwen.
const STANDAARD_BRON = path.join(__dirname, 'pitwall-source.html');
const DOEL = path.join(__dirname, '..', '..', 'lee-ai-website', 'netlify', 'lib', 'pitwall-html.js');

const bron = process.argv[2] || STANDAARD_BRON;
if (!fs.existsSync(bron)) {
  console.error('Bron niet gevonden: ' + bron);
  process.exit(1);
}
const inhoud = fs.readFileSync(bron, 'utf8');

// De pagina rekent haar verwachtingen niet zelf uit maar leest ze in. Ze worden
// hier ingespoten zodat er één model is: expectations.js gebruikt dezelfde motor
// als optimize.js. Ontbreekt het bestand, dan stoppen we — een pagina zonder
// VERWACHT toont niets en dat merk je pas online.
const verwachtPad = path.join(__dirname, '..', 'data', 'expectations.json');
if (!fs.existsSync(verwachtPad)) {
  console.error('data/expectations.json ontbreekt. Draai eerst: node src/expectations.js');
  process.exit(1);
}
const verwacht = fs.readFileSync(verwachtPad, 'utf8');
const verwachtBlok = '<script>\nwindow.VERWACHT = ' + verwacht.trim() + ';\n</script>\n';

const kop = `<!doctype html>
<html lang="nl" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<style>
  html{color-scheme:light}
  body{margin:0}
  img{max-width:100%}
  [hidden]{display:none!important}
</style>
<script>
/* Op claude.ai bewaart de pagina een goedgekeurde opstelling via window.claude.
   Hier bestaat dat niet, dus vullen we hetzelfde kleine contract in met
   localStorage. Daardoor blijft "Goedkeuren" staan als je de pagina opnieuw
   opent. De opslag is per apparaat en per browser. */
if (!window.claude) {
  window.claude = {
    use: async (naam) => naam !== 'db' ? null : {
      doc: (pad) => ({
        get: async () => {
          let waarde = null;
          try { waarde = localStorage.getItem('pitwall:' + pad); } catch (e) {}
          return { exists: waarde != null, data: () => waarde ? JSON.parse(waarde) : undefined };
        },
        set: async (gegevens) => {
          try { localStorage.setItem('pitwall:' + pad, JSON.stringify(gegevens)); } catch (e) {}
        }
      })
    }
  };
}
</script>
`;

// De bron begint met <title>, <link> en <style> — die horen in de head. Het
// document zelf begint bij <header class="top">.
const splitsing = inhoud.indexOf('<header class="top">');
if (splitsing < 0) {
  console.error('Kon <header class="top"> niet vinden in de bron; opbouw onverwacht.');
  process.exit(1);
}
const head = inhoud.slice(0, splitsing);
const body = inhoud.slice(splitsing);

const pagina = kop + head + verwachtBlok + '</head>\n<body>\n' + body + '\n</body>\n</html>\n';

const b64 = Buffer.from(pagina, 'utf8').toString('base64');
const moduleTekst =
  '// De Pitwall-pagina, opgeslagen als base64 binnen de edge function.\n' +
  '// Bewust NIET als los bestand in de publicatiemap: dan zou de CDN het kunnen\n' +
  '// uitleveren buiten de wachtwoordcontrole om, zoals eerder gebeurde via /pitwall/.\n' +
  '// Gegenereerd met f1meester/src/build-pitwall.js — niet met de hand aanpassen.\n' +
  'export default "' + b64 + '";\n';

fs.mkdirSync(path.dirname(DOEL), { recursive: true });
fs.writeFileSync(DOEL, moduleTekst);

// Ook als los bestand wegschrijven, puur om lokaal te controleren of de pagina
// rendert vóór je pusht. Een JS-fout maakt hem namelijk helemaal leeg, en dat
// zie je online pas achter het wachtwoord. Deze map hoort niet in de website-repo.
const preview = path.join(__dirname, '..', 'dist', 'pitwall-preview.html');
fs.mkdirSync(path.dirname(preview), { recursive: true });
fs.writeFileSync(preview, pagina);

// Versie voor het artifact op claude.ai: zonder eigen <html>/<head> (die zet het
// artifact er zelf omheen), licht via de bron zelf en zonder de
// localStorage-vervanger, want daar bestaat window.claude echt. Wel met dezelfde
// ingespoten verwachtingen, anders loopt het artifact achter op het model.
const artifact = path.join(__dirname, '..', 'dist', 'pitwall-artifact.html');
fs.writeFileSync(artifact, head + verwachtBlok + body);

console.log('bron    : ' + bron);
console.log('preview : ' + preview);
console.log('artifact: ' + artifact);
console.log('pagina  : ' + (pagina.length / 1024).toFixed(1) + ' KB');
console.log('module  : ' + (moduleTekst.length / 1024).toFixed(1) + ' KB');
console.log('geschreven naar: ' + DOEL);
