'use strict';
/*
 * Scoremotor Formule 1 Meester 2026.
 *
 * De puntentabel komt letterlijk van formule1meester.nl/help. Alles hieronder is
 * geverifieerd tegen twaalf rondes werkelijke uitslagen uit het account SleuF1:
 * elke coureur en elk onderdeel rekent tot op de punt uit. Zie validate.js.
 *
 * Twee regels die het model bepalen en die niet vanzelfsprekend zijn:
 *  - Een onderdeel (chassis of motor) scoort de SOM van beide coureurs van die renstal.
 *  - Chassis en motor van dezelfde renstal scoren identiek en kosten evenveel.
 *    Je kiest dus geen chassis en motor, maar hoeveel onderdelen je van een renstal afneemt.
 */

// [sprint, kwalificatie, race] per klassering, index 0 = P1.
const COUREUR = [
  [45,90,225],[40,81,204],[37,75,188],[34,69,173],[31,63,158],[28,57,144],
  [26,52,131],[23,47,119],[21,42,107],[19,38,96],[17,34,86],[15,30,77],
  [13,27,68],[12,24,60],[10,21,53],[9,18,47],[8,16,41],[7,14,35],
  [6,12,30],[5,10,26],[4,8,21],[3,7,18]
];
const ONDERDEEL = [
  [15,30,75],[13,27,68],[12,25,63],[11,23,58],[10,21,53],[9,19,48],
  [8,17,44],[8,16,40],[7,14,36],[6,12,32],[5,11,29],[5,10,26],
  [4,9,23],[4,8,20],[3,7,18],[3,6,16],[2,5,14],[2,4,12],
  [2,4,10],[1,3,9],[1,2,7],[1,2,6]
];

// Straffen per sessie. DIS en DSQ zijn hetzelfde.
const STRAF_COUREUR  = { DNF:-10, DNQ:-10, DNS:-20, DIS:-20, DSQ:-20 };
const STRAF_ONDERDEEL = { DNF:-5,  DNQ:-5,  DNS:-10, DIS:-10, DSQ:-10 };

const SESSIE_INDEX = { s: 0, q: 1, r: 2 };

/** Splitst "10:GAS:ALP" in { pos, coureur, team }. pos is een getal of een code als DNF. */
function parseRegel(regel) {
  const [pos, coureur, team] = regel.split(':');
  const n = Number(pos);
  return { pos: Number.isFinite(n) ? n : pos, coureur, team };
}

function puntenVoor(tabel, straffen, pos, sessie) {
  if (typeof pos === 'number') {
    const rij = tabel[pos - 1];
    return rij ? rij[SESSIE_INDEX[sessie]] : 0;
  }
  return straffen[pos] ?? 0;
}

/** Punten van één coureur over een hele ronde (alle sessies die er waren). */
function coureurPunten(ronde, coureurCode) {
  let totaal = 0;
  for (const sessie of ['s', 'q', 'r']) {
    const regels = ronde[sessie];
    if (!regels) continue;
    for (const regel of regels) {
      const e = parseRegel(regel);
      if (e.coureur === coureurCode) totaal += puntenVoor(COUREUR, STRAF_COUREUR, e.pos, sessie);
    }
  }
  return totaal;
}

/** Punten van één onderdeel (chassis of motor) van een renstal: som over beide coureurs. */
function onderdeelPunten(ronde, teamCode) {
  let totaal = 0;
  for (const sessie of ['s', 'q', 'r']) {
    const regels = ronde[sessie];
    if (!regels) continue;
    for (const regel of regels) {
      const e = parseRegel(regel);
      if (e.team === teamCode) totaal += puntenVoor(ONDERDEEL, STRAF_ONDERDEEL, e.pos, sessie);
    }
  }
  return totaal;
}

/**
 * Hetzelfde als onderdeelPunten, maar uitgesplitst naar de coureur die de punten
 * opleverde. Nodig om een bijstelling op een coureur te laten doorwerken in het
 * onderdeel van zijn renstal: dat onderdeel is immers de som van beide coureurs.
 */
