import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFinanceFile, prepareFinanceImport } from '../src/finance-import.js';
import { emptyFinance, applyFinance, validateFinance, financialReport, accountBalance } from '../src/finance-domain.js';
import { emptyState, applyActions, validateState } from '../src/domain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function buildArchive() {
  let base = emptyFinance();
  const initialAccounts = [
    { id: 'hype', name: 'Hype', type: 'current', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'cash', name: 'Contanti (Cash 💰)', type: 'cash', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'salvadanaio_cash', name: 'Salvadanaio Cash', type: 'savings', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'postepay', name: 'Postepay💳', type: 'prepaid', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'paypal', name: 'PayPal', type: 'digital', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'sospeso', name: 'Conto Sospeso', type: 'current', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'crypto', name: 'Crypto Wallet', type: 'crypto', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: false },
    { id: 'prestiti', name: 'Prestiti e Crediti', type: 'current', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: false },
    { id: 'salvadanaio_2023', name: 'Salvadanaio 2023', type: 'savings', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'rimborsi', name: 'Rimborsi', type: 'current', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'regali', name: 'Regali e Buoni', type: 'savings', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'incisore', name: 'Fondo Incisore', type: 'business', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'hype_papi', name: 'Hype Papi', type: 'current', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: false },
    { id: 'stripe', name: 'Stripe', type: 'business', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: true },
    { id: 'pc', name: 'Fondo PC', type: 'business', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: false },
    { id: 'sterline', name: 'Sterline GBP', type: 'cash', currency: 'EUR', openingCents: 0, openingDate: '2020-01-01', openingVerified: true, includeInLiquidity: false }
  ];
  for (const record of initialAccounts) {
    base = applyFinance(base, { type: 'upsert', args: { collection: 'accounts', record } });
  }
  base.settings.defaultAccountId = 'hype';

  const mmBytes = new Uint8Array(await readFile('C:/Users/sav99/Desktop/app my empire/Money Manager - Excel_'));
  const mmSource = await parseFinanceFile(mmBytes, { name: 'Money Manager - Excel_.xlsx' });
  const accountAliases = {
    'Hype': 'hype',
    'Hype💳': 'hype',
    'Cash 💰': 'cash',
    'Salvadanaio cash': 'salvadanaio_cash',
    'salvadanaio cash': 'salvadanaio_cash',
    'Postepay💳': 'postepay',
    'PayPal': 'paypal',
    'sospeso': 'sospeso',
    'sospeso ': 'sospeso',
    'Crypto': 'crypto',
    'Prestiti': 'prestiti',
    'salvadanaio 2023 (regali, risparmi, rimborsi)': 'salvadanaio_2023',
    'Rimborsi': 'rimborsi',
    'Rimborsi ': 'rimborsi',
    'Regali e buoni': 'regali',
    'incisore': 'incisore',
    'incisore ': 'incisore',
    'Hype papi': 'hype_papi',
    'hype papi': 'hype_papi',
    'Stripe': 'stripe',
    'PC': 'pc',
    'sterline': 'sterline'
  };
  const mmPreview = await prepareFinanceImport(mmSource, base, { ...mmSource.suggestedMapping, accountAliases }, { adjustments: 'convert' });
  const meBytes = new Uint8Array(await readFile('C:/Users/sav99/Desktop/app my empire/backup_impero_2026-10-11.json'));
  const meSource = await parseFinanceFile(meBytes, { name: 'backup_impero_2026-10-11.json' });
  const finalPreview = await prepareFinanceImport(meSource, mmPreview.state);

  let finance = finalPreview.state;
  for (const b of finance.businesses) {
    const lower = (b.name || '').toLowerCase();
    const isOld = b.id.endsWith('_unassigned') || /zero a impero|altro|dvrkos|yugioh/.test(lower);
    b.active = !isOld;
  }
  finance = applyFinance(finance, {
    type: 'upsert',
    args: {
      collection: 'goals',
      record: { id: 'goal_indipendenza', name: 'Indipendenza Abitativa (Casa)', targetCents: 600000, currency: 'EUR', targetDate: '2027-06-01', active: true }
    }
  });
  finance = { ...finance, importRows: [], importBatches: finance.importBatches.map(b => ({ ...b, preImportSnapshot: undefined, createdRefs: undefined })) };
  finance = validateFinance(finance);

  let tasks = emptyState();
  tasks.settings = {
    name: 'Alex',
    agentName: 'Empire AI',
    priorityCount: 3,
    agentMemories: [
      { id: 'mem_1', text: 'Le aree operative sono: Gran Caffè Zerilli, REP Costruzioni, Magie Creative & Progetti e Personale.', createdAt: '2026-10-14T08:00:00.000Z', source: 'user-request' },
      { id: 'mem_2', text: 'Quando incollo appunti o note, trasformali subito in attività ordinate con progetto, priorità e sotto-attività (passaggi).', createdAt: '2026-10-14T08:00:00.000Z', source: 'user-request' }
    ]
  };
  tasks = applyActions(tasks, [
    { type: 'create_project', args: { id: 'proj_zerilli_natale', title: 'Catalogo Natale & Social Zerilli', areaId: 'zerilli', goal: 'Catalogo di Natale Gran Caffè Zerilli, post Instagram e materiali punto vendita' } },
    { type: 'create_project', args: { id: 'proj_magie_creative', title: 'Magie Creative · Laser & 3D', areaId: 'business', goal: 'Produzione creazioni personalizzate, ordini e nuovi prototipi' } },
    { type: 'create_project', args: { id: 'proj_rep_gare', title: 'Cantieri, Gare & Portale REP', areaId: 'rep', goal: 'Documentazione gare d\'appalto, tavole tecniche e portale dipendenti REP' } },
    { type: 'create_project', args: { id: 'proj_indipendenza', title: 'Casa & Organizzazione Personale', areaId: 'personale', goal: 'Progetti personali, casa e impegni quotidiani' } },
    { type: 'create_task', args: { id: 'task_1', title: 'Revisione grafica e post Catalogo di Natale Zerilli', areaId: 'zerilli', projectId: 'proj_zerilli_natale', priority: 'high', dueAt: '2026-10-14', notes: 'Verificare impaginazione e preparare i caroselli social.', subtasks: [{ id: 's1', title: 'Controllare PDF catalogo Natale', done: true }, { id: 's2', title: 'Preparare copy e foto per Instagram', done: false }] } },
    { type: 'create_task', args: { id: 'task_2', title: 'Allineamento portale dipendenti v34 e documenti gara REP', areaId: 'rep', projectId: 'proj_rep_gare', priority: 'high', dueAt: '2026-10-15', notes: 'Controllare accesso portale e scadenze cantiere.', subtasks: [{ id: 's3', title: 'Verifica turni e accessi portale v34', done: true }, { id: 's4', title: 'Controllo allegati tecnici gara', done: false }] } },
    { type: 'create_task', args: { id: 'task_3', title: 'Preparare nuovi file taglio laser per Magie Creative', areaId: 'business', projectId: 'proj_magie_creative', priority: 'normal', dueAt: '2026-10-16', notes: 'Testare parametri LightBurn sui nuovi campioni.' } },
    { type: 'create_task', args: { id: 'task_4', title: 'Controllare scadenza polizza e manutenzione camper', areaId: 'personale', projectId: 'proj_indipendenza', priority: 'normal', dueAt: '2026-10-18', notes: '' } }
  ]);
  tasks = applyActions(tasks, [{ type: 'set_daily_priorities', args: { date: '2026-10-14', taskIds: ['task_1', 'task_2', 'task_3'] } }]);
  tasks = validateState(tasks);

  const outDir = path.join(root, 'archivio-reale-pronto');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'attivita-reali.json'), JSON.stringify(tasks, null, 2));
  await writeFile(path.join(outDir, 'finanze-reali-unificate.json'), JSON.stringify(finance, null, 2));
  await writeFile(path.join(outDir, 'empire-os-archivio-completo.json'), JSON.stringify({ empireUnifiedBundle: 1, exportedAt: new Date().toISOString(), tasks, finance }, null, 2));

  const rep2026 = financialReport(finance, { start: '2026-01-01', end: '2026-12-31', currency: 'EUR' });
  console.log('Archivio unificato creato con successo in:', outDir);
  console.log('Task:', tasks.tasks.length, '| Progetti:', tasks.projects.length);
  console.log('Movimenti:', finance.transactions.length, '| Conti:', finance.accounts.length, '| Business:', finance.businesses.length, '| Ordini:', finance.orders.length);
  console.log('Saldo Hype:', (accountBalance(finance, 'hype', '2026-10-14') / 100).toFixed(2), '€ | Liquidità totale:', (rep2026.liquidityCents / 100).toFixed(2), '€');
}

buildArchive().catch(err => { console.error(err); process.exitCode = 1; });
