// Drill-engine: fullscreen oefensessie met Leitner-light logica.
// Box 1 (moeilijk) komt het vaakst terug, box 3 (beheerst) zelden.
// Goed → box omhoog; Fout → terug naar box 1; Bijna → blijft in dezelfde box.

import * as db from './db.js';

const GEWICHT = { 1: 5, 2: 2, 3: 1 };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// vragen: array Vraag-objecten (uit één toets, of een subset om opnieuw te oefenen)
// lengte: aantal vragen deze sessie (genegeerd als alles=true)
// alles: elke vraag precies één keer, zwakste eerst
export function startDrill({ vragen, lengte = 20, alles = false, onKlaar }) {
  const overlay = document.createElement('div');
  overlay.className = 'drill-overlay';
  document.body.appendChild(overlay);
  document.body.classList.add('drill-actief');

  const pool = vragen.map(v => ({ ...v })); // lokale kopieën; box muteert mee
  const queue = alles ? [...pool].sort((a, b) => a.box - b.box) : null;
  const totaalTurns = alles ? queue.length : Math.max(1, lengte);

  let beantwoord = 0;
  let goed = 0, bijna = 0;
  const fouteMap = new Map(); // id -> vraag (voor de resultatenlijst)
  let vorigeId = null;

  const allesBeheerst = () => pool.every(v => v.box === 3);

  function kiesVraag() {
    if (alles) return queue[beantwoord];
    let kandidaten = pool;
    if (pool.length > 1 && vorigeId != null) kandidaten = pool.filter(v => v.id !== vorigeId);
    const totaal = kandidaten.reduce((s, v) => s + (GEWICHT[v.box] || 1), 0);
    let r = Math.random() * totaal;
    for (const v of kandidaten) {
      r -= (GEWICHT[v.box] || 1);
      if (r <= 0) return v;
    }
    return kandidaten[kandidaten.length - 1];
  }

  function sluit() {
    overlay.remove();
    document.body.classList.remove('drill-actief');
    onKlaar?.();
  }

  async function verwerk(vraag, oordeel) {
    vraag.box = oordeel === 'goed' ? Math.min(vraag.box + 1, 3) : oordeel === 'fout' ? 1 : vraag.box;
    const stats = vraag.stats || { goed: 0, fout: 0 };
    if (oordeel === 'goed') { stats.goed++; goed++; }
    else if (oordeel === 'fout') { stats.fout++; fouteMap.set(vraag.id, vraag); }
    else { bijna++; }
    vraag.stats = stats;
    vraag.laatstGeoefend = Date.now();
    await db.put('vragen', { ...vraag });

    beantwoord++;
    vorigeId = vraag.id;
    volgende();
  }

  function volgende() {
    if (beantwoord >= totaalTurns || allesBeheerst()) { toonResultaat(); return; }
    toonVraag(kiesVraag());
  }

  function updateVoortgang() {
    const pct = Math.round((beantwoord / totaalTurns) * 100);
    overlay.querySelector('.voortgang-vul').style.width = pct + '%';
    overlay.querySelector('.drill-teller').textContent = `${beantwoord}/${totaalTurns}`;
  }

  function chroom(inner) {
    overlay.innerHTML = `
      <header class="drill-kop">
        <button class="drill-sluit" aria-label="Stoppen">✕</button>
        <div class="voortgangsbalk"><div class="voortgang-vul"></div></div>
        <span class="drill-teller"></span>
      </header>
      <main class="drill-body">${inner}</main>`;
    overlay.querySelector('.drill-sluit').addEventListener('click', sluit);
    updateVoortgang();
  }

  function beoordeelHtml() {
    return `
      <div class="beoordeel" hidden>
        <button class="oordeel-knop oordeel-fout" data-oordeel="fout">Fout</button>
        <button class="oordeel-knop oordeel-bijna" data-oordeel="bijna">Bijna</button>
        <button class="oordeel-knop oordeel-goed" data-oordeel="goed">Goed</button>
      </div>`;
  }

  function bindBeoordeel(vraag) {
    overlay.querySelectorAll('.beoordeel .oordeel-knop').forEach(b =>
      b.addEventListener('click', () => verwerk(vraag, b.dataset.oordeel)));
  }

  function toonVraag(vraag) {
    if (vraag.type === 'flashcard') {
      chroom(`
        <div class="drill-kaartwrap">
          <div class="flip-kaart" id="flip" role="button" tabindex="0" aria-label="Tik om het antwoord te zien">
            <div class="flip-binnen">
              <div class="flip-voor">
                <span class="type-chip type-flashcard">Flashcard</span>
                <p class="kaart-tekst">${esc(vraag.vraag)}</p>
                <span class="kaart-hint">tik om het antwoord te zien</span>
              </div>
              <div class="flip-achter">
                <p class="kaart-tekst">${esc(vraag.antwoord)}</p>
              </div>
            </div>
          </div>
        </div>
        ${beoordeelHtml()}`);
      const flip = overlay.querySelector('#flip');
      const beoordeel = overlay.querySelector('.beoordeel');
      const draai = () => {
        if (flip.classList.contains('omgedraaid')) return;
        flip.classList.add('omgedraaid');
        beoordeel.hidden = false;
      };
      flip.addEventListener('click', draai);
      flip.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); draai(); }
      });
      bindBeoordeel(vraag);

    } else if (vraag.type === 'open') {
      chroom(`
        <div class="drill-kaartwrap open-wrap">
          <span class="type-chip type-open">Open vraag</span>
          <p class="kaart-tekst">${esc(vraag.vraag)}</p>
          <textarea class="open-invoer" rows="3" placeholder="Typ of denk je antwoord… (optioneel)"></textarea>
          <button class="knop primair toon-antwoord">Toon antwoord</button>
          <div class="modelantwoord" hidden>
            <span class="veldkop">Antwoord</span>
            <p class="kaart-tekst">${esc(vraag.antwoord)}</p>
          </div>
        </div>
        ${beoordeelHtml()}`);
      const toon = overlay.querySelector('.toon-antwoord');
      const model = overlay.querySelector('.modelantwoord');
      const beoordeel = overlay.querySelector('.beoordeel');
      toon.addEventListener('click', () => {
        model.hidden = false;
        toon.hidden = true;
        beoordeel.hidden = false;
      });
      bindBeoordeel(vraag);

    } else { // mc
      const opties = shuffle(vraag.opties || []);
      chroom(`
        <div class="drill-kaartwrap mc-wrap">
          <span class="type-chip type-mc">Meerkeuze</span>
          <p class="kaart-tekst">${esc(vraag.vraag)}</p>
          <div class="mc-opties">
            ${opties.map(o => `<button class="mc-optie" data-optie="${esc(o)}">${esc(o)}</button>`).join('')}
          </div>
          <button class="knop primair mc-volgende" hidden>Volgende</button>
        </div>`);
      const knoppen = [...overlay.querySelectorAll('.mc-optie')];
      const volgendeBtn = overlay.querySelector('.mc-volgende');
      let gedaan = false;
      knoppen.forEach(b => b.addEventListener('click', () => {
        if (gedaan) return;
        gedaan = true;
        const juist = b.dataset.optie === vraag.antwoord;
        knoppen.forEach(k => {
          k.disabled = true;
          if (k.dataset.optie === vraag.antwoord) k.classList.add('mc-goed');
          else if (k === b) k.classList.add('mc-fout');
        });
        volgendeBtn.hidden = false;
        volgendeBtn.addEventListener('click', () => verwerk(vraag, juist ? 'goed' : 'fout'), { once: true });
      }));
    }
  }

  function toonResultaat() {
    document.body.classList.remove('drill-actief'); // resultaat mag scrollen, tabbar blijft verborgen via overlay
    const foute = [...fouteMap.values()];
    const pct = beantwoord ? Math.round((goed / beantwoord) * 100) : 0;
    const emoji = beantwoord === 0 ? '✅' : pct >= 80 ? '🎉' : pct >= 50 ? '💪' : '📚';

    overlay.innerHTML = `
      <div class="drill-resultaat">
        <span class="resultaat-emoji">${emoji}</span>
        <h2>${beantwoord === 0 ? 'Alles beheerst' : 'Sessie klaar!'}</h2>
        ${beantwoord === 0
          ? `<p class="stil">Alle vragen zitten al in box 3. Niks meer te oefenen!</p>`
          : `<p class="resultaat-score">${goed} van ${beantwoord} goed${bijna ? ` · ${bijna} bijna` : ''}</p>
             <div class="beheersing-balk groot"><div class="beheersing-vulling" style="width:${pct}%"></div></div>`}
        ${foute.length ? `
          <h3 class="sectiekop">Nog oefenen (${foute.length})</h3>
          <ul class="resultaat-foutlijst">
            ${foute.map(v => `
              <li class="kaart">
                <strong>${esc(v.vraag)}</strong>
                <span class="stil">${esc(v.antwoord)}</span>
              </li>`).join('')}
          </ul>`
          : beantwoord ? `<p class="stil">Top — niks fout! 🙌</p>` : ''}
        <div class="knoppenrij">
          ${foute.length ? `<button class="knop" id="oefenFoute">Oefen foute opnieuw</button>` : ''}
          <button class="knop primair" id="drillKlaar">Klaar</button>
        </div>
      </div>`;

    overlay.querySelector('#drillKlaar').addEventListener('click', sluit);
    if (foute.length) {
      overlay.querySelector('#oefenFoute').addEventListener('click', () => {
        overlay.remove();
        startDrill({ vragen: foute, alles: true, onKlaar });
      });
    }
  }

  volgende(); // start
}
