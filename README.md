# Empire OS · Corvin

App personale con agenda, consigliere, business, finanze e prospetti. Questa copia contiene il codice aggiornato, incluso il castello sullo sfondo e la schermata iniziale senza il riquadro Alessandro.

App online privata: https://empire-os-personale.wigglycow9.chatgpt.site/#today

## Caricare su GitHub

1. Crea un repository su GitHub.
2. Estrai lo ZIP e apri la cartella Empire-OS-Corvin-GitHub.
3. Carica i file e le cartelle contenuti al suo interno, inclusi .gitignore, .env.example e .openai/hosting.json. Non caricare soltanto lo ZIP.

Non sono inclusi l'archivio personale, i backup, le immagini private dei prodotti, le credenziali, la cartella .git, node_modules o i file generati. Anche gli audit dei dati e i documenti storici interni sono esclusi. I test contengono piccoli esempi e controlli, non l'archivio finanziario.

GitHub conserva il codice. I dati già presenti nell'app online restano nel suo archivio privato: non vengono trasferiti o pubblicati caricando questa cartella.

## Avvio locale

Serve Node.js 22.12 o successivo. Su Windows fai doppio clic su AVVIA-EMPIRE-OS.bat. Alla prima apertura scarica le dipendenze; poi apre http://localhost:5173/. Lascia la finestra aperta durante l'uso.

In alternativa:

```sh
npm ci
npm run dev
```

La copia locale ha un archivio separato e inizialmente vuoto. Il nome Corvin è già salvato nell'app online; nella nuova copia puoi impostarlo aprendo Cosa ricordo e salvando il nome.

L'AI richiede una configurazione separata. Non inserire mai chiavi in file pubblici o nel codice del browser. .env.example contiene solo impostazioni di esempio con chiavi vuote.

## Verifica e compilazione

```sh
npm test
npm run build
```

Caricare il repository non pubblica automaticamente un'app funzionante. Questa app usa anche un backend: GitHub Pages da solo non lo esegue. La configurazione di un nuovo hosting e del suo archivio va eseguita separatamente.
