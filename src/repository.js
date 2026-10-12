import { emptyState, validateState } from './domain.js';

/** Single-document local adapter. Resolve writes only after IndexedDB commits. */
export class LocalRepository {
  constructor({ databaseName = 'empire-os', indexedDB = globalThis.indexedDB } = {}) {
    this.databaseName = databaseName;
    this.indexedDB = indexedDB;
    this.connection = null;
    this.revision = undefined;
  }
  async open() {
    if (!this.indexedDB) throw new Error('Salvataggio locale non disponibile: questo browser non offre IndexedDB. Nessuna modifica salvata.');
    if (this.connection) return this.connection;
    this.connection = new Promise((resolve, reject) => {
      // Do not force a version or delete stores: existing future databases remain intact.
      const request = this.indexedDB.open(this.databaseName);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('state')) request.result.createObjectStore('state');
      };
      request.onerror = () => reject(new Error(`Impossibile aprire l’archivio locale: ${request.error?.message || 'errore IndexedDB'}`));
      request.onblocked = () => reject(new Error('Archivio locale occupato da un’altra scheda. Chiudi le altre schede e riprova.'));
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('state')) { db.close(); reject(new Error('Archivio locale incompatibile. Esporta un backup prima di una migrazione.')); return; }
        db.onversionchange = () => { db.close(); this.connection = null; this.revision = undefined; };
        resolve(db);
      };
    }).catch(error => { this.connection = null; throw error; });
    return this.connection;
  }
  async load() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', 'readonly');
      const request = tx.objectStore('state').get('current'); let value; let revision;
      const revisionRequest = tx.objectStore('state').get('revision');
      request.onsuccess = () => { value = request.result; };
      revisionRequest.onsuccess = () => { revision = revisionRequest.result ?? 0; };
      tx.oncomplete = () => {
        try {
          if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Revisione archivio non valida.');
          const result = value === undefined ? emptyState() : validateState(value);
          this.revision = revision;
          resolve(result);
        }
        catch (error) { reject(new Error(`Archivio non letto: ${error.message} Il contenuto originale è conservato.`)); }
      };
      tx.onerror = tx.onabort = () => reject(new Error(`Lettura locale fallita: ${tx.error?.message || 'transazione interrotta'}`));
    });
  }
  async save(state) {
    const validated = validateState(state);
    const db = await this.open();
    const expectedRevision = this.revision;
    return new Promise((resolve, reject) => {
      let tx; let writeError; let newRevision;
      try {
        tx = db.transaction('state', 'readwrite');
        const store = tx.objectStore('state');
        const revisionRequest = store.get('revision');
        const currentRequest = store.get('current');
        // IndexedDB processes requests in creation order; queue the decision after both reads.
        currentRequest.onsuccess = () => {
          const currentValue = currentRequest.result;
          const storedRevision = revisionRequest.result ?? 0;
          if (!Number.isSafeInteger(storedRevision) || storedRevision < 0) {
            writeError = new Error('Nessuna modifica salvata: revisione archivio incompatibile.'); tx.abort(); return;
          }
          if ((expectedRevision === undefined && currentValue !== undefined) || (expectedRevision !== undefined && expectedRevision !== storedRevision)) {
            writeError = new Error('Un’altra scheda ha modificato i dati. Nessuna modifica salvata: ricarica la pagina per leggere l’ultima versione.'); tx.abort(); return;
          }
          newRevision = storedRevision + 1;
          store.put(validated, 'current'); store.put(newRevision, 'revision');
        };
      } catch (error) { reject(new Error(`Nessuna modifica salvata: ${error.message}`)); return; }
      tx.oncomplete = () => { this.revision = newRevision; resolve(validated); };
      tx.onerror = tx.onabort = () => reject(writeError || new Error(`Nessuna modifica salvata: ${tx.error?.message || 'transazione interrotta o spazio esaurito'}`));
    });
  }
  async close() {
    const db = await this.connection; db?.close(); this.connection = null; this.revision = undefined;
  }
}
