'use strict';
/*
 * Vormanalyse: punten per ronde voor elke coureur en elke renstal, plus
 * rendement per miljoen euro op de prijzen van ronde 13.
 *
 * Draaien: node src/form.js [aantal_rondes]   (standaard 5)
 */
const path = require('path');
const results = require(path.join(__dirname, '..', 'data', 'results-2026.json'));
const prijzen = require('./prices');
const { coureurPunten, onderdeelPunten, heeftSprint } = require('./scoring');

const VENSTER = Number(process.argv[2]) || 5;
const RONDES = Object.keys(results).filter(k => /^r\d+$/.test(k)).sort((a, b) => +a.slice(1) - +b.slice(1));
const RECENT = RONDES.slice(-VENSTER);

const mln = n => (n / 1e6).toFixed(3);
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function reeks(codes, puntenFn) {
  const uit = {};
  for (const code of codes) {
    const perRonde = RONDES.map(r => puntenFn(results[r], code));
    const recent = RECENT.map(r => puntenFn(results[r], code));
    uit[code] = {
      perRonde,
      seizoen: perRonde.reduce((a, b) => a + b, 0) / perRonde.length,
      recent: recent.reduce((a, b) => a + b, 0) / recent.length,
      laatste: perRonde[perRonde.length - 1]
    };
  }
  return uit;
}

const coureurCodes = Object.keys(prijzen.coureurs);
const teamCodes = Object.keys(prijzen.onderdelen);
const cVorm = reeks(coureurCodes, coureurPunten);
const tVorm = reeks(teamCodes, onderdeelPunten);

console.log('');
console.log(`Sprintrondes in de dataset: ${RONDES.filter(r => heeftSprint(results[r])).map(r => r.slice(1)).join(', ')}`);
console.log(`Vormvenster: laatste ${VENSTER} rondes (${RECENT.map(r => r.slice(1)).join(', ')})`);

console.log('');
console.log('ONDERDELEN — chassis en motor van een renstal zijn identiek');
console.log('renstal   prijs(mln)   seizoen   recent   laatste   punt/mln(recent)');
const teamRij = teamCodes
  .map(t => ({ t, prijs: prijzen.onderdelen[t].prijs, ...tVorm[t] }))
  .map(o => ({ ...o, rendement: o.recent / (o.prijs / 1e6) }))
  .sort((a, b) => b.rendement - a.rendement);
for (const o of teamRij) {
  console.log(
    pad(o.t, 10) + lpad(mln(o.prijs), 10) + lpad(o.seizoen.toFixed(1), 10) +
    lpad(o.recent.toFixed(1), 9) + lpad(o.laatste, 10) + lpad(o.rendement.toFixed(1), 19)
  );
}

console.log('');
console.log('COUREURS');
console.log('coureur   team   prijs(mln)   seizoen   recent   laatste   punt/mln(recent)');
const cRij = coureurCodes
  .map(c => ({ c, team: prijzen.coureurs[c].team, prijs: prijzen.coureurs[c].prijs, ...cVorm[c] }))
  .map(o => ({ ...o, rendement: o.recent / (o.prijs / 1e6) }))
  .sort((a, b) => b.recent - a.recent);
for (const o of cRij) {
  console.log(
    pad(o.c, 10) + pad(o.team, 7) + lpad(mln(o.prijs), 10) + lpad(o.seizoen.toFixed(1), 10) +
    lpad(o.recent.toFixed(1), 9) + lpad(o.laatste, 10) + lpad(o.rendement.toFixed(1), 19)
  );
}
console.log('');

module.exports = { cVorm, tVorm, RONDES, RECENT };
