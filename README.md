# Formule 1 Meester — hulpsysteem

Rekent uit welke opstelling binnen je budget de hoogste verwachte score oplevert,
voor het account **SleuF1** (team *Strakka Haas F1*).

## Waarom het zo is opgezet

Het spel bestaat uit twee heel verschillende problemen, en die worden hier bewust
gescheiden gehouden.

**Voorspellen** — waar eindigt elke coureur dit weekend — is onzeker. Daar horen
vrije trainingen, nieuws, weer en vorm bij, en daar mag je van mening verschillen.

**Selecteren** — welke zes onderdelen passen binnen je budget — is dat niet. Gegeven
een verwachting per onderdeel is er precies één beste antwoord, en dat reken je uit.
`optimize.js` doorloopt alle 172.275 geldige opstellingen en is volledig
deterministisch: dezelfde invoer geeft altijd hetzelfde antwoord. Verandert het advies,
dan is dat altijd te herleiden naar een veranderde verwachting en nooit naar toeval.

## Wat het model zeker weet

Alles hieronder is geverifieerd, niet aangenomen.

- **Puntentabel** letterlijk van `formule1meester.nl/help`.
- **Een onderdeel scoort de som van beide coureurs van die renstal.** Mercedes-chassis
  in ronde 12: kwalificatie P2 en P3 geeft 27 plus 25, race P2 en P3 geeft 68 plus 63,
  sprint P1 en P4 geeft 15 plus 11. Samen 209 — precies wat de site toekende.
- **Chassis en motor van dezelfde renstal zijn identiek**, in prijs én in punten.
  Bevestigd met zeven gematchte paren in dezelfde ronde. Je kiest dus geen chassis en
  motor, maar hoeveel onderdelen je van een renstal afneemt, met maximaal twee per renstal.
- **Straffen gelden per sessie.** Lawson in Miami: gediskwalificeerd in de kwalificatie
  −20, negende in de sprint +21, uitgevallen in de race −10, samen −9. Exact wat de site gaf.
- **Een bijstelling op een coureur werkt door in het onderdeel van zijn renstal.** Dat
  volgt uit de regel erboven: het onderdeel ís de som van beide coureurs. Tot 12 september
  deed `optimize.js` dat niet, en dan onderschatte het model precies wat het te horen kreeg.
  Zet je Hamilton op 0,85 omdat hij in FP3 ver achterlag, dan hoort het Ferrari-onderdeel
  mee te zakken — het zakte van 160 naar 152. Een bijstelling die je rechtstreeks op een
  onderdeel zet gaat nog steeds voor op die van de coureurs.

`node src/validate.js` controleert 72 werkelijk toegekende waarden over twaalf rondes.
Alle 72 komen exact uit.

## Gebruik

```
node src/validate.js              controleer het scoremodel tegen de werkelijkheid
node src/form.js                  vorm en rendement per coureur en per renstal
node src/form.js 3                korter vormvenster
node src/optimize.js              beste opstellingen binnen het budget
node src/optimize.js --venster 3 --budget 91000000 --top 10
node src/expectations.js          verwachte punten wegschrijven voor de Pit Wall
node src/build-pitwall.js         de Pit Wall-pagina bouwen
```

**Draai `expectations.js` altijd vóór `build-pitwall.js`.** De pagina rekent haar
verwachtingen niet zelf uit maar leest ze in, zodat het model op één plek staat.
Ontbreekt `data/expectations.json`, dan stopt de bouw met een foutmelding in plaats
van een halve pagina op te leveren. `build-pitwall.js` schrijft ook
`dist/pitwall-preview.html`; open die lokaal voordat je pusht, want een fout in de
JavaScript maakt de pagina leeg en dat zie je online pas achter het wachtwoord.

## Werkwijze per raceweekend

De deadline is vijf minuten voor de kwalificatie, en bij een sprintweekend vijf minuten
voor de sprintrace. FP3 eindigt vlak daarvoor. Dat is het hele beslismoment.

1. **Maandag** — ronde opent (ronde 14 opent maandag 7 september 03:00). Haal de nieuwe
   prijzen en je nieuwe budget op, draai `optimize.js` voor een basisopstelling.
2. **Donderdag/vrijdag** — nieuws nalopen: gridstraffen, motorwissels, coureurswissels,
   blessures, weersverwachting. Zet wat je vindt in `data/adjustments.json`.
3. **Na FP2** — lange runs zeggen iets over racetempo. Dat weegt het zwaarst, want de
   race is 2,5 keer zoveel waard als de kwalificatie.
4. **Na FP3** — korte runs zeggen iets over de kwalificatie. Bijstellen, opnieuw draaien,
   opstelling opslaan.
5. **Voorspelling invullen.** Drie losse weddenschappen van 25 punten. Per plek kies je
   de coureur met de grootste kans om exact dáár te eindigen. Dezelfde coureur op twee
   plekken zetten kan kloppen, maar alleen als hij voor allebei die posities de
   waarschijnlijkste is — het is geen gratis verzekering.

## Gridstraffen — de belangrijkste valkuil

In dit spel telt de **uitslag van de kwalificatie**, niet de startopstelling. Het
reglement zegt letterlijk dat terugzettingen op de grid niet worden doorgevoerd. Een
gridstraf kost dus **nul kwalificatiepunten** en raakt alleen de race.

Trek een straf daarom nooit als vast bedrag van het weekendtotaal af. Schat waar de
coureur in de *race* uitkomt en laat de kwalificatie ongemoeid. Een gestrafte topcoureur
is in dit spel systematisch meer waard dan hij voelt.

## Bestanden

```
data/results-2026.json     kwalificatie, sprint en race, ronde 1 t/m 12
data/prices-round13.json   prijzen, budget en jokers per 5 september 2026
data/my-lineups.json       eigen opstellingen en toegekende punten (grondwaarheid)
data/adjustments.json      handmatige bijstellingen — nieuws, trainingen, straffen
src/scoring.js             puntentabel en scoreregels
src/validate.js            controle van het model tegen de werkelijkheid
src/form.js                vorm en rendement per miljoen
src/optimize.js            volledige doorrekening van alle geldige opstellingen
src/expectations.js        verwachte punten per coureur en onderdeel, voor de pagina
src/pitwall-source.html    bron van de Pit Wall — bewerk deze, niet de gebouwde versie
src/build-pitwall.js       bouwt de pagina en zet hem in de website-repo
data/expectations.json     gegenereerd, niet met de hand aanpassen
```

## Nog open

- Prijzen worden per ronde bijgewerkt; het prijsalgoritme is niet gepubliceerd. Door
  elke ronde de prijzen naast de gescoorde punten vast te leggen, kunnen we
  prijsstijging op termijn voorspellen in plaats van achteraf constateren.
- Jokerplanning. Er zijn er nog vier. De joker verdubbelt punten én salaris, dus vroeg
  inzetten is meer waard dan laat. De twee gebruikte jokers leverden 343 en 59 extra
  punten op — daar valt duidelijk winst te halen.
- Hoeveel gewicht een FP3-waarneming verdient ten opzichte van het vormgemiddelde. Dat
  meten we door elke ronde de verwachting naast de uitkomst te leggen.
