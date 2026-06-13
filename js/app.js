import * as db from './db.js';

const PALET = ['#ef5350', '#ff7043', '#ffca28', '#66bb6a', '#26a69a', '#42a5f5', '#5c6bc0', '#ab47bc', '#ec407a', '#8d6e63'];
const EMOJI_SUGGESTIES = ['📐', '🧮', '🧪', '🔬', '🌍', '📜', '🇳🇱', '🇬🇧', '🇫🇷', '🇩🇪', '💻', '🎨', '🎵', '⚽', '📊', '📖'];
const TYPE_LABEL = { flashcard: 'Flashcard', mc: 'Meerkeuze', open: 'Open vraag' };

const appEl = document.getElementById('app');

/* ===== helpers ===== */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function uuid() {
  return crypto.randomUUID();
}

function dagenTot(datumStr) {
  const nu = new Date();
  nu.setHours(0, 0, 0, 0);
  const d = new Date(datumStr + 'T00:00:00');
  return Math.round((d - nu) / 86400000);
}

function badgeHtml(datumStr) {
  const d = dagenTot(datumStr);
  let tekst, klasse;
  if (d < 0) { tekst = 'geweest'; klasse = 'geweest'; }
  else if (d === 0) { tekst = 'vandaag'; klasse = 'urgent'; }
  else if (d === 1) { tekst = 'morgen'; klasse = 'urgent'; }
  else if (d <= 7) { tekst = `over ${d} dagen`; klasse = 'snel'; }
  else { tekst = `over ${d} dagen`; klasse = 'later'; }
  return `<span class="badge badge-${klasse}">${tekst}</span>`;
}

function datumNL(datumStr) {
  return new Date(datumStr + 'T00:00:00')
    .toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
}

function beheersing(vragen) {
  if (!vragen.length) return 0;
  return Math.round(vragen.filter(v => v.box === 3).length / vragen.length * 100);
}

function boxDots(box) {
  return '●'.repeat(box) + '○'.repeat(3 - box);
}

// Bouwt een op te slaan Vraag-object met voortgangsvelden. `bestaand` is een
// optionele bestaande vraag waarvan we id/voortgang willen behouden.
function maakVraag(toetsId, { type, vraag, antwoord, opties }, bestaand = null, bron = 'handmatig') {
  const obj = {
    id: bestaand?.id ?? uuid(),
    toetsId,
    type,
    vraag,
    antwoord,
    bron: bestaand?.bron ?? bron,
    box: bestaand?.box ?? 1,
    laatstGeoefend: bestaand?.laatstGeoefend ?? null,
    stats: bestaand?.stats ?? { goed: 0, fout: 0 },
  };
  if (type === 'mc') obj.opties = opties;
  return obj;
}

/* ===== router ===== */

async function render() {
  const hash = location.hash || '#/home';
  const actieveTab = hash.startsWith('#/beheer') ? 'beheer' : 'home';
  document.querySelectorAll('.tabbar a').forEach(a => {
    a.classList.toggle('actief', a.dataset.tab === actieveTab);
  });

  if (hash.startsWith('#/toets/')) {
    await renderToets(hash.slice('#/toets/'.length));
  } else if (hash.startsWith('#/beheer')) {
    await renderBeheer();
  } else {
    await renderHome();
  }
  window.scrollTo(0, 0);
}

/* ===== Home ===== */

