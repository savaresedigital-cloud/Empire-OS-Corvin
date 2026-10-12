import { FINANCE_COLLECTIONS, validateFinance } from './finance-domain.js';

import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

let session = null;
export const cloudConfiguration = () => ({
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || firebaseConfig.projectId || '',
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || firebaseConfig.apiKey || ''
});
export const getCloudSession = () => session;
const timeout = () => AbortSignal.timeout(30000);
async function authJson(url, body, fetcher) { const r=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:timeout()});const data=await r.json();if(!r.ok)throw new Error('Accesso Firebase non riuscito. Controlla credenziali e configurazione.');return data; }
export async function signInFinance(email,password,config=cloudConfiguration(),fetcher=fetch) {
  if(!config.apiKey||!config.projectId)throw new Error('Firebase non configurato.');
  const data=await authJson(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`,{email,password,returnSecureToken:true},fetcher);
  if(!data.localId||!data.idToken||!data.refreshToken)throw new Error('Sessione Firebase incompleta.');
  session={uid:data.localId,email:data.email,token:data.idToken,refreshToken:data.refreshToken,expiresAt:Date.now()+Number(data.expiresIn)*1000,config};
  return {uid:session.uid,email:session.email};
}
export function signOutFinance() { session=null; }
export async function financeIdToken(fetcher=fetch) {
  if(!session)throw new Error('Accedi a Firebase prima di sincronizzare.');
  if(session.expiresAt-Date.now()<60000){const r=await fetcher(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(session.config.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:session.refreshToken}),signal:timeout()});const data=await r.json();if(!r.ok||!data.id_token){signOutFinance();throw new Error('Sessione scaduta. Accedi di nuovo.');}session={...session,token:data.id_token,refreshToken:data.refresh_token,expiresAt:Date.now()+Number(data.expires_in)*1000};}
  return session.token;
}
export function stateForCloud(state,uid) { const next=validateFinance(state); if(!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw new Error('Identità cloud non valida.');for(const key of FINANCE_COLLECTIONS)next[key]=next[key].map(r=>({...r,ownerId:uid}));next.settings.ownerId=uid;return validateFinance(next); }
async function hashText(text){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function chunkFinanceText(text,maxCharacters=60000){const chunks=[];let chunk='';for(const char of text){chunk+=char;if(chunk.length>=maxCharacters){chunks.push(chunk);chunk='';}}if(chunk)chunks.push(chunk);return chunks;}

/** Explicit snapshot sync. Immutable versions are uploaded before a compare-and-set manifest. */
export class FirestoreFinanceRepository {
  constructor({projectId,uid,getToken,fetcher=fetch}){if(!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)||!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw new Error('Configurazione Firestore non valida.');this.projectId=projectId;this.uid=uid;this.getToken=getToken;this.fetcher=fetcher;this.base=`projects/${projectId}/databases/(default)/documents`;this.path=`${this.base}/users/${uid}`;this.revision=undefined;}
  async request(path,options={}){const token=await this.getToken();const r=await this.fetcher(`https://firestore.googleapis.com/v1/${path}`,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},signal:timeout()});if(r.status===404&&options.allowMissing)return null;const data=await r.json();if(!r.ok){const conflict=['ABORTED','FAILED_PRECONDITION','ALREADY_EXISTS'].includes(data.error?.status);throw new Error(conflict?'La copia cloud è cambiata. Rileggila prima di salvare; nessuna versione è stata sovrascritta.':r.status===403?'Accesso Firestore negato. Verifica le regole del proprietario.':'Sincronizzazione non riuscita. La copia locale è conservata.');}return data;}
  async inspect(){const doc=await this.request(`${this.path}/finance/current`,{allowMissing:true});this.revision=doc?.updateTime??null;if(!doc)return null;const f=doc.fields;const count=Number(f.chunkCount?.integerValue);const version=f.version?.stringValue;if(!Number.isSafeInteger(count)||count<1||count>400||!/^[A-Za-z0-9_-]+$/.test(version))throw new Error('Manifest cloud non valido.');return {version,chunkCount:count,hash:f.hash?.stringValue,updatedAt:doc.updateTime,ownerId:f.ownerId?.stringValue};}
  async load(){const manifest=await this.inspect();if(!manifest)return {state:null,manifest:null};if(manifest.ownerId!==this.uid)throw new Error('La copia cloud appartiene a un altro proprietario.');const chunks=[];for(let i=0;i<manifest.chunkCount;i++){const doc=await this.request(`${this.path}/financeVersions/${manifest.version}/chunks/${i}`);const f=doc.fields;if(f.ownerId?.stringValue!==this.uid||Number(f.index?.integerValue)!==i||typeof f.data?.stringValue!=='string')throw new Error('Blocco cloud incompleto. Nessun dato locale modificato.');chunks.push(f.data.stringValue);}const text=chunks.join('');if(await hashText(text)!==manifest.hash)throw new Error('Verifica della copia cloud fallita.');const state=validateFinance(JSON.parse(text));if(state.settings.ownerId!==this.uid)throw new Error('Proprietario archivio cloud non valido.');return {state,manifest};}
  async save(input,{onProgress=()=>{}}={}){if(this.revision===undefined)throw new Error('Leggi prima la copia cloud per verificare eventuali conflitti.');const state=stateForCloud(input,this.uid);const text=JSON.stringify(state);const chunks=chunkFinanceText(text);if(chunks.length>400)throw new Error('Archivio troppo grande per una singola sincronizzazione. Esporta un backup locale.');const version=crypto.randomUUID();const hash=await hashText(text);const field=(value)=>({stringValue:value});for(let start=0;start<chunks.length;start+=20){const writes=chunks.slice(start,start+20).map((data,offset)=>({update:{name:`${this.path}/financeVersions/${version}/chunks/${start+offset}`,fields:{ownerId:field(this.uid),data:field(data),index:{integerValue:String(start+offset)}}},currentDocument:{exists:false}}));await this.request(`${this.base}:commit`,{method:'POST',body:JSON.stringify({writes})});onProgress(Math.min(chunks.length,start+20),chunks.length);}
    const fields={ownerId:field(this.uid),version:field(version),hash:field(hash),chunkCount:{integerValue:String(chunks.length)},schemaVersion:{integerValue:'1'}};const result=await this.request(`${this.base}:commit`,{method:'POST',body:JSON.stringify({writes:[{update:{name:`${this.path}/finance/current`,fields},currentDocument:this.revision?{updateTime:this.revision}:{exists:false}},{update:{name:`${this.path}/financeVersions/${version}`,fields}}]})});this.revision=result.writeResults?.[0]?.updateTime;if(!this.revision)throw new Error('Risposta cloud incompleta. Rileggi la copia prima di riprovare.');return {state,updatedAt:this.revision,version};}
}
