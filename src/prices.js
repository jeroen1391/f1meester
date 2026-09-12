'use strict';
/* Pakt altijd het nieuwste prices-round<n>.json uit data/, zodat de scripts
   automatisch met de actuele prijzen rekenen zodra een ronde opent. */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const bestanden = fs.readdirSync(dataDir)
  .filter(f => /^prices-round\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

if (!bestanden.length) throw new Error('Geen prices-round*.json gevonden in data/');

const bestand = bestanden[bestanden.length - 1];
const prijzen = JSON.parse(fs.readFileSync(path.join(dataDir, bestand), 'utf8'));
prijzen._bestand = bestand;
prijzen._ronde = Number(bestand.match(/\d+/)[0]);

module.exports = prijzen;
