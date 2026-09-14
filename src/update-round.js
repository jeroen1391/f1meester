'use strict';
/*
 * Verwerkt één gereden ronde: punten per coureur en onderdeel, jouw score,
 * en wat achteraf de best mogelijke opstelling was.
 *
 * Gebruik: node src/update-round.js <rondenummer>
 *
 * Dit script is bewust vast en argumentgestuurd, zodat het één keer in de
 * permissielijst kan en niet elke ronde opnieuw om toestemming vraagt.
 */
const fs = require('fs');
const path = require('path');
const { coureurPunten, onderdeelPunten, onderdeelPuntenPerCoureur, heeftSprint, regelovertredingen } = require('./scoring');

const dataDir = path.join(__dirname, '..', 'data');
const lees = f => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));

const ronde = process.argv[2];
if (!ronde || !/^\d+$/.test(ronde)) {
  console.error('Gebruik: node src/update-round.js <rondenummer>, bijvoorbeeld: node src/update-round.js 13');
  process.exit(1);
}

const results = lees('results-2026.json');
const rd = results['r' + ronde];
if (!rd) {
  console.error(`Ronde ${ronde} staat nog niet in data/results-2026.json. Voeg de uitslag daar eerst toe.`);
  process.exit(1);
}

// Nieuwste prijzenbestand pakken.
const prijsBestanden = fs.readdirSync(dataDir)
  .filter(f => /^prices-round\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
if (!prijsBestanden.length) { console.error('Geen prices-round*.json in data/.'); process.exit(1); }
const prijsBestand = prijsBestanden[prijsBestanden.length - 1];
const prijzen = lees(prijsBestand);

const mln = n => '€' + (n / 1e6).toFixed(3);
const lpad = (s, n) => String(s).padStart(n);
const pad = (s, n) => String(s).padEnd(n);

console.log('');
console.log(`RONDE ${ronde}${heeftSprint(rd) ? '  (sprintweekend)' : ''}`);
console.log(`Prijzen uit ${prijsBestand}`);
console.log('='.repeat(62));

/* ---------- punten per element ---------- */
const cs = Object.keys(prijzen.coureurs).map(c => ({
  code: c, naam: prijzen.coureurs[c].naam, prijs: prijzen.coureurs[c].prijs,
  punten: coureurPunten(rd, c)
}));
const ts = Object.keys(prijzen.onderdelen).map(t => ({
  code: t, prijs: prijzen.onderdelen[t].prijs, punten: onderdeelPunten(rd, t)
}));
cs.forEach(o => o.rendement = o.punten / (o.prijs / 1e6));
ts.forEach(o => o.rendement = o.punten / (o.prijs / 1e6));

console.log('\nCOUREURS deze ronde');
console.log(pad('coureur', 20) + lpad('prijs', 9) + lpad('punten', 8) + lpad('per mln', 9));
cs.slice().sort((a, b) => b.punten - a.punten).forEach(o =>
  console.log(pad(o.naam, 20) + lpad(mln(o.prijs), 9) + lpad(o.punten, 8) + lpad(o.rendement.toFixed(1), 9)));

console.log('\nONDERDELEN deze ronde (chassis en motor scoren gelijk)');
console.log(pad('renstal', 20) + lpad('prijs', 9) + lpad('punten', 8) + lpad('per mln', 9));
ts.slice().sort((a, b) => b.punten - a.punten).forEach(o =>
  console.log(pad(o.code, 20) + lpad(mln(o.prijs), 9) + lpad(o.punten, 8) + lpad(o.rendement.toFixed(1), 9)));

/* ---------- eigen opstelling ---------- */
let mine = null;
try { mine = lees('my-lineups.json'); } catch (e) {}
const eigen = mine && (mine.rondes || []).find(r => String(r.ronde) === String(ronde));
if (eigen) {
  console.log('\nJOUW OPSTELLING — controle van het scoremodel');
  let fout = 0;
  for (const [code, verwacht, joker] of eigen.coureurs) {
    const berekend = coureurPunten(rd, code) * (joker ? 2 : 1);
    if (berekend !== verwacht) fout++;
    console.log(`  ${pad(code, 6)} site ${lpad(verwacht, 5)}  model ${lpad(berekend, 5)}  ${berekend === verwacht ? 'ok' : 'AFWIJKING'}`);
  }
  for (const [code, verwacht] of eigen.onderdelen) {
    const berekend = onderdeelPunten(rd, code);
    if (berekend !== verwacht) fout++;
    console.log(`  ${pad(code, 6)} site ${lpad(verwacht, 5)}  model ${lpad(berekend, 5)}  ${berekend === verwacht ? 'ok' : 'AFWIJKING'}`);
  }
  console.log(fout ? `  ${fout} afwijking(en) — onderzoeken` : '  Model reproduceert deze ronde exact.');
}

/* ---------- optimum achteraf ---------- */
const budget = (prijzen.budget && prijzen.budget.totaal) || 0;
const coureurTeams = Object.fromEntries(Object.entries(prijzen.coureurs).map(([c, o]) => [c, o.team]));
const teamCodes = Object.keys(prijzen.onderdelen);
const combos = [];
(function bouw(start, cur) {
  if (cur.length === 4) { combos.push(cur.slice()); return; }
  for (let i = start; i < teamCodes.length; i++) {
    const t = teamCodes[i];
    if (cur.filter(x => x === t).length >= 2) continue;
    cur.push(t); bouw(i, cur); cur.pop();
  }
})(0, []);

const eP = Object.fromEntries(cs.map(o => [o.code, o.punten]));
const tP = Object.fromEntries(ts.map(o => [o.code, o.punten]));
let beste = null;
const codes = cs.map(o => o.code);
for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) {
  const c1 = codes[i], c2 = codes[j];
  const kd = prijzen.coureurs[c1].prijs + prijzen.coureurs[c2].prijs;
  if (kd > budget) continue;
  for (const combo of combos) {
    const kosten = kd + combo.reduce((a, t) => a + prijzen.onderdelen[t].prijs, 0);
    if (kosten > budget) continue;
    if (regelovertredingen({ coureurs: [c1, c2], onderdelen: combo }, coureurTeams).length) continue;
    const punten = eP[c1] + eP[c2] + combo.reduce((a, t) => a + tP[t], 0);
    if (!beste || punten > beste.punten) beste = { coureurs: [c1, c2], onderdelen: combo, kosten, punten };
  }
}

