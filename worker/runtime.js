import { validateState } from '../src/domain.js';
import { validateFinance } from '../src/finance-domain.js';
import { agentContext, validateAgentResult, directAgentRequest, parseSmartPaste } from '../src/empire-agent.js';
import { vertexConfig, vertexRequest } from './vertex.js';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const validate = { tasks: validateState, finance: validateFinance };
const keyFor = name => `empire/private/${name}.json`;
const keyBytes = secret => Uint8Array.from(atob(secret), c => c.charCodeAt(0));
async function wrappingKey(secret) { return crypto.subtle.importKey('raw', keyBytes(secret), 'AES-GCM', false, ['encrypt', 'decrypt']); }
const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function readKey(env) {
  if (env.GEMINI_API_KEY) return { key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || 'gemini-2.5-flash' };
  const object = await env.BUCKET?.get('empire/private/agent-key.json'); if (!object) return null;
  const value = await object.json();
  const decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: keyBytes(value.iv) }, await wrappingKey(env.EMPIRE_MANAGEMENT_SECRET), keyBytes(value.data));
  return JSON.parse(new TextDecoder().decode(decoded));
}
async function bodyJson(request, max) {
  if (Number(request.headers.get('Content-Length')) > max) fail('La richiesta supera la dimensione consentita.', 413);
  const text = await request.text(); if (new TextEncoder().encode(text).length > max) fail('La richiesta supera la dimensione consentita.', 413);
  try { return JSON.parse(text); } catch { fail('Richiesta JSON non valida.'); }
}
const actionSchema = { type: 'ARRAY', items: { type: 'OBJECT', properties: { type: { type: 'STRING' }, args: { type: 'STRING', description: 'Argomenti dell’operazione serializzati come oggetto JSON.' } }, required: ['type', 'args'] } };
export function createRuntime({ assets = {}, fetcher = globalThis.fetch, getVertexAccessToken } = {}) {
  return { async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(request.method)) return new Response('Metodo non consentito', { status: 405 });
        const asset = assets[url.pathname] || (url.pathname === '/' ? assets['/index.html'] : null);
        if (!asset) return new Response('Risorsa non trovata', { status: 404 });
        return new Response(request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.data), c => c.charCodeAt(0)), { headers: { 'Content-Type': asset.type, 'Cache-Control': /\/assets\//.test(url.pathname) ? 'private,max-age=31536000,immutable' : 'private,no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' } });
      }
      if (url.pathname === '/api/status' && request.method === 'GET') {
        const vertex = vertexConfig(env);
        return json({ storageConfigured: !!env.BUCKET, aiConfigured: vertex ? !!getVertexAccessToken : !!(env.GEMINI_API_KEY || await env.BUCKET?.head('empire/private/agent-key.json')), provider: vertex ? 'vertex' : 'gemini', model: vertex?.model || null, authConfigured: true, hosted: env.HOSTED_NODE === 'true' });
      }
      const service = !!env.EMPIRE_MANAGEMENT_SECRET && request.headers.get('X-Empire-Management') === env.EMPIRE_MANAGEMENT_SECRET;
      // This shared archive is deployed ONLY behind the confirmed owner-private Sites access boundary.
      if (!service && !request.headers.get('oai-authenticated-user-id')) fail('Accedi al tuo account per aprire l’archivio personale.', 401);
      if (!env.BUCKET) return json({ code: 'storage_unavailable', error: 'Archivio online non configurato.' }, 503);
      if (!['GET', 'HEAD'].includes(request.method) && !service && request.headers.get('Origin') !== url.origin) fail('Richiesta da una pagina non autorizzata.', 403);
      const media = /^\/api\/media\/([a-f0-9]{32}\.webp)$/.exec(url.pathname);
      if (media) {
        const key = 'empire/media/' + media[1];
        if (request.method === 'GET') { const object = await env.BUCKET.get(key); return object ? new Response(object.body, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private,max-age=3600', 'X-Content-Type-Options': 'nosniff' } }) : new Response('Immagine non disponibile', { status: 404 }); }
        if (request.method === 'PUT' && service) { const bytes = await request.arrayBuffer(); if (bytes.byteLength > 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 4)) !== 'RIFF' || new TextDecoder().decode(bytes.slice(8, 12)) !== 'WEBP') fail('Immagine non valida.', 422); await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: 'image/webp' } }); return json({ saved: true }); }
        fail('Metodo non consentito.', 405);
      }
      const match = /^\/api\/archive\/(tasks|finance)$/.exec(url.pathname);
      if (match) {
        const name = match[1], key = keyFor(name);
        if (request.method === 'GET') { const object = await env.BUCKET.get(key); return json({ state: object ? await object.json() : null, revision: object?.httpEtag || null }); }
        if (request.method === 'PUT') {
          const before = await env.BUCKET.get(key), revision = request.headers.get('If-Match');
          if (!revision || revision !== (before?.httpEtag || '"missing"')) fail('I dati sono cambiati su un altro dispositivo. Ricarica prima di salvare: nessuna modifica sovrascritta.', 409);
          const state = validate[name](await bodyJson(request, 25 * 1024 * 1024));
          if (before) await env.BUCKET.put(`empire/history/${name}/${before.etag}.json`, before.body, { httpMetadata: { contentType: 'application/json' } });
          const condition = new Headers(before ? { 'If-Match': before.httpEtag } : { 'If-None-Match': '*' });
          const written = await env.BUCKET.put(key, JSON.stringify(state), { onlyIf: condition, httpMetadata: { contentType: 'application/json', cacheControl: 'private,no-store' } });
          if (!written) fail('Un altro dispositivo ha salvato prima di te. Ricarica e riprova.', 409);
          return json({ revision: written.httpEtag });
        }
        fail('Metodo non consentito.', 405);
      }
      if (url.pathname === '/api/agent/key' && request.method === 'POST') {
        const body = await bodyJson(request, 4000); if (typeof body.key !== 'string' || body.key.length < 20 || body.key.length > 300) fail('Inserisci una chiave Gemini valida.');
        const response = await fetcher('https://generativelanguage.googleapis.com/v1beta/models', { headers: { 'x-goog-api-key': body.key }, signal: AbortSignal.timeout(20000) });
        if (!response.ok) fail('Google non ha accettato la chiave. Controlla il progetto e le autorizzazioni.', 422);
        const models = (await response.json()).models || [];
        const preferred = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
        const model = preferred.find(id => models.some(m => m.name === 'models/' + id && m.supportedGenerationMethods?.includes('generateContent')));
        if (!model) fail('La chiave non ha un modello compatibile disponibile.', 422);
        if (!env.EMPIRE_MANAGEMENT_SECRET) fail('Protezione della chiave non configurata.', 503);
        const iv = crypto.getRandomValues(new Uint8Array(12)), encoded = new TextEncoder().encode(JSON.stringify({ key: body.key, model }));
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrappingKey(env.EMPIRE_MANAGEMENT_SECRET), encoded);
        await env.BUCKET.put('empire/private/agent-key.json', JSON.stringify({ iv: base64(iv), data: base64(encrypted) }));
        return json({ connected: true, model });
      }
      if (url.pathname === '/api/agent' && request.method === 'POST') {
        const body = await bodyJson(request, 24000); if (typeof body.message !== 'string' || !body.message.trim() || body.message.length > 16000) fail('Scrivi una richiesta tra 1 e 16000 caratteri.');

        const [taskObject, financeObject] = await Promise.all([env.BUCKET.get(keyFor('tasks')), env.BUCKET.get(keyFor('finance'))]);
        if (!taskObject || !financeObject) fail('Archivio personale in preparazione.', 503);
        const tasks = validateState(await taskObject.json()), finance = validateFinance(await financeObject.json());
        const direct = directAgentRequest(body.message, tasks, finance); if (direct) return json(validateAgentResult(direct, tasks, finance, body.message));
        const smart = parseSmartPaste(body.message, tasks, finance); if (smart) return json(validateAgentResult(smart, tasks, finance, body.message));
        const vertex = vertexConfig(env);
        if (vertex && !getVertexAccessToken) fail('Il collegamento Vertex richiede il server Node configurato.', 503);
        const provider = vertex ? { model: vertex.model } : await readKey(env); if (!provider) fail('Collega Gemini nelle impostazioni per attivare le richieste libere.', 503);
        const context = agentContext(tasks, finance);
        const instruction = 'Sei Empire AI, il consigliere operativo e finanziario personale di Alex dentro Empire OS. Parla in italiano naturale, umano, sveglio, chiaro e diretto: niente tono robotico, niente burocrazia contabile, niente gergo medievale forzato. Quando analizzi numeri o periodi (incluso lo storico annuale 2021-2026 in yearlyHistory, i mesi in cashHistory e le fonti in historicalIncomeSources), spiega in modo fluido cosa è successo, quali anni o mesi sono andati meglio, quanto risparmio netto reale è rimasto e da quali fonti arrivano i guadagni. Ricorda sempre che i calcoli nel contesto sono espressi in centesimi di euro (es. 1407550 = 14.075,50 €): convertili sempre in euro leggibili (es. 14.075,50 €) nelle risposte! Se l’utente incolla una nota lunga, un messaggio, un elenco o un piano operativo, scomponilo in modo intelligente: crea tutti i task necessari assegnando automaticamente l’area corretta (zerilli per Gran Caffè Zerilli/bar/pasticceria/catalogo torte, rep per REP Costruzioni/cantieri/gare/fornitori edili, business per e-commerce/Etsy/3D/laser/video/siti/clienti/Magie Creative/Quadretti, personale per vita privata/casa/salute), collega il projectId se esiste un progetto affine nel contesto, imposta priority (high/normal/low), dueAt (YYYY-MM-DD se indicata) e inserisci eventuali sotto-passaggi come subtasks [{id,title,done:false}] dentro create_task oppure con add_subtask {id,title}. Se nel testo incollato ci sono spese o incassi chiari e non è specificata la data o il conto, usa today dal contesto e il conto predefinito o Hype. Non inventare saldi, prezzi, costi, scadenze, clienti o vendite non presenti nel contesto. Gli incassi Money Manager e le vendite My Empire sono due viste degli stessi flussi: non sommarli tra loro. Restituisci message, taskActions e financeActions. Per taskActions sono consentiti create_task {title,areaId,priority,dueAt,projectId,notes,subtasks}, update_task {id,...}, complete_task {id,completed}, add_subtask {id,title}, create_project {title,goal,areaId}, update_project {id,...}, set_daily_priorities {date,taskIds} massimo 5 ID esistenti, delete_task {id}, delete_project {id}. Per financeActions upsert {collection:transactions/accounts/orders/businessCosts,record:{...}} oppure remove {collection:transactions/accounts/orders/businessCosts/businesses,id} con ID esistenti e centesimi interi. Non dire che hai già salvato prima che l’utente confermi. Gli argomenti delle azioni sono stringhe JSON. Se un campo non serve omettilo, non usare stringhe vuote per date.';
        const modelBody = { systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: 'user', parts: [{ text: JSON.stringify({ request: body.message, context }) }] }], generationConfig: { ...(!/^gemini-3\.5-flash-lite/.test(provider.model) ? { temperature: 0.25 } : { thinkingConfig: { thinkingLevel: 'MINIMAL' } }), responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { message: { type: 'STRING' }, taskActions: actionSchema, financeActions: actionSchema }, required: ['message', 'taskActions', 'financeActions'] }, maxOutputTokens: 6000 } };
        const response = vertex ? await vertexRequest(vertex, getVertexAccessToken, modelBody, fetcher) : await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': provider.key }, signal: AbortSignal.timeout(45000), body: JSON.stringify(modelBody) });
        if (!response.ok) fail('L’agente non è disponibile al momento. Controlla la quota del progetto Gemini e riprova.', 502);
        const data = await response.json(), output = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
        let result; try { result = JSON.parse(output); for (const key of ['taskActions', 'financeActions']) result[key] = result[key].map(a => ({ type: a.type, args: JSON.parse(a.args) })); } catch { fail('L’agente ha restituito una proposta incompleta. Nessuna modifica salvata.', 422); }
        return json(validateAgentResult(result, tasks, finance, body.message));
      }
      return json({ error: 'Percorso non disponibile.' }, 404);
    } catch (error) { return json({ error: error.status ? error.message : 'Operazione non completata. Riprova; l’archivio precedente è conservato.' }, error.status || 500); }
  } };
}