async function renderHome() {
  const [vakken, toetsen] = await Promise.all([db.getAll('vakken'), db.getAll('toetsen')]);

  if (!vakken.length) {
    appEl.innerHTML = `
      <div class="leeg">
        <span class="leeg-emoji">📚</span>
        <h2>Welkom bij ToetsweekDrill</h2>
        <p>Maak eerst een vak en een toets aan, voeg vragen toe en ga drillen.</p>
        <a class="knop primair" href="#/beheer">Naar Beheer</a>
      </div>`;
    return;
  }

  const perVak = vakken.map(vak => {
    const eigen = toetsen
      .filter(t => t.vakId === vak.id)
      .sort((a, b) => a.datum.localeCompare(b.datum));
    const aankomend = eigen.find(t => dagenTot(t.datum) >= 0);
    return { vak, toetsen: eigen, sortKey: aankomend ? aankomend.datum : '9999-12-31' };
  }).sort((a, b) =>
    a.sortKey.localeCompare(b.sortKey) || a.vak.naam.localeCompare(b.vak.naam, 'nl'),
  );

  appEl.innerHTML = `<h2 class="schermtitel">Aankomende toetsen</h2>` + perVak.map(({ vak, toetsen }) => `
    <section class="kaart vak-kaart" style="--vakkleur:${esc(vak.kleur)}">
      <header class="vak-kop">
        <span class="vak-emoji">${esc(vak.emoji)}</span>
        <h3>${esc(vak.naam)}</h3>
      </header>
      ${toetsen.length ? `
        <ul class="toets-lijst">
          ${toetsen.map(t => `
            <li>
              <a class="toets-rij" href="#/toets/${esc(t.id)}">
                <span class="toets-info">
                  <strong>${esc(t.onderwerp)}</strong>
                  <span class="toets-datum">${datumNL(t.datum)}</span>
                </span>
                ${badgeHtml(t.datum)}
              </a>
            </li>`).join('')}
        </ul>`
      : `<p class="stil">Nog geen toetsen gepland.</p>`}
    </section>`).join('');
}

/* ===== Toets-detail ===== */

async function renderToets(id) {
  const toets = await db.get('toetsen', id);
  if (!toets) {
    location.hash = '#/home';
    return;
  }
  const [vak, vragen] = await Promise.all([
    db.get('vakken', toets.vakId),
    db.getAllByIndex('vragen', 'toetsId', id),
  ]);
  const pct = beheersing(vragen);

  appEl.innerHTML = `
    <a class="terug" href="#/home">‹ Terug</a>
    <section class="kaart vak-kaart" style="--vakkleur:${esc(vak?.kleur ?? '#666')}">
      <header class="vak-kop">
        <span class="vak-emoji">${esc(vak?.emoji ?? '📚')}</span>
        <h3>${esc(vak?.naam ?? 'Onbekend vak')}</h3>
      </header>
      <h2 class="toets-onderwerp">${esc(toets.onderwerp)}</h2>
      <p class="toets-datum">${datumNL(toets.datum)} ${badgeHtml(toets.datum)}</p>
      ${toets.notities ? `<p class="notities">${esc(toets.notities)}</p>` : ''}
      <div class="beheersing">
        <div class="beheersing-balk"><div class="beheersing-vulling" style="width:${pct}%"></div></div>
        <span class="stil">${pct}% beheerst · ${vragen.length} ${vragen.length === 1 ? 'vraag' : 'vragen'}</span>
      </div>
      <div class="knoppenrij">
        <button class="knop primair" disabled title="Komt in fase 2">▶ Drillen</button>
        <button class="knop" id="nieuweVraag">+ Vraag</button>
        <button class="knop" id="aiVraag">✨ AI</button>
      </div>
    </section>
    <h3 class="sectiekop">Vragen</h3>
    ${vragen.length ? `
      <ul class="vraag-lijst">
        ${vragen.map(v => `
          <li class="kaart vraag-rij">
            <div class="vraag-info">
              <span class="type-chip type-${v.type}">${TYPE_LABEL[v.type]}</span>
              <p class="vraag-tekst">${esc(v.vraag)}</p>
              <span class="box-dots" title="Box ${v.box} van 3">${boxDots(v.box)}</span>
            </div>
            <div class="vraag-acties">
              <button class="icoonknop" data-bewerk="${esc(v.id)}" aria-label="Bewerken">✏️</button>
              <button class="icoonknop" data-verwijder="${esc(v.id)}" aria-label="Verwijderen">🗑️</button>
            </div>
          </li>`).join('')}
      </ul>`
    : `<p class="stil leeg-klein">Nog geen vragen. Voeg er een toe met “+ Vraag”.</p>`}
  `;

  document.getElementById('nieuweVraag').addEventListener('click', () => vraagForm(toets.id));
  document.getElementById('aiVraag').addEventListener('click', () => aiForm(toets, vak));
  appEl.querySelectorAll('[data-bewerk]').forEach(b => b.addEventListener('click', () => {
    vraagForm(toets.id, vragen.find(v => v.id === b.dataset.bewerk));
  }));
  appEl.querySelectorAll('[data-verwijder]').forEach(b => b.addEventListener('click', async () => {
    if (confirm('Deze vraag verwijderen?')) {
      await db.del('vragen', b.dataset.verwijder);
      render();
    }
  }));
}

