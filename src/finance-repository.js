import { emptyFinance, validateFinance } from './finance-domain.js';

/** Finance owns a separate database. Existing Focus data is never migrated or replaced. */
export class FinanceRepository {
  constructor({ databaseName = 'empire-os-finance', indexedDB = globalThis.indexedDB } = {}) {
    this.databaseName = databaseName; this.indexedDB = indexedDB; this.connection = null; this.revision = undefined;
  }
  async open() {
    if (!this.indexedDB) throw new Error('Archivio Finanze non disponibile in questo browser. Nessuna modifica salvata.');
    if (this.connection) return this.connection;
    this.connection = new Promise((resolve, reject) => {
      const request = this.indexedDB.open(this.databaseName);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state'); };
      request.onerror = () => reject(new Error('Impossibile aprire l’archivio Finanze.'));
      request.onblocked = () => reject(new Error('Archivio Finanze occupato: chiudi le altre schede e riprova.'));
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) { db.close(); reject(new Error('Archivio Finanze incompatibile. Il contenuto originale è conservato.')); return; }
        db.onversionchange = () => { db.close(); this.connection = null; this.revision = undefined; };
        resolve(db);
      };
    }).catch(error => { this.connection = null; throw error; });
    return this.connection;
  }
  async load() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readonly'); const store = tx.objectStore('state');
      const request = store.get('current'); const revisionRequest = store.get('revision');
      let state; let revision;
      request.onsuccess = () => { state = request.result; }; revisionRequest.onsuccess = () => { revision = revisionRequest.result ?? 0; };
      tx.oncomplete = () => {
        try { if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Revisione archivio non valida.'); const value = state === undefined ? emptyFinance() : validateFinance(state); this.revision = revision; resolve(value); }
        catch (error) { reject(new Error(`Archivio Finanze non letto: ${error.message} I dati originali sono conservati.`)); }
      };
      tx.onerror = tx.onabort = () => reject(new Error('Lettura Finanze interrotta. Nessun dato modificato.'));
    });
  }
  async save(state) {
    const validated = validateFinance(state); const db = await this.open(); const expectedRevision = this.revision;
    return new Promise((resolve, reject) => {
      let tx; let writeError; let newRevision;
      try {
        tx = db.transaction('state', 'readwrite'); const store = tx.objectStore('state');
        const revisionRequest = store.get('revision'); const currentRequest = store.get('current');
        currentRequest.onsuccess = () => {
          const storedRevision = revisionRequest.result ?? 0;
          if (!Number.isSafeInteger(storedRevision) || storedRevision < 0) { writeError = new Error('Revisione Finanze incompatibile.'); tx.abort(); return; }
          if (expectedRevision === undefined && currentRequest.result !== undefined || expectedRevision !== undefined && expectedRevision !== storedRevision) { writeError = new Error('Un’altra scheda ha modificato le finanze. Ricarica prima di salvare; nessun dato è stato sovrascritto.'); tx.abort(); return; }
          newRevision = storedRevision + 1; if (!Number.isSafeInteger(newRevision)) { writeError = new Error('Revisione Finanze oltre il limite consentito.'); tx.abort(); return; }
          store.put(validated, 'current'); store.put(newRevision, 'revision');
        };
      } catch (error) { reject(new Error(`Nessuna modifica finanziaria salvata: ${error.message}`)); return; }
      tx.oncomplete = () => { this.revision = newRevision; resolve(validated); };
      tx.onerror = tx.onabort = () => reject(writeError ?? new Error(`Nessuna modifica finanziaria salvata: ${tx.error?.message ?? 'transazione interrotta o spazio esaurito'}`));
    });
  }
  async close() { const db = await this.connection; db?.close(); this.connection = null; this.revision = undefined; }
}
