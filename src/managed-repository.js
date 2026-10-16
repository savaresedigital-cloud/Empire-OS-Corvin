const api = '/api/archive/';
export class ManagedRepository {
  constructor(local, name) { this.local = local; this.name = name; this.remote = false; this.etag = null; this.mode = 'local'; }
  async load() {
    let local; try { local = await this.local.load(); } catch (error) { this.localError = error; }
    try {
      const response = await fetch(api + this.name, { cache: 'no-store' });
      if (!response.headers.get('content-type')?.includes('application/json')) { if (globalThis.location?.hostname?.endsWith('.chatgpt.site')) throw new Error('Archivio personale non raggiungibile. Riprova tra poco.'); return local || Promise.reject(this.localError); }
      const body = await response.json();
      if (!response.ok) { if (body.code === 'storage_unavailable') return local || Promise.reject(this.localError); const error = new Error(body.error || 'Archivio personale non disponibile.'); error.authenticationRequired = [401, 403].includes(response.status); throw error; }
      this.remote = true; this.mode = 'cloud'; this.etag = body.revision;
      if (!body.state) throw new Error('Archivio personale in preparazione. Riprova tra poco.');
      try { await this.local.save(body.state); } catch { /* Cloud is authoritative; cache is optional. */ }
      return body.state;
    } catch (error) {
      if (this.remote || error.authenticationRequired || error.message?.includes('Archivio personale')) throw error;
      this.mode = 'offline'; if (local) return local; throw this.localError || error;
    }
  }
  async save(state) {
    if (this.mode === 'offline') throw new Error('Sei offline. Puoi consultare la copia salvata; riconnettiti prima di modificarla.');
    if (!this.remote) return this.local.save(state);
    const response = await fetch(api + this.name, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': this.etag || '"missing"' }, body: JSON.stringify(state) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Salvataggio online non riuscito. Riprova quando sei connesso.');
    this.etag = body.revision;
    try { await this.local.save(state); } catch { /* A failed cache must not misreport a successful cloud write. */ }
    return state;
  }
}
