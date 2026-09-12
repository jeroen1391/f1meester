'use strict';
/*
 * Optimizer: zoekt binnen het budget de opstelling met de hoogste verwachte score.
 *
 * Dit deel is bewust deterministisch. Zelfde invoer geeft altijd hetzelfde antwoord,
 * zodat een veranderend advies altijd te herleiden is naar een veranderde verwachting
 * en nooit naar toeval in het model.
 *
 * Draaien:
 *   node src/optimize.js                       gebruikt vorm over de laatste 5 rondes
 *   node src/optimize.js --venster 3           korter vormvenster
 *   node src/optimize.js --budget 91000000     ander budget
 *   node src/optimize.js --top 10              meer alternatieven tonen
 *
 * Handmatige bijstelling (weerbericht, vrije trainingen, gridstraffen, coureurswissels)
 * gaat via data/adjustments.json. Zie het commentaar in dat bestand.
 */
const path = require('path');
const fs = require('fs');
const results = require(path.join(__dirname, '..', 'data', 'results-2026.json'));
const prijzen = require('./prices');
const { coureurPunten, onderdeelPunten, onderdeelPuntenPerCoureur, regelovertredingen } = require('./scoring');

function arg(naam, standaard) {
  const i = process.argv.indexOf('--' + naam);
  return i > -1 ? process.argv[i + 1] : standaard;
}
const VENSTER = Number(arg('venster', 5));
const BUDGET = Number(arg('budget', prijzen.budget.totaal));
const TOP = Number(arg('top', 5));

const RONDES = Object.keys(results).filter(k => /^r\d+$/.test(k)).sort((a, b) => +a.slice(1) - +b.slice(1));
const RECENT = RONDES.slice(-VENSTER);

// Bijstellingen laden als ze er zijn.
const bijstelPad = path.join(__dirname, '..', 'data', 'adjustments.json');
let bijstel = { coureurs: {}, onderdelen: {}, uitgesloten: [] };
if (fs.existsSync(bijstelPad)) {
  const rauw = JSON.parse(fs.readFileSync(bijstelPad, 'utf8'));
  bijstel = { coureurs: {}, onderdelen: {}, uitgesloten: [], ...rauw };
}

const coureurTeams = Object.fromEntries(Object.entries(prijzen.coureurs).map(([c, o]) => [c, o.team]));
const coureurCodes = Object.keys(prijzen.coureurs).filter(c => !bijstel.uitgesloten.includes(c));
const teamCodes = Object.keys(prijzen.onderdelen).filter(t => !bijstel.uitgesloten.includes(t));

/** Verwachte punten = gemiddelde over het vormvenster, daarna de handmatige bijstelling. */
function verwacht(code, puntenFn, bijstellingen) {
  const basis = RECENT.map(r => puntenFn(results[r], code)).reduce((a, b) => a + b, 0) / RECENT.length;
  const b = bijstellingen[code];
  if (b == null) return basis;
  if (typeof b === 'number') return basis * b;            // factor, bv. 1.15
  let waarde = basis;
  if (b.factor != null) waarde *= b.factor;
  if (b.delta != null) waarde += b.delta;
  if (b.punten != null) waarde = b.punten;                 // harde overschrijving
  return waarde;
}

/*
 * Een onderdeel scoort de som van beide coureurs van die renstal. Een bijstelling
 * op een coureur moet daarom ook in zijn onderdeel doorwerken: zakt Hamilton weg,
 * dan zakt het Ferrari-onderdeel mee. Zonder dit liep het model precies mis op wat
 * er in Monza gebeurde, waar Leclerc uitviel en de Ferrari-onderdelen halveerden.
 *
 * De bijstelling wordt vertaald naar een verhouding op coureurschaal en daarna op
 * zijn aandeel in het onderdeel toegepast. Zo werken factor, delta en een harde
 * overschrijving allemaal op dezelfde manier door.
 */
function coureurVerhouding(code) {
  const basis = RECENT.map(r => coureurPunten(results[r], code)).reduce((a, b) => a + b, 0) / RECENT.length;
  if (!basis) return 1;
  return verwacht(code, coureurPunten, bijstel.coureurs) / basis;
}

/** Een bijstelling op het onderdeel zelf gaat voor op die van de coureurs. */
function verwachtOnderdeel(team) {
  if (bijstel.onderdelen[team] != null) return verwacht(team, onderdeelPunten, bijstel.onderdelen);
  const totaal = RECENT
    .map(r => Object.entries(onderdeelPuntenPerCoureur(results[r], team))
      .reduce((som, [c, p]) => som + p * coureurVerhouding(c), 0))
    .reduce((a, b) => a + b, 0);
  return totaal / RECENT.length;
}

const eC = Object.fromEntries(coureurCodes.map(c => [c, verwacht(c, coureurPunten, bijstel.coureurs)]));
const eT = Object.fromEntries(teamCodes.map(t => [t, verwachtOnderdeel(t)]));
const pC = c => prijzen.coureurs[c].prijs;
const pT = t => prijzen.onderdelen[t].prijs;

