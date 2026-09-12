'use strict';
/*
 * Valideert de scoremotor tegen de werkelijke punten die formule1meester.nl
 * heeft toegekend aan het account SleuF1 over ronde 1 t/m 12.
 *
 * Draaien: node src/validate.js
 */
const path = require('path');
const results = require(path.join(__dirname, '..', 'data', 'results-2026.json'));
const mine = require(path.join(__dirname, '..', 'data', 'my-lineups.json'));
const { coureurPunten, onderdeelPunten } = require('./scoring');

let gecontroleerd = 0;
let fout = 0;
const afwijkingen = [];

for (const r of mine.rondes) {
  const ronde = results['r' + r.ronde];
  if (!ronde) { console.log(`ronde ${r.ronde}: geen uitslag in dataset, overgeslagen`); continue; }

  for (const [code, verwacht, joker] of r.coureurs) {
    const berekend = coureurPunten(ronde, code) * (joker ? 2 : 1);
    gecontroleerd++;
    if (berekend !== verwacht) {
      fout++;
      afwijkingen.push({ ronde: r.ronde, soort: 'coureur', code, verwacht, berekend });
    }
  }
  for (const [code, verwacht] of r.onderdelen) {
    const berekend = onderdeelPunten(ronde, code);
    gecontroleerd++;
    if (berekend !== verwacht) {
      fout++;
      afwijkingen.push({ ronde: r.ronde, soort: 'onderdeel', code, verwacht, berekend });
    }
  }
}

console.log('');
console.log('Validatie scoremotor tegen werkelijke uitslagen');
console.log('----------------------------------------------');
console.log(`Gecontroleerde waarden : ${gecontroleerd}`);
console.log(`Exact gelijk           : ${gecontroleerd - fout}`);
console.log(`Afwijkend              : ${fout}`);

if (afwijkingen.length) {
  console.log('');
  console.log('Afwijkingen:');
  for (const a of afwijkingen) {
    console.log(`  ronde ${a.ronde} ${a.soort} ${a.code}: site zegt ${a.verwacht}, model zegt ${a.berekend} (verschil ${a.berekend - a.verwacht})`);
  }
} else {
  console.log('');
  console.log('Het model reproduceert elke toegekende score exact.');
}
console.log('');
