// Dunne IndexedDB-wrapper met async/await helpers.
// Stores: vakken, toetsen (index op vakId), vragen (index op toetsId).

const DB_NAAM = 'toetsweekdrill';
const DB_VERSIE = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const verzoek = indexedDB.open(DB_NAAM, DB_VERSIE);
    verzoek.onupgradeneeded = () => {
      const d = verzoek.result;
      if (!d.objectStoreNames.contains('vakken')) {
        d.createObjectStore('vakken', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('toetsen')) {
        const s = d.createObjectStore('toetsen', { keyPath: 'id' });
        s.createIndex('vakId', 'vakId');
      }
      if (!d.objectStoreNames.contains('vragen')) {
        const s = d.createObjectStore('vragen', { keyPath: 'id' });
        s.createIndex('toetsId', 'toetsId');
      }
    };
    verzoek.onsuccess = () => resolve(verzoek.result);
    verzoek.onerror = () => reject(verzoek.error);
  });
  return dbPromise;
}

function alsPromise(verzoek) {
  return new Promise((resolve, reject) => {
    verzoek.onsuccess = () => resolve(verzoek.result);
    verzoek.onerror = () => reject(verzoek.error);
  });
}

export async function getAll(store) {
  const d = await open();
  return alsPromise(d.transaction(store).objectStore(store).getAll());
}

export async function get(store, id) {
  const d = await open();
  return alsPromise(d.transaction(store).objectStore(store).get(id));
}

export async function getAllByIndex(store, indexNaam, waarde) {
  const d = await open();
  return alsPromise(d.transaction(store).objectStore(store).index(indexNaam).getAll(waarde));
}

export async function put(store, obj) {
  const d = await open();
  return alsPromise(d.transaction(store, 'readwrite').objectStore(store).put(obj));
}

export async function del(store, id) {
  const d = await open();
  return alsPromise(d.transaction(store, 'readwrite').objectStore(store).delete(id));
}

// Alles in één transactie, zodat een import niet half kan slagen.
export async function importAlles(data) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(['vakken', 'toetsen', 'vragen'], 'readwrite');
    for (const store of ['vakken', 'toetsen', 'vragen']) {
      const s = tx.objectStore(store);
      s.clear();
      for (const item of data[store]) s.put(item);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function exportAlles() {
  const [vakken, toetsen, vragen] = await Promise.all([
    getAll('vakken'), getAll('toetsen'), getAll('vragen'),
  ]);
  return {
    app: 'toetsweekdrill',
    versie: DB_VERSIE,
    geexporteerd: new Date().toISOString(),
    vakken, toetsen, vragen,
  };
}