/* ---------- terugblik: welk vormvenster had deze ronde het best voorspeld? ---------- */
const gem = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const rondesVoor = n => Object.keys(results).filter(k => /^r\d+$/.test(k) && +k.slice(1) < n)
  .sort((a, b) => +a.slice(1) - +b.slice(1));
const voorspel = (rs, code, fn) => gem(rs.map(r => fn(results[r], code)));
const VENSTERS = [3, 5, 8];

function vensterFout(n, venster) {
  const vorige = rondesVoor(n).slice(-venster), doel = results['r' + n];
  return {
    c: gem(cs.map(o => Math.abs(voorspel(vorige, o.code, coureurPunten) - coureurPunten(doel, o.code)))),
    t: gem(ts.map(o => Math.abs(voorspel(vorige, o.code, onderdeelPunten) - onderdeelPunten(doel, o.code))))
  };
}
// Alleen rondes met minstens 8 eerdere rondes, zodat elk venster volledig gevuld is.
const toetsRondes = Object.keys(results).filter(k => /^r\d+$/.test(k)).map(k => +k.slice(1))
  .filter(n => n >= 9 && n <= +ronde).sort((a, b) => a - b);

console.log('\nVORMVENSTER ACHTERAF — gemiddelde fout per element, zonder bijstellingen');
console.log(pad('venster', 9) + lpad('coureur', 9) + lpad('onderdeel', 11) + lpad('jouw team', 11) +
  `   gemiddeld r${toetsRondes[0]}-r${ronde}: coureur / onderdeel`);
for (const v of VENSTERS) {
  const f = vensterFout(+ronde, v);
  const vorige = rondesVoor(+ronde).slice(-v);
  const jouwVerwacht = eigen
    ? eigen.coureurs.reduce((a, [c, , j]) => a + voorspel(vorige, c, coureurPunten) * (j ? 2 : 1), 0) +
      eigen.onderdelen.reduce((a, [t]) => a + voorspel(vorige, t, onderdeelPunten), 0)
    : null;
  const reeks = toetsRondes.map(n => vensterFout(n, v));
  console.log(pad(v, 9) + lpad(f.c.toFixed(1), 9) + lpad(f.t.toFixed(1), 11) +
    lpad(jouwVerwacht == null ? '-' : Math.round(jouwVerwacht), 11) +
    `   ${gem(reeks.map(x => x.c)).toFixed(1)} / ${gem(reeks.map(x => x.t)).toFixed(1)}`);
}
if (eigen) {
  const werkelijk = eigen.coureurs.reduce((a, x) => a + x[1], 0) + eigen.onderdelen.reduce((a, x) => a + x[1], 0);
  console.log(`  jouw team werkelijk ${werkelijk} (zonder bonusvragen)`);
}

