# Empire OS 0.7 · Merlino

Codice pronto per un repository GitHub e per un'app Node.js su Hostinger. Include agenda, finanze, prospetti, memoria del consigliere, accesso personale, salvataggio MySQL e collegamento Vertex AI con Gemini 3.5 Flash-Lite.

## Pubblicazione Hostinger

1. Carica questo ZIP come nuovo sito Node.js, oppure collega il repository GitHub.
2. Build: `npm ci && npm run build`.
3. Avvio: `npm run start:hostinger`; entrypoint `server/hosted.js`.
4. Configura database, accesso personale e identità Google Cloud seguendo [la guida completa](docs/HOSTINGER_VERTEX_0.7.md). Le variabili sono elencate in `.env.hostinger.example`.

La prova Vertex sul PC è riuscita, anche attraverso il codice dell'app. Il database e il sito del tuo piano Hostinger non sono ancora configurati: la pubblicazione non è automatica caricando il codice.

## Dati personali

Il codice non contiene l'archivio finanziario, i backup, le immagini private dei prodotti, password o credenziali Google. I dati già presenti nell'app online restano privati. Il trasferimento usa file personali separati tramite `npm run import:private`; la guida spiega come procedere senza duplicare le transazioni o sovrascrivere un database popolato.

Non caricare credenziali o dati personali su GitHub. I file `.env` privati, le credenziali e le cartelle di backup sono ignorati dal repository.

## GitHub e sviluppo

Per GitHub carica i file e le cartelle estratti, inclusi `.gitignore` e i due file di esempio `.env`. Serve Node.js 22.12 o successivo.

```sh
npm ci
npm test
npm run build
```

`npm run dev` avvia la precedente modalità locale con archivio browser separato. Per usare Vertex e MySQL insieme usa il server `start:hostinger` dopo averlo configurato; conserva i file personali fuori dal codice.

La versione online privata attuale resta disponibile qui: https://empire-os-personale.wigglycow9.chatgpt.site/#today