/** Alle multisets van 4 renstallen waarbij geen renstal vaker dan 2 keer voorkomt. */
function onderdeelCombinaties() {
  const uit = [];
  const n = teamCodes.length;
  (function bouw(start, gekozen) {
    if (gekozen.length === 4) { uit.push([...gekozen]); return; }
    for (let i = start; i < n; i++) {
      const t = teamCodes[i];
      if (gekozen.filter(x => x === t).length >= 2) continue;
      gekozen.push(t);
      bouw(i, gekozen);
      gekozen.pop();
    }
  })(0, []);
  return uit;
}

const combos = onderdeelCombinaties();
const kandidaten = [];

for (let i = 0; i < coureurCodes.length; i++) {
  for (let j = i + 1; j < coureurCodes.length; j++) {
    const c1 = coureurCodes[i], c2 = coureurCodes[j];
    const coureurKosten = pC(c1) + pC(c2);
    if (coureurKosten > BUDGET) continue;
    const coureurPunt = eC[c1] + eC[c2];

    for (const onderdelen of combos) {
      const kosten = coureurKosten + onderdelen.reduce((a, t) => a + pT(t), 0);
      if (kosten > BUDGET) continue;
      const fouten = regelovertredingen({ coureurs: [c1, c2], onderdelen }, coureurTeams);
      if (fouten.length) continue;
      const punten = coureurPunt + onderdelen.reduce((a, t) => a + eT[t], 0);
      kandidaten.push({ coureurs: [c1, c2], onderdelen, kosten, punten });
    }
  }
}

kandidaten.sort((a, b) => b.punten - a.punten);

const mln = n => '€' + (n / 1e6).toFixed(3) + 'm';
const naam = c => prijzen.coureurs[c].naam;

console.log('');
console.log(`Prijzen uit ${prijzen._bestand}`);
console.log(`Optimizer — vormvenster ${VENSTER} rondes (${RECENT.map(r => r.slice(1)).join(', ')}), budget ${mln(BUDGET)}`);
console.log(`Geldige opstellingen doorgerekend: ${kandidaten.length.toLocaleString('nl-NL')}`);
if (bijstel.notitie) console.log(`Bijstelling actief: ${bijstel.notitie}`);
console.log('');

kandidaten.slice(0, TOP).forEach((k, n) => {
  const perRenstal = {};
  for (const c of k.coureurs) perRenstal[coureurTeams[c]] = (perRenstal[coureurTeams[c]] ?? 0) + 1;
  for (const t of k.onderdelen) perRenstal[t] = (perRenstal[t] ?? 0) + 1;
  console.log(`${n + 1}. ${Math.round(k.punten)} punten verwacht — ${mln(k.kosten)} (${mln(BUDGET - k.kosten)} over)`);
  console.log(`   coureurs   ${k.coureurs.map(c => `${naam(c)} ${mln(pC(c))} (${Math.round(eC[c])}p)`).join('  +  ')}`);
  const geteld = {};
  for (const t of k.onderdelen) geteld[t] = (geteld[t] ?? 0) + 1;
  console.log(`   onderdelen ${Object.entries(geteld).map(([t, n2]) => `${n2}× ${t} ${mln(pT(t))} (${Math.round(eT[t])}p elk)`).join('  +  ')}`);
  // Concentratie: hoeveel van de verwachte score hangt aan één renstal?
  // Elementen van dezelfde renstal scoren via dezelfde twee coureurs en zijn dus
  // volledig gecorreleerd. Valt die renstal tegen, dan verlies je op alle plekken
  // tegelijk — dat overkwam ronde 13 met Ferrari (verwacht 172, werd 87).
  const perRenstalPunten = {};
  for (const c of k.coureurs) perRenstalPunten[coureurTeams[c]] = (perRenstalPunten[coureurTeams[c]] ?? 0) + eC[c];
  for (const t of k.onderdelen) perRenstalPunten[t] = (perRenstalPunten[t] ?? 0) + eT[t];
  const zwaarste = Object.entries(perRenstalPunten).sort((a, b) => b[1] - a[1])[0];
  const aandeel = Math.round(zwaarste[1] / k.punten * 100);
  console.log(`   concentratie ${zwaarste[0]} draagt ${aandeel}% van de verwachte score${aandeel >= 35 ? '  — let op, dat is veel in één renstal' : ''}`);
  console.log('');
});

// Ter vergelijking: de opstelling die nu daadwerkelijk staat.
const huidig = { coureurs: ['HAM', 'VER'], onderdelen: ['FER', 'RBR', 'ALP', 'RAC'] };
const huidigPunten = huidig.coureurs.reduce((a, c) => a + eC[c], 0) + huidig.onderdelen.reduce((a, t) => a + eT[t], 0);
const huidigKosten = huidig.coureurs.reduce((a, c) => a + pC(c), 0) + huidig.onderdelen.reduce((a, t) => a + pT(t), 0);
console.log('Ter vergelijking, de opstelling van ronde 13:');
console.log(`   ${Math.round(huidigPunten)} punten verwacht — ${mln(huidigKosten)}`);
console.log(`   verschil met de beste optie: ${Math.round(kandidaten[0].punten - huidigPunten)} punten per ronde`);
console.log('');
