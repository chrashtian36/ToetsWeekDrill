// Vercel serverless function: proxy naar de Anthropic API voor vragengeneratie.
// De API-key staat ALLEEN hier (env var AI_API_KEY), nooit in client-code.
//
// Geen npm-dependencies: we gebruiken de globale fetch van de Vercel Node-runtime
// en de stabiele Anthropic REST API (anthropic-version: 2023-06-01). Dit past bij
// de "geen bundler, geen dependencies"-opzet van het project.
//
// Env vars:
//   AI_API_KEY   (verplicht)  Anthropic API-key
//   AI_MODEL     (optioneel)  model-id, standaard claude-opus-4-8
//                             (bv. claude-sonnet-4-6 of claude-haiku-4-5 voor lagere kosten)

export const maxDuration = 60; // ruim genoeg voor een vision-call met thinking uit

const MODEL = process.env.AI_MODEL || 'claude-opus-4-8';
const TYPE_OMSCHRIJVING = {
  flashcard: "alleen flashcards (type 'flashcard': vraag = voorkant, antwoord = achterkant)",
  mc: "alleen meerkeuzevragen (type 'mc': precies 4 opties in 'opties', en 'antwoord' is exact gelijk aan de juiste optie)",
  open: "alleen open vragen (type 'open': vraag + een beknopt modelantwoord)",
  gemengd: "een mix van flashcards, meerkeuzevragen (mc) en open vragen",
};

const TAAL_INSTRUCTIE = {
  auto: 'Schrijf de vragen en antwoorden in dezelfde taal als de aangeleverde stof.',
  nl: 'Schrijf de vragen en antwoorden in het Nederlands.',
  en: 'Write the questions and answers in English (the source material is for bilingual/TTO education).',
};

function systemPrompt() {
  return [
    'Je bent een ervaren docent die toetsvragen maakt voor een middelbare scholier.',
    'Genereer vragen op basis van de aangeleverde stof, passend bij het niveau, in de aangegeven taal.',
    'Antwoord UITSLUITEND met geldige JSON: een array van vraag-objecten, zonder extra tekst of uitleg.',
    'Elk object heeft deze velden:',
    '  - "type": "flashcard" | "mc" | "open"',
    '  - "vraag": de vraagtekst (bij flashcard: de voorkant)',
    '  - "antwoord": het juiste/model-antwoord (bij flashcard: de achterkant)',
    '  - "opties": ALLEEN bij type "mc" — precies 4 korte antwoordopties; "antwoord" moet exact gelijk zijn aan één van de opties',
    'Maak de vragen feitelijk correct, gevarieerd en duidelijk. Geen dubbele vragen.',
  ].join('\n');
}

function gebruikersInstructie({ vak, onderwerp, niveau, type, aantal, taal, heeftTekst, heeftAfbeelding }) {
  const r = [];
  r.push(`Vak: ${vak || 'onbekend'}.`);
  r.push(`Onderwerp: ${onderwerp || 'onbekend'}.`);
  if (niveau) r.push(`Niveau van de leerling: ${niveau}.`);
  r.push(TAAL_INSTRUCTIE[taal] || TAAL_INSTRUCTIE.auto);
  r.push(`Maak ${aantal} vragen: ${TYPE_OMSCHRIJVING[type] || TYPE_OMSCHRIJVING.gemengd}.`);
  if (heeftAfbeelding) r.push('De stof staat op de bijgevoegde afbeelding (aantekeningen, boekpagina of samenvatting).');
  if (heeftTekst) r.push('De stof staat in de onderstaande tekst.');
  if (!heeftAfbeelding && !heeftTekst) {
    r.push('Er is geen extra materiaal aangeleverd; baseer de vragen op het vak en onderwerp.');
  }
  r.push('Antwoord met alleen de JSON-array.');
  return r.join('\n');
}

