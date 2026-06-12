# ToetsweekDrill — Projectbriefing voor Claude Code

## Wat is het?

Een PWA waarmee middelbare scholieren zich voorbereiden op de toetsweek. Per vak staan er toetsen gepland, elke toets gaat over een onderwerp. De leerling oefent de stof via drills: flashcards, multiple choice en open vragen met zelfbeoordeling. Leerstof komt erin via handmatige invoer óf via AI-generatie uit een foto (aantekeningen, boekpagina, samenvatting) of geplakte tekst.

Doelgroep: mijn eigen dochters (Schoonhovens College), dus de interface is volledig Nederlands, mobile-first, en moet snel en zonder gedoe werken.

## Tech stack

- **Vanilla JavaScript PWA** — geen framework, geen build step
- **Multi-file architectuur** vanaf het begin: `index.html`, `css/style.css`, `js/app.js`, `js/db.js`, `js/drill.js`, `js/ai.js`, `js/translations.js` is niet nodig (alleen NL)
- **IndexedDB** voor alle data (vakken, toetsen, vragen, voortgang). Schrijf een dunne wrapper in `js/db.js` met async/await helpers
- **Vercel** hosting, deploy via Git
- **Eén serverless function**: `api/generate.js` (Vercel function) die requests doorstuurt naar de Anthropic API (of OpenRouter), met de API-key in een Vercel environment variable `AI_API_KEY`. NOOIT een key in client-code
- **Statische `manifest.json` en `sw.js`** in de root — geen dynamisch gegenereerde manifest. Dit is essentieel voor een echte PWA-install op Android (geleerd van een eerder project waar Chrome anders alleen een bookmark maakte)
- Ontwikkelomgeving: **Windows** — gebruik Windows-compatibele paden en commando's

## Datamodel

```
Vak { id, naam, kleur, emoji }
Toets { id, vakId, onderwerp, datum, notities }
Vraag {
  id, toetsId,
  type: 'flashcard' | 'mc' | 'open',
  vraag: string,            // voorkant / vraagtekst
  antwoord: string,         // achterkant / juiste antwoord / modelantwoord
  opties?: string[],        // alleen bij mc: 4 opties, antwoord = juiste optie
  bron: 'handmatig' | 'ai',
  // Leitner-voortgang:
  box: 1 | 2 | 3,           // 1 = moeilijk, 3 = beheerst
  laatstGeoefend: timestamp | null,
  stats: { goed: number, fout: number }
}
```

## Oefenlogica (Leitner light)

- Een drillsessie pakt vragen van één toets, gewogen: box 1-vragen komen vaakst terug, box 3 zelden
- Goed beantwoord → vraag schuift een box omhoog; fout → terug naar box 1
- Bij **flashcards**: leerling ziet vraag, tikt om antwoord te tonen, beoordeelt zichzelf (Goed / Bijna / Fout). Bijna = blijft in dezelfde box
- Bij **multiple choice**: 4 opties, directe feedback, juiste antwoord wordt groen gehighlight
- Bij **open vragen**: leerling typt of denkt het antwoord, tikt op "Toon antwoord", beoordeelt zichzelf zoals bij flashcards
- Sessie eindigt na een instelbaar aantal vragen (standaard 20) of als alles in box 3 zit, met een resultaatscherm (score, zwakste vragen)
- Per toets een voortgangsindicator: % vragen in box 3 = "beheersing"

## AI-vragengeneratie

Flow in de app:
1. Leerling kiest een toets en tikt op "Vragen genereren met AI"
2. Upload een foto (camera of galerij) óf plak tekst
3. Client stuurt dit (foto als base64) naar `api/generate.js` samen met vak + onderwerp + gewenst vraagtype
4. De serverless function prompt het model om **uitsluitend JSON** terug te geven: een array van Vraag-objecten (zonder id/voortgangsvelden)
5. Client toont de gegenereerde vragen in een **reviewlijst**: leerling kan per vraag bewerken, verwijderen of accepteren voordat ze worden opgeslagen. Nooit blind opslaan
6. Foutafhandeling: strip eventuele ```json fences vóór JSON.parse, toon nette foutmelding bij mislukking

Promptrichtlijn voor de function: "Je bent een docent die toetsvragen maakt voor een middelbare scholier. Genereer vragen op basis van de aangeleverde stof, in het Nederlands, passend bij het niveau. Antwoord uitsluitend met geldige JSON."

## Schermen

1. **Home** — lijst van vakken met aankomende toetsen (gesorteerd op datum, dagen-tot-toets badge)
2. **Toets-detail** — onderwerp, datum, vragenlijst, beheersings-percentage, knoppen: "Drillen", "Vraag toevoegen", "AI genereren"
3. **Drill-scherm** — fullscreen oefenmodus, grote tikbare kaarten, voortgangsbalk bovenin
4. **Resultaat** — score van de sessie, lijst van foute vragen met optie "Oefen deze opnieuw"
5. **Beheer** — vakken/toetsen toevoegen en bewerken, JSON export/import (download/upload van het hele databestand)

## Design

- Mobile-first, donker thema als basis (leren gebeurt vaak 's avonds), grote touch targets
- Per vak een kleur + emoji, consistent doorgevoerd
- Snelle, snappy interactie: geen onnodige animaties, maar wél een korte flip-animatie bij flashcards
- Geen login, geen onboarding — app opent direct op Home

## Fasering

Werk in fases. Na elke fase: commit, push, deploy naar Vercel, en wacht tot ik heb geverifieerd voordat je doorgaat.

**Fase 1 — Skelet & data**
Projectstructuur, IndexedDB-wrapper, manifest.json + sw.js (cache-first voor statische assets), Home- en Beheer-scherm, vakken en toetsen aanmaken, handmatig vragen toevoegen (alle drie de types). JSON export/import.

**Fase 2 — Drill-engine**
Leitner-logica, drill-scherm voor alle drie de vraagtypes, resultaatscherm, beheersings-percentage per toets.

**Fase 3 — AI-generatie**
`api/generate.js` serverless function, foto/tekst-upload UI, reviewlijst voor gegenereerde vragen. Environment variable documenteren in een korte README.

**Fase 4 — Polish**
PWA-install testen op Android (echte install, geen bookmark!), offline-gedrag verifiëren, dagen-tot-toets badges, lege-staat schermen, kleine UX-verbeteringen.

## Niet doen

- Geen framework, geen bundler, geen TypeScript
- Geen accounts of backend-database — alles lokaal behalve de AI-call
- Geen Engelse UI-teksten
- Geen API-keys in client-code
