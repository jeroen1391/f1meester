'use strict';
/*
 * Schrijft data/expectations.json: alles wat de Pit Wall-pagina nodig heeft om
 * punten te tonen, berekend door dezelfde motor als optimize.js.
 *
 * Waarom dit bestaat: de pagina had een eigen kopie van de puntentabellen en de
 * vormberekening. Daardoor moest elke modelwijziging twee keer gemaakt worden, en
 * op 12 september gebeurde dat één keer — de pagina toonde Mercedes op 166 en
 * Ferrari op 160 terwijl het model al op 171 en 152 zat. De pagina rekent nu niets
 * meer zelf uit; ze leest wat hier uit rolt.
 *
 * Draaien: node src/expectations.js [--venster N]
 */
const fs = require('fs');
const path = require('path');
const results = require(path.join(__dirname, '..', 'data', 'results-2026.json'));
const prijzen = require('./prices');
const {
  COUREUR, ONDERDEEL, STRAF_COUREUR, STRAF_ONDERDEEL,
  coureurPunten, onderdeelPunten, onderdeelPuntenPerCoureur, parseRegel
} = require('./scoring');

const arg = (naam, standaard) => {
  const i = process.argv.indexOf('--' + naam);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : standaard;
};
const VENSTER = Number(arg('venster', 5));

const RONDES = Object.keys(results).filter(k => /^r\d+$/.test(k)).sort((a, b) => +a.slice(1) - +b.slice(1));
const RECENT = RONDES.slice(-VENSTER);

const bijstelPad = path.join(__dirname, '..', 'data', 'adjustments.json');
let bijstel = { coureurs: {}, onderdelen: {}, uitgesloten: [] };
if (fs.existsSync(bijstelPad)) {
  bijstel = { coureurs: {}, onderdelen: {}, uitgesloten: [], ...JSON.parse(fs.readFileSync(bijstelPad, 'utf8')) };
}

const gem = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Zelfde regel als in optimize.js: vormgemiddelde, daarna de handmatige bijstelling. */
function metBijstelling(basis, b) {
  if (b == null) return basis;
  if (typeof b === 'number') return basis * b;
  let waarde = basis;
  if (b.factor != null) waarde *= b.factor;
  if (b.delta != null) waarde += b.delta;
  if (b.punten != null) waarde = b.punten;
  return waarde;
}

/** Racepunten van één coureur in één ronde — nodig voor het gridstraf-schuifje op de pagina. */
function raceCoureur(ronde, code) {
  for (const regel of ronde.r ?? []) {
    const e = parseRegel(regel);
    if (e.coureur === code) {
      const rij = COUREUR[e.pos - 1];
      return typeof e.pos === 'number' ? (rij ? rij[2] : 0) : (STRAF_COUREUR[e.pos] ?? 0);
    }
  }
  return 0;
}

/** Racepunten die één coureur aan het onderdeel van zijn renstal bijdroeg. */
function raceOnderdeelVanCoureur(ronde, code) {
  for (const regel of ronde.r ?? []) {
    const e = parseRegel(regel);
    if (e.coureur === code) {
      const rij = ONDERDEEL[e.pos - 1];
      return typeof e.pos === 'number' ? (rij ? rij[2] : 0) : (STRAF_ONDERDEEL[e.pos] ?? 0);
    }
  }
  return 0;
}

const coureurTeams = Object.fromEntries(Object.entries(prijzen.coureurs).map(([c, o]) => [c, o.team]));

function verhoudingVan(code) {
  const basis = gem(RECENT.map(r => coureurPunten(results[r], code)));
  if (!basis) return 1;
  return metBijstelling(basis, bijstel.coureurs[code]) / basis;
}

const coureurs = {};
for (const code of Object.keys(prijzen.coureurs)) {
  const basis = gem(RECENT.map(r => coureurPunten(results[r], code)));
  coureurs[code] = {
    verwacht: Math.round(metBijstelling(basis, bijstel.coureurs[code]) * 10) / 10,
    ongecorrigeerd: Math.round(basis * 10) / 10,
    raceGemiddeld: Math.round(gem(RECENT.map(r => raceCoureur(results[r], code))) * 10) / 10,
    uitgesloten: bijstel.uitgesloten.includes(code)
  };
}

const onderdelen = {};
for (const team of Object.keys(prijzen.onderdelen)) {
  const basis = gem(RECENT.map(r => onderdeelPunten(results[r], team)));
  // Een onderdeel is de som van beide coureurs, dus de bijstelling van een coureur
  // werkt door in zijn eigen aandeel. Een bijstelling op het onderdeel zelf gaat voor.
  const doorgerekend = bijstel.onderdelen[team] != null
    ? metBijstelling(basis, bijstel.onderdelen[team])
    : gem(RECENT.map(r => Object.entries(onderdeelPuntenPerCoureur(results[r], team))
        .reduce((som, [c, p]) => som + p * verhoudingVan(c), 0)));

  const raceGemiddeldPerCoureur = {};
  for (const [c, t] of Object.entries(coureurTeams)) {
    if (t === team) raceGemiddeldPerCoureur[c] = Math.round(gem(RECENT.map(r => raceOnderdeelVanCoureur(results[r], c))) * 10) / 10;
  }

  onderdelen[team] = {
    verwacht: Math.round(doorgerekend * 10) / 10,
    ongecorrigeerd: Math.round(basis * 10) / 10,
    raceGemiddeldPerCoureur,
    uitgesloten: bijstel.uitgesloten.includes(team)
  };
}

const uit = {
  _bron: 'Gegenereerd door f1meester/src/expectations.js — niet met de hand aanpassen.',
  _uitleg: 'De Pit Wall-pagina leest dit in plaats van zelf te rekenen, zodat het model op één plek staat.',
  gegenereerd: new Date().toISOString().slice(0, 10),
  venster: VENSTER,
  rondesInVenster: RECENT.map(r => Number(r.slice(1))),
  bijstellingActief: Object.keys(bijstel.coureurs).length > 0 || Object.keys(bijstel.onderdelen).length > 0,
  tabel: { coureur: COUREUR, onderdeel: ONDERDEEL, strafCoureur: STRAF_COUREUR, strafOnderdeel: STRAF_ONDERDEEL },
  coureurs,
  onderdelen
};

const doel = path.join(__dirname, '..', 'data', 'expectations.json');
fs.writeFileSync(doel, JSON.stringify(uit, null, 2) + '\n');

console.log('');
console.log(`Vormvenster: laatste ${VENSTER} rondes (${uit.rondesInVenster.join(', ')})`);
console.log(`Bijstellingen actief: ${uit.bijstellingActief ? 'ja' : 'nee'}`);
console.log('');
console.log('onderdeel   ongecorrigeerd   na bijstelling');
for (const [t, o] of Object.entries(onderdelen).sort((a, b) => b[1].verwacht - a[1].verwacht)) {
  const pijl = o.verwacht === o.ongecorrigeerd ? '' : (o.verwacht > o.ongecorrigeerd ? '  omhoog' : '  omlaag');
  console.log(`${t.padEnd(12)}${String(o.ongecorrigeerd).padStart(14)}${String(o.verwacht).padStart(17)}${pijl}`);
}
console.log('');
console.log('geschreven naar: ' + doel);