function onderdeelPuntenPerCoureur(ronde, teamCode) {
  const uit = {};
  for (const sessie of ['s', 'q', 'r']) {
    const regels = ronde[sessie];
    if (!regels) continue;
    for (const regel of regels) {
      const e = parseRegel(regel);
      if (e.team !== teamCode) continue;
      uit[e.coureur] = (uit[e.coureur] ?? 0) + puntenVoor(ONDERDEEL, STRAF_ONDERDEEL, e.pos, sessie);
    }
  }
  return uit;
}

function heeftSprint(ronde) {
  return Boolean(ronde.s);
}

/** Alle coureurs die in een ronde voorkomen. */
function coureursIn(ronde) {
  const set = new Set();
  for (const sessie of ['s', 'q', 'r']) {
    for (const regel of ronde[sessie] ?? []) set.add(parseRegel(regel).coureur);
  }
  return [...set];
}

function teamsIn(ronde) {
  const set = new Set();
  for (const sessie of ['s', 'q', 'r']) {
    for (const regel of ronde[sessie] ?? []) set.add(parseRegel(regel).team);
  }
  return [...set];
}

/**
 * Score van een volledige opstelling.
 * coureurs: twee codes. onderdelen: vier renstalcodes (chassis + motor door elkaar,
 * ze scoren toch identiek). joker: code van coureur of renstal die verdubbeld wordt.
 */
function opstellingScore(ronde, { coureurs, onderdelen, joker = null }) {
  let totaal = 0;
  const detail = [];
  for (const c of coureurs) {
    let p = coureurPunten(ronde, c);
    const verdubbeld = joker === c;
    if (verdubbeld) p *= 2;
    detail.push({ soort: 'coureur', code: c, punten: p, joker: verdubbeld });
    totaal += p;
  }
  for (const t of onderdelen) {
    let p = onderdeelPunten(ronde, t);
    const verdubbeld = joker === t;
    if (verdubbeld) p *= 2;
    detail.push({ soort: 'onderdeel', code: t, punten: p, joker: verdubbeld });
    totaal += p;
  }
  return { totaal, detail };
}

/**
 * Controleert de teamregels. Geeft een lege lijst terug als de opstelling mag.
 * Regel: 2 verschillende coureurs, 4 onderdelen, maximaal 2 onderdelen/coureurs per renstal.
 */
function regelovertredingen({ coureurs, onderdelen }, coureurTeams) {
  const fouten = [];
  if (coureurs.length !== 2) fouten.push('een team heeft precies 2 coureurs nodig');
  if (new Set(coureurs).size !== coureurs.length) fouten.push('dezelfde coureur staat twee keer opgesteld');
  if (onderdelen.length !== 4) fouten.push('een team heeft precies 4 onderdelen nodig (2 chassis, 2 motoren)');

  const perRenstal = {};
  for (const c of coureurs) {
    const t = coureurTeams[c];
    perRenstal[t] = (perRenstal[t] ?? 0) + 1;
  }
  for (const t of onderdelen) perRenstal[t] = (perRenstal[t] ?? 0) + 1;

  for (const [renstal, aantal] of Object.entries(perRenstal)) {
    if (aantal > 2) fouten.push(`${aantal} onderdelen van ${renstal} — maximaal 2 toegestaan`);
  }
  return fouten;
}

/** Salaris: vast basisbedrag plus 5.000 euro per behaald punt. */
function salaris(punten) {
  return 1000000 + punten * 5000;
}

module.exports = {
  COUREUR, ONDERDEEL, STRAF_COUREUR, STRAF_ONDERDEEL,
  parseRegel, coureurPunten, onderdeelPunten, onderdeelPuntenPerCoureur, heeftSprint,
  coureursIn, teamsIn, opstellingScore, regelovertredingen, salaris
};