/* ===== Beheer ===== */

async function renderBeheer() {
  const [vakken, toetsen] = await Promise.all([db.getAll('vakken'), db.getAll('toetsen')]);
  vakken.sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  toetsen.sort((a, b) => a.datum.localeCompare(b.datum));
  const vakVan = id => vakken.find(v => v.id === id);

  appEl.innerHTML = `
    <h2 class="schermtitel">Beheer</h2>

    <h3 class="sectiekop">Vakken</h3>
    ${vakken.length ? `
      <ul class="beheer-lijst">
        ${vakken.map(v => `
          <li class="kaart beheer-rij" style="--vakkleur:${esc(v.kleur)}">
            <span class="vak-emoji">${esc(v.emoji)}</span>
            <span class="beheer-info">
              <strong>${esc(v.naam)}</strong>
              <span class="stil">${toetsen.filter(t => t.vakId === v.id).length} toetsen</span>
            </span>
            <button class="icoonknop" data-vak-bewerk="${esc(v.id)}" aria-label="Bewerken">✏️</button>
            <button class="icoonknop" data-vak-verwijder="${esc(v.id)}" aria-label="Verwijderen">🗑️</button>
          </li>`).join('')}
      </ul>`
    : `<p class="stil leeg-klein">Nog geen vakken.</p>`}
    <button class="knop" id="nieuwVak">+ Vak toevoegen</button>

    <h3 class="sectiekop">Toetsen</h3>
    ${toetsen.length ? `
      <ul class="beheer-lijst">
        ${toetsen.map(t => `
          <li class="kaart beheer-rij" style="--vakkleur:${esc(vakVan(t.vakId)?.kleur ?? '#666')}">
            <span class="vak-emoji">${esc(vakVan(t.vakId)?.emoji ?? '📚')}</span>
            <a class="beheer-info" href="#/toets/${esc(t.id)}">
              <strong>${esc(t.onderwerp)}</strong>
              <span class="stil">${esc(vakVan(t.vakId)?.naam ?? 'Onbekend vak')} · ${datumNL(t.datum)}</span>
            </a>
            <button class="icoonknop" data-toets-bewerk="${esc(t.id)}" aria-label="Bewerken">✏️</button>
            <button class="icoonknop" data-toets-verwijder="${esc(t.id)}" aria-label="Verwijderen">🗑️</button>
          </li>`).join('')}
      </ul>`
    : `<p class="stil leeg-klein">Nog geen toetsen.</p>`}
    <button class="knop" id="nieuweToets" ${vakken.length ? '' : 'disabled'}>+ Toets toevoegen</button>
    ${vakken.length ? '' : '<p class="stil">Maak eerst een vak aan.</p>'}

    <h3 class="sectiekop">Data</h3>
    <div class="knoppenrij">
      <button class="knop" id="exporteer">⬇ Exporteren</button>
      <button class="knop" id="importeer">⬆ Importeren</button>
      <input type="file" id="importBestand" accept="application/json,.json" hidden>
    </div>
    <p class="stil">Export bevat alle vakken, toetsen, vragen en voortgang als JSON-bestand. Import vervangt alle huidige data.</p>
  `;

  document.getElementById('nieuwVak').addEventListener('click', () => vakForm());
  appEl.querySelectorAll('[data-vak-bewerk]').forEach(b => b.addEventListener('click', () => {
    vakForm(vakken.find(v => v.id === b.dataset.vakBewerk));
  }));
  appEl.querySelectorAll('[data-vak-verwijder]').forEach(b => b.addEventListener('click', async () => {
    const vak = vakken.find(v => v.id === b.dataset.vakVerwijder);
    const n = toetsen.filter(t => t.vakId === vak.id).length;
    if (confirm(`Vak “${vak.naam}” verwijderen? ${n ? `Ook de ${n} bijbehorende toetsen en hun vragen worden verwijderd.` : ''}`)) {
      await verwijderVak(vak.id);
      render();
    }
  }));

  const toetsKnop = document.getElementById('nieuweToets');
  if (!toetsKnop.disabled) toetsKnop.addEventListener('click', () => toetsForm(vakken));
  appEl.querySelectorAll('[data-toets-bewerk]').forEach(b => b.addEventListener('click', () => {
    toetsForm(vakken, toetsen.find(t => t.id === b.dataset.toetsBewerk));
  }));
  appEl.querySelectorAll('[data-toets-verwijder]').forEach(b => b.addEventListener('click', async () => {
    const toets = toetsen.find(t => t.id === b.dataset.toetsVerwijder);
    if (confirm(`Toets “${toets.onderwerp}” en alle bijbehorende vragen verwijderen?`)) {
      await verwijderToets(toets.id);
      render();
    }
  }));

  document.getElementById('exporteer').addEventListener('click', exporteerData);
  const bestandInput = document.getElementById('importBestand');
  document.getElementById('importeer').addEventListener('click', () => bestandInput.click());
  bestandInput.addEventListener('change', () => {
    if (bestandInput.files[0]) importeerData(bestandInput.files[0]);
  });
}

