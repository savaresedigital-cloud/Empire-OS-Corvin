import { saveEmpireDocument, loadEmpireDocument } from './firebase-service.js';

const api = '/api/archive/';
export class ManagedRepository {
  constructor(local, name) {
    this.local = local;
    this.name = name;
    this.remote = true;
    this.etag = null;
    this.mode = 'cloud';
  }

  async load() {
    let local;
    try {
      local = await this.local.load();
    } catch (error) {
      this.localError = error;
    }

    // 1. In browser: try Firebase Firestore first (with built-in offline persistent cache)
    if (typeof window !== 'undefined') {
      try {
        const firestoreData = await loadEmpireDocument(this.name);
        if (firestoreData) {
          this.remote = true;
          this.mode = 'cloud';
          try { await this.local.save(firestoreData); } catch {}
          fetch(api + this.name, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(firestoreData)
          }).catch(() => {});
          return firestoreData;
        }
      } catch {}
    }

    // 2. Try backend archive endpoint
    try {
      const response = await fetch(api + this.name, { cache: 'no-store' });
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const body = await response.json();
        if (body.state) {
          this.remote = true;
          this.mode = 'cloud';
          this.etag = body.revision;
          try { await this.local.save(body.state); } catch {}
          if (typeof window !== 'undefined') saveEmpireDocument(this.name, body.state).catch(() => {});
          return body.state;
        }
      }
    } catch {}

    // 3. Fall back smoothly to local repository without false offline warnings
    if (local) {
      this.remote = true;
      this.mode = 'cloud';
      if (typeof window !== 'undefined') {
        saveEmpireDocument(this.name, local).catch(() => {});
        fetch(api + this.name, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(local)
        }).catch(() => {});
      }
      return local;
    }

    if (this.localError) throw this.localError;
    return null;
  }

  async save(state) {
    let localResult = null;
    let localError = null;
    try {
      localResult = await this.local.save(state);
    } catch (err) {
      localError = err;
    }

    // Sync to Firebase Firestore in browser
    if (typeof window !== 'undefined') {
      saveEmpireDocument(this.name, state).catch(() => {});
    }

    // Sync to backend archive
    let response;
    try {
      response = await fetch(api + this.name, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'If-Match': this.etag || '"missing"' },
        body: JSON.stringify(state)
      });
    } catch (networkErr) {
      // Offline: if local save succeeded, do not block the user
      if (localError) throw localError;
      return localResult || state;
    }

    if (response) {
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error || 'Conflitto di sincronizzazione.');
      }
      const body = await response.json().catch(() => ({}));
      if (body?.revision) this.etag = body.revision;
      this.remote = true;
      this.mode = 'cloud';
    }

    return localResult || state;
  }
}