// Haalt een JSON-array uit de modeltekst, ook als er ```json fences omheen staan.
function parseVragen(tekst) {
  let t = (tekst || '').trim();
  // strip code fences
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // pak desnoods alleen het deel tussen de eerste [ en laatste ]
  if (!t.startsWith('[')) {
    const start = t.indexOf('[');
    const eind = t.lastIndexOf(']');
    if (start !== -1 && eind !== -1 && eind > start) t = t.slice(start, eind + 1);
  }
  const data = JSON.parse(t);
  if (!Array.isArray(data)) throw new Error('geen JSON-array');
  return data;
}

// Valideer en normaliseer één vraag; gooit ongeldige weg (return null).
function normaliseer(v) {
  if (!v || typeof v !== 'object') return null;
  const type = ['flashcard', 'mc', 'open'].includes(v.type) ? v.type : 'flashcard';
  const vraag = String(v.vraag ?? '').trim();
  let antwoord = String(v.antwoord ?? '').trim();
  if (!vraag) return null;

  if (type === 'mc') {
    const opties = Array.isArray(v.opties) ? v.opties.map(o => String(o).trim()).filter(Boolean) : [];
    if (opties.length < 2) return null;
    const vier = opties.slice(0, 4);
    if (!vier.includes(antwoord)) antwoord = vier[0]; // val terug op eerste optie
    return { type, vraag, antwoord, opties: vier };
  }
  if (!antwoord) return null;
  return { type, vraag, antwoord };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ fout: 'Alleen POST is toegestaan.' });
  }
  if (!process.env.AI_API_KEY) {
    return res.status(500).json({ fout: 'Server niet geconfigureerd: AI_API_KEY ontbreekt.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { vak, onderwerp, niveau, tekst, afbeelding } = body;
    const type = ['flashcard', 'mc', 'open', 'gemengd'].includes(body.type) ? body.type : 'gemengd';
    const taal = ['auto', 'nl', 'en'].includes(body.taal) ? body.taal : 'auto';
    const aantal = Math.min(Math.max(parseInt(body.aantal, 10) || 10, 1), 30);

    const heeftTekst = typeof tekst === 'string' && tekst.trim().length > 0;
    const heeftAfbeelding = afbeelding && afbeelding.data && afbeelding.mediaType;
    if (!heeftTekst && !heeftAfbeelding) {
      return res.status(400).json({ fout: 'Lever een foto of tekst aan om vragen uit te genereren.' });
    }

    const content = [];
    if (heeftAfbeelding) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: afbeelding.mediaType, data: afbeelding.data },
      });
    }
    let instructie = gebruikersInstructie({ vak, onderwerp, niveau, type, aantal, taal, heeftTekst, heeftAfbeelding });
    if (heeftTekst) instructie += '\n\nStof:\n' + tekst.trim();
    content.push({ type: 'text', text: instructie });

    const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.AI_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        system: systemPrompt(),
        messages: [{ role: 'user', content }],
      }),
    });

    if (!apiResp.ok) {
      const detail = await apiResp.text().catch(() => '');
      console.error('Anthropic API-fout', apiResp.status, detail);
      return res.status(502).json({ fout: 'De AI-service gaf een fout terug. Probeer het later opnieuw.' });
    }

    const data = await apiResp.json();
    const tekstuit = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

    let ruwe;
    try {
      ruwe = parseVragen(tekstuit);
    } catch (e) {
      console.error('JSON-parse mislukt:', e.message, tekstuit.slice(0, 500));
      return res.status(502).json({ fout: 'De AI gaf geen bruikbare vragen terug. Probeer het opnieuw of met duidelijkere stof.' });
    }

    const vragen = ruwe.map(normaliseer).filter(Boolean);
    if (!vragen.length) {
      return res.status(502).json({ fout: 'Er konden geen geldige vragen worden gemaakt. Probeer het opnieuw.' });
    }

    return res.status(200).json({ vragen });
  } catch (e) {
    console.error('Onverwachte fout in /api/generate:', e);
    return res.status(500).json({ fout: 'Er ging iets mis bij het genereren.' });
  }
}