/* ---------- terugblik: hielpen de bijstellingen uit data/adjustments.json? ---------- */
let bijstel = null;
try { bijstel = lees('adjustments.json'); } catch (e) {}
// Na afloop van een ronde worden de bijstellingen gearchiveerd onder bijstellingen_ronde<n>,
// zodat ze niet in de volgende ronde doorwerken. Staan ze daar, dan gaan die voor.
if (bijstel && bijstel['bijstellingen_ronde' + ronde]) bijstel = { ...bijstel, ...bijstel['bijstellingen_ronde' + ronde] };
if (bijstel && bijstel['notitie_ronde' + ronde] && bijstel.coureurs && Object.keys(bijstel.coureurs).length) {
  const vorige5 = rondesVoor(+ronde).slice(-5);
  const metBijstelling = (basis, b) => {
    if (b == null) return basis;
    if (typeof b === 'number') return basis * b;
    let w = basis;
    if (b.factor != null) w *= b.factor;
    if (b.delta != null) w += b.delta;
    if (b.punten != null) w = b.punten;
    return w;
  };
  const verhouding = c => {
    const basis = voorspel(vorige5, c, coureurPunten);
    return basis ? metBijstelling(basis, bijstel.coureurs[c]) / basis : 1;
  };
  const oordeel = (basis, bij, echt) => {
    const d = Math.abs(basis - echt) - Math.abs(bij - echt);
    return Math.abs(d) < 0.5 ? 'niets' : (d > 0 ? `hielp ${d.toFixed(0)}p` : `schaadde ${(-d).toFixed(0)}p`);
  };
  let somZonder = 0, somMet = 0;
  const regel = (code, basis, bij, echt) => {
    somZonder += Math.abs(basis - echt); somMet += Math.abs(bij - echt);
    console.log(pad(code, 8) + lpad(basis.toFixed(0), 7) + lpad(bij.toFixed(0), 12) + lpad(echt, 11) + '   ' + oordeel(basis, bij, echt));
  };
  console.log(`\nBIJSTELLINGEN RONDE ${ronde} ACHTERAF — venster 5`);
  console.log(pad('element', 8) + lpad('vorm', 7) + lpad('bijgesteld', 12) + lpad('werkelijk', 11));
  for (const c of Object.keys(bijstel.coureurs)) {
    const basis = voorspel(vorige5, c, coureurPunten);
    regel(c, basis, metBijstelling(basis, bijstel.coureurs[c]), coureurPunten(rd, c));
  }
  const geraakt = [...new Set(Object.keys(bijstel.coureurs).map(c => prijzen.coureurs[c] && prijzen.coureurs[c].team).filter(Boolean))];
  for (const t of geraakt) {
    const basis = voorspel(vorige5, t, onderdeelPunten);
    const bij = gem(vorige5.map(r => Object.entries(onderdeelPuntenPerCoureur(results[r], t))
      .reduce((som, [c, p]) => som + p * verhouding(c), 0)));
    regel(t, basis, bij, onderdeelPunten(rd, t));
  }
  console.log(`  totale fout zonder bijstelling ${somZonder.toFixed(0)}, met ${somMet.toFixed(0)}`);
}

if (beste) {
  const geteld = {};
  for (const t of beste.onderdelen) geteld[t] = (geteld[t] || 0) + 1;
  console.log('\nBEST MOGELIJKE OPSTELLING ACHTERAF (binnen ' + mln(budget) + ')');
  console.log('  coureurs   ' + beste.coureurs.map(c => `${prijzen.coureurs[c].naam} (${eP[c]}p)`).join(' + '));
  console.log('  onderdelen ' + Object.keys(geteld).map(t => `${geteld[t]}x ${t} (${tP[t]}p elk)`).join(' + '));
  console.log('  totaal     ' + Math.round(beste.punten) + ' punten voor ' + mln(beste.kosten));
  if (eigen) {
    const jouw = eigen.coureurs.reduce((a, x) => a + x[1], 0) + eigen.onderdelen.reduce((a, x) => a + x[1], 0);
    console.log(`  jouw ronde ${jouw} punten — verschil ${Math.round(beste.punten) - jouw}`);
  }
}
console.log('');