async function verwijderVak(vakId) {
  const toetsen = await db.getAllByIndex('toetsen', 'vakId', vakId);
  for (const t of toetsen) await verwijderToets(t.id);
  await db.del('vakken', vakId);
}

async function verwijderToets(toetsId) {
  const vragen = await db.getAllByIndex('vragen', 'toetsId', toetsId);
  for (const v of vragen) await db.del('vragen', v.id);
  await db.del('toetsen', toetsId);
}

/* ===== Export / import ===== */

async function exporteerData() {
  const data = await db.exportAlles();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `toetsweekdrill-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function importeerData(bestand) {
  try {
    const data = JSON.parse(await bestand.text());
    if (!Array.isArray(data.vakken) || !Array.isArray(data.toetsen) || !Array.isArray(data.vragen)) {
      throw new Error('het bestand heeft niet het juiste formaat');
    }
    const samenvatting = `${data.vakken.length} vakken, ${data.toetsen.length} toetsen, ${data.vragen.length} vragen`;
    if (!confirm(`Import vervangt alle huidige data door: ${samenvatting}. Doorgaan?`)) return;
    await db.importAlles(data);
    render();
  } catch (e) {
    alert('Importeren mislukt: ' + e.message);
  }
}

/* ===== Dialogen ===== */

function openDialog(html) {
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet';
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', e => {
    if (e.target === dlg) dlg.close();
  });
  dlg.querySelector('[data-annuleer]')?.addEventListener('click', () => dlg.close());
  dlg.showModal();
  return dlg;
}

/* ----- Vak-formulier ----- */

function vakForm(vak = null) {
  const kleur = vak?.kleur ?? PALET[Math.floor(Math.random() * PALET.length)];
  const dlg = openDialog(`
    <form id="vakForm">
      <h3>${vak ? 'Vak bewerken' : 'Nieuw vak'}</h3>
      <label>Naam
        <input name="naam" required maxlength="40" autocomplete="off" value="${esc(vak?.naam ?? '')}">
      </label>
      <label>Emoji
        <input name="emoji" maxlength="8" autocomplete="off" value="${esc(vak?.emoji ?? '📚')}">
      </label>
      <div class="emoji-rij">
        ${EMOJI_SUGGESTIES.map(e => `<button type="button" class="emoji-keuze" data-emoji="${e}">${e}</button>`).join('')}
      </div>
      <span class="veldkop">Kleur</span>
      <div class="kleur-rij">
        ${PALET.map(k => `<button type="button" class="kleur-keuze ${k === kleur ? 'actief' : ''}" data-kleur="${k}" style="background:${k}" aria-label="${k}"></button>`).join('')}
      </div>
      <div class="knoppenrij">
        <button type="button" class="knop" data-annuleer>Annuleren</button>
        <button type="submit" class="knop primair">Opslaan</button>
      </div>
    </form>
  `);

  const form = dlg.querySelector('#vakForm');
  let gekozenKleur = kleur;
  dlg.querySelectorAll('.kleur-keuze').forEach(b => b.addEventListener('click', () => {
    gekozenKleur = b.dataset.kleur;
    dlg.querySelectorAll('.kleur-keuze').forEach(x => x.classList.toggle('actief', x === b));
  }));
  dlg.querySelectorAll('.emoji-keuze').forEach(b => b.addEventListener('click', () => {
    form.elements.emoji.value = b.dataset.emoji;
  }));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    await db.put('vakken', {
      id: vak?.id ?? uuid(),
      naam: form.elements.naam.value.trim(),
      kleur: gekozenKleur,
      emoji: form.elements.emoji.value.trim() || '📚',
    });
    dlg.close();
    render();
  });
}

/* ----- Toets-formulier ----- */

function toetsForm(vakken, toets = null) {
  const dlg = openDialog(`
    <form id="toetsForm">
      <h3>${toets ? 'Toets bewerken' : 'Nieuwe toets'}</h3>
      <label>Vak
        <select name="vakId" required>
          ${vakken.map(v => `<option value="${esc(v.id)}" ${v.id === toets?.vakId ? 'selected' : ''}>${esc(v.emoji)} ${esc(v.naam)}</option>`).join('')}
        </select>
      </label>
      <label>Onderwerp
        <input name="onderwerp" required maxlength="80" autocomplete="off" value="${esc(toets?.onderwerp ?? '')}">
      </label>
      <label>Datum
        <input type="date" name="datum" required value="${esc(toets?.datum ?? '')}">
      </label>
      <label>Notities (optioneel)
        <textarea name="notities" rows="2">${esc(toets?.notities ?? '')}</textarea>
      </label>
      <div class="knoppenrij">
        <button type="button" class="knop" data-annuleer>Annuleren</button>
        <button type="submit" class="knop primair">Opslaan</button>
      </div>
    </form>
  `);

  const form = dlg.querySelector('#toetsForm');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    await db.put('toetsen', {
      id: toets?.id ?? uuid(),
      vakId: form.elements.vakId.value,
      onderwerp: form.elements.onderwerp.value.trim(),
      datum: form.elements.datum.value,
      notities: form.elements.notities.value.trim(),
    });
    dlg.close();
    render();
  });
}

/* ----- Vraag-formulier ----- */

function vraagForm(toetsId, vraag = null) {
  const type0 = vraag?.type ?? 'flashcard';
  const dlg = openDialog(`
    <form id="vraagForm">
      <h3>${vraag ? 'Vraag bewerken' : 'Nieuwe vraag'}</h3>
      <div class="segmenten">
        ${Object.entries(TYPE_LABEL).map(([t, label]) =>
          `<button type="button" data-type="${t}" class="${t === type0 ? 'actief' : ''}">${label}</button>`).join('')}
      </div>
      <label><span id="vraagLabel"></span>
        <textarea name="vraag" required rows="3">${esc(vraag?.vraag ?? '')}</textarea>
      </label>
      <label id="veldAntwoord"><span id="antwoordLabel"></span>
        <textarea name="antwoord" rows="3">${esc(vraag && vraag.type !== 'mc' ? vraag.antwoord : '')}</textarea>
      </label>
      <div id="veldOpties" hidden>
        <span class="veldkop">Opties — vink het juiste antwoord aan</span>
        ${[0, 1, 2, 3].map(i => `
          <div class="optie-rij">
            <input type="radio" name="juist" value="${i}" aria-label="Optie ${i + 1} is juist">
            <input type="text" name="optie${i}" placeholder="Optie ${i + 1}" autocomplete="off">
          </div>`).join('')}
      </div>
      <div class="knoppenrij">
        <button type="button" class="knop" data-annuleer>Annuleren</button>
        <button type="submit" class="knop primair">Opslaan</button>
      </div>
    </form>
  `);

  const form = dlg.querySelector('#vraagForm');
  const veldAntwoord = dlg.querySelector('#veldAntwoord');
  const veldOpties = dlg.querySelector('#veldOpties');
  let type = type0;

  // Bestaande mc-vraag: opties en juiste antwoord invullen
  if (vraag?.type === 'mc' && Array.isArray(vraag.opties)) {
    vraag.opties.forEach((optie, i) => {
      if (i < 4) form.elements['optie' + i].value = optie;
      if (optie === vraag.antwoord) form.elements.juist.value = String(i);
    });
  }

  function pasTypeToe() {
    const mc = type === 'mc';
    veldAntwoord.hidden = mc;
    form.elements.antwoord.required = !mc;
    veldOpties.hidden = !mc;
    dlg.querySelector('#vraagLabel').textContent =
      type === 'flashcard' ? 'Voorkant' : 'Vraag';
    dlg.querySelector('#antwoordLabel').textContent =
      type === 'flashcard' ? 'Achterkant' : 'Antwoord';
    dlg.querySelectorAll('.segmenten button').forEach(b =>
      b.classList.toggle('actief', b.dataset.type === type));
  }
  pasTypeToe();

  dlg.querySelectorAll('.segmenten button').forEach(b => b.addEventListener('click', () => {
    type = b.dataset.type;
    pasTypeToe();
  }));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const vraagTekst = form.elements.vraag.value.trim();
    let antwoord;
    let opties;

    if (type === 'mc') {
      opties = [0, 1, 2, 3].map(i => form.elements['optie' + i].value.trim());
      if (opties.some(o => !o)) {
        alert('Vul alle vier de opties in.');
        return;
      }
      const juist = form.elements.juist.value;
      if (juist === '') {
        alert('Vink aan welke optie het juiste antwoord is.');
        return;
      }
      antwoord = opties[Number(juist)];
    } else {
      antwoord = form.elements.antwoord.value.trim();
    }

    const nieuw = maakVraag(toetsId, { type, vraag: vraagTekst, antwoord, opties }, vraag);

    await db.put('vragen', nieuw);
    dlg.close();
    render();
  });
}

/* ----- AI-generatie ----- */

// Schaalt een afbeelding terug (langste zijde max 1568px) en geeft { mediaType, data }
// terug met base64 zonder data-URL-prefix. Houdt de payload klein en snel.
function afbeeldingNaarBase64(bestand) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('kon de afbeelding niet lezen'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('kon de afbeelding niet laden'));
      img.onload = () => {
        const max = 1568;
        let { width, height } = img;
        if (Math.max(width, height) > max) {
          const f = max / Math.max(width, height);
          width = Math.round(width * f);
          height = Math.round(height * f);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1] });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(bestand);
  });
}

function aiForm(toets, vak) {
  const dlg = openDialog(`
    <form id="aiForm">
      <h3>✨ Vragen genereren</h3>
      <p class="stil">Lever stof aan; de AI maakt vragen die je daarna nakijkt.</p>
      <div class="segmenten" id="bronKeuze">
        <button type="button" data-bron="tekst" class="actief">Tekst plakken</button>
        <button type="button" data-bron="foto">Foto</button>
      </div>
      <label id="veldTekst">Stof (plak je aantekeningen of samenvatting)
        <textarea name="tekst" rows="5" placeholder="Plak hier tekst…"></textarea>
      </label>
      <label id="veldFoto" hidden>Foto van aantekeningen, boekpagina of samenvatting
        <input type="file" name="foto" accept="image/*" capture="environment">
      </label>
      <label>Soort vragen
        <select name="type">
          <option value="gemengd">Gemengd</option>
          <option value="flashcard">Flashcards</option>
          <option value="mc">Meerkeuze</option>
          <option value="open">Open vragen</option>
        </select>
      </label>
      <label>Aantal vragen
        <input type="number" name="aantal" value="10" min="1" max="30">
      </label>
      <label>Niveau (optioneel)
        <input type="text" name="niveau" autocomplete="off" placeholder="bv. havo 3">
      </label>
      <div class="knoppenrij">
        <button type="button" class="knop" data-annuleer>Annuleren</button>
        <button type="submit" class="knop primair">Genereren</button>
      </div>
    </form>
  `);

  const form = dlg.querySelector('#aiForm');
  let bron = 'tekst';
  dlg.querySelectorAll('#bronKeuze button').forEach(b => b.addEventListener('click', () => {
    bron = b.dataset.bron;
    dlg.querySelectorAll('#bronKeuze button').forEach(x => x.classList.toggle('actief', x === b));
    dlg.querySelector('#veldTekst').hidden = bron !== 'tekst';
    dlg.querySelector('#veldFoto').hidden = bron !== 'foto';
  }));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      vak: vak?.naam,
      onderwerp: toets.onderwerp,
      niveau: form.elements.niveau.value.trim(),
      type: form.elements.type.value,
      aantal: Number(form.elements.aantal.value) || 10,
    };

    try {
      if (bron === 'foto') {
        const bestand = form.elements.foto.files[0];
        if (!bestand) { alert('Kies eerst een foto.'); return; }
        payload.afbeelding = await afbeeldingNaarBase64(bestand);
      } else {
        const tekst = form.elements.tekst.value.trim();
        if (!tekst) { alert('Plak eerst wat stof.'); return; }
        payload.tekst = tekst;
      }
    } catch (err) {
      alert('Afbeelding verwerken mislukt: ' + err.message);
      return;
    }

    dlg.innerHTML = `<div class="ai-laden"><span class="spinner"></span><p>Bezig met genereren…</p><p class="stil">Dit kan tot een halve minuut duren.</p></div>`;

    try {
      const resp = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.fout || `Serverfout (${resp.status})`);
      if (!data.vragen?.length) throw new Error('Geen vragen ontvangen.');
      aiReview(dlg, toets.id, data.vragen);
    } catch (err) {
      dlg.innerHTML = `
        <div class="ai-fout">
          <h3>Genereren mislukt</h3>
          <p>${esc(err.message)}</p>
          <div class="knoppenrij">
            <button type="button" class="knop" data-sluit>Sluiten</button>
            <button type="button" class="knop primair" data-opnieuw>Opnieuw</button>
          </div>
        </div>`;
      dlg.querySelector('[data-sluit]').addEventListener('click', () => dlg.close());
      dlg.querySelector('[data-opnieuw]').addEventListener('click', () => { dlg.close(); aiForm(toets, vak); });
    }
  });
}

// Reviewlijst: per vraag bewerken/verwijderen, daarna de overgebleven vragen opslaan.
function aiReview(dlg, toetsId, vragen) {
  // werk op een kopie zodat bewerkingen lokaal blijven tot opslaan
  let lijst = vragen.map(v => ({ ...v }));

  function teken() {
    if (!lijst.length) {
      dlg.innerHTML = `
        <div class="ai-fout">
          <h3>Geen vragen meer</h3>
          <p class="stil">Je hebt alle gegenereerde vragen verwijderd.</p>
          <div class="knoppenrij"><button type="button" class="knop" data-sluit>Sluiten</button></div>
        </div>`;
      dlg.querySelector('[data-sluit]').addEventListener('click', () => dlg.close());
      return;
    }

    dlg.innerHTML = `
      <div class="ai-review">
        <h3>${lijst.length} ${lijst.length === 1 ? 'vraag' : 'vragen'} nakijken</h3>
        <p class="stil">Pas aan of verwijder waar nodig, en sla daarna op.</p>
        <div class="review-lijst">
          ${lijst.map((v, i) => `
            <div class="kaart review-item" data-i="${i}">
              <div class="review-kop">
                <span class="type-chip type-${v.type}">${TYPE_LABEL[v.type]}</span>
                <button type="button" class="icoonknop" data-verwijder="${i}" aria-label="Verwijderen">🗑️</button>
              </div>
              <label>Vraag
                <textarea data-veld="vraag" data-i="${i}" rows="2">${esc(v.vraag)}</textarea>
              </label>
              ${v.type === 'mc' ? `
                <span class="veldkop">Opties (juiste aangevinkt)</span>
                ${v.opties.map((o, oi) => `
                  <div class="optie-rij">
                    <input type="radio" name="juist${i}" data-juist="${i}" value="${oi}" ${o === v.antwoord ? 'checked' : ''}>
                    <input type="text" data-optie="${oi}" data-i="${i}" value="${esc(o)}">
                  </div>`).join('')}
              ` : `
                <label>Antwoord
                  <textarea data-veld="antwoord" data-i="${i}" rows="2">${esc(v.antwoord)}</textarea>
                </label>
              `}
            </div>`).join('')}
        </div>
        <div class="knoppenrij">
          <button type="button" class="knop" data-annuleer>Annuleren</button>
          <button type="button" class="knop primair" data-opslaan>${lijst.length} opslaan</button>
        </div>
      </div>`;

    // bind bewerkingen terug naar de lijst
    dlg.querySelectorAll('[data-veld]').forEach(el => el.addEventListener('input', () => {
      lijst[+el.dataset.i][el.dataset.veld] = el.value;
    }));
    dlg.querySelectorAll('[data-optie]').forEach(el => el.addEventListener('input', () => {
      const i = +el.dataset.i;
      const oi = +el.dataset.optie;
      const oudeOptie = lijst[i].opties[oi];
      lijst[i].opties[oi] = el.value;
      if (lijst[i].antwoord === oudeOptie) lijst[i].antwoord = el.value; // antwoord meeschuiven
    }));
    dlg.querySelectorAll('[data-juist]').forEach(el => el.addEventListener('change', () => {
      const i = +el.dataset.juist;
      lijst[i].antwoord = lijst[i].opties[+el.value];
    }));
    dlg.querySelectorAll('[data-verwijder]').forEach(b => b.addEventListener('click', () => {
      lijst.splice(+b.dataset.verwijder, 1);
      teken();
    }));
    dlg.querySelector('[data-annuleer]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-opslaan]').addEventListener('click', async () => {
      for (const v of lijst) {
        const vraag = String(v.vraag || '').trim();
        if (!vraag) continue;
        let antwoord = String(v.antwoord || '').trim();
        let opties;
        if (v.type === 'mc') {
          opties = (v.opties || []).map(o => String(o).trim()).filter(Boolean).slice(0, 4);
          if (!opties.length) continue;
          if (!opties.includes(antwoord)) antwoord = opties[0];
        }
        if (!antwoord) continue;
        await db.put('vragen', maakVraag(toetsId, { type: v.type, vraag, antwoord, opties }, null, 'ai'));
      }
      dlg.close();
      render();
    });
  }

  teken();
}

/* ===== start ===== */

window.addEventListener('hashchange', render);
render();
