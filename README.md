# ToetsweekDrill

Een PWA waarmee middelbare scholieren zich voorbereiden op de toetsweek met
flashcards, meerkeuzevragen en open vragen. Vakken, toetsen en vragen staan
lokaal in IndexedDB; vragen kunnen ook met AI uit een foto of tekst gegenereerd
worden.

Vanilla JavaScript, **geen build step en geen npm-dependencies**. Hosting via
Vercel; deploy door te pushen naar de gekoppelde Git-branch.

## Structuur

```
index.html            app-shell + service worker-registratie
css/style.css         mobile-first donker thema
js/app.js             schermen, router, formulieren
js/db.js              IndexedDB-wrapper
manifest.json, sw.js  statische PWA-bestanden
icons/                app-iconen (192/512)
api/generate.js       Vercel serverless function → Anthropic API (AI-generatie)
```

## AI-vragengeneratie instellen (Vercel)

De serverless function `api/generate.js` praat met de Anthropic API. De API-key
staat **uitsluitend** in een Vercel environment variable — nooit in client-code.

Zet in Vercel onder **Project → Settings → Environment Variables**:

| Variabele  | Verplicht | Uitleg |
|------------|-----------|--------|
| `AI_API_KEY` | ja      | Je Anthropic API-key (begint met `sk-ant-…`). Aan te maken op https://console.anthropic.com |
| `AI_MODEL`   | nee     | Model-id. Standaard `claude-opus-4-8`. Voor lagere kosten kun je `claude-sonnet-4-6` of `claude-haiku-4-5` zetten. |

Na het toevoegen of wijzigen van een variabele: opnieuw deployen (push of
"Redeploy" in Vercel) zodat de function de waarde oppikt.

> De rest van de app werkt volledig zonder key — alleen de AI-generatieknop
> heeft de function nodig.

## Lokaal draaien

Serveer de map met een statische server, bijvoorbeeld:

```
python -m http.server 8000
```

Open daarna http://localhost:8000. De AI-knop werkt lokaal niet (daarvoor draait
de serverless function alleen op Vercel); de rest van de app wel.

## Datamodel

```
Vak    { id, naam, kleur, emoji }
Toets  { id, vakId, onderwerp, datum, notities }
Vraag  { id, toetsId, type: 'flashcard'|'mc'|'open', vraag, antwoord,
         opties?, bron: 'handmatig'|'ai',
         box: 1|2|3, laatstGeoefend, stats: { goed, fout } }
```
