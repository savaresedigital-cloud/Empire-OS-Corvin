const invalid = () => { throw Object.assign(new Error('Configurazione Vertex non valida.'), { status: 503 }); };
export function vertexConfig(env) {
  if (!env.GOOGLE_CLOUD_PROJECT) return null;
  const project = env.GOOGLE_CLOUD_PROJECT, location = env.GOOGLE_CLOUD_LOCATION || 'global', model = env.VERTEX_MODEL || 'gemini-3.5-flash-lite';
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) || !/^(?:global|eu|us|[a-z]+-[a-z]+\d)$/.test(location) || !/^gemini-[a-zA-Z0-9._-]+$/.test(model)) invalid();
  const host = ['global', 'eu', 'us'].includes(location) ? 'aiplatform.googleapis.com' : `${location}-aiplatform.googleapis.com`;
  return { project, location, model, url: `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent` };
}
export async function vertexRequest(config, getToken, body, fetcher = globalThis.fetch) {
  let token;
  try { token = await getToken(); } catch { throw Object.assign(new Error('Accesso Vertex non disponibile. Controlla le credenziali del server.'), { status: 503 }); }
  if (typeof token !== 'string' || token.length < 10) invalid();
  const generationConfig = { ...body.generationConfig };
  if (/^gemini-3\.5-flash-lite/.test(config.model)) { delete generationConfig.temperature; generationConfig.thinkingConfig = { thinkingLevel: 'MINIMAL' }; }
  return fetcher(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(45000), body: JSON.stringify({ ...body, generationConfig }) });
}
