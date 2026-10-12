import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyFinance, applyFinance, validateFinance, financialReport } from '../src/finance-domain.js';
import { emptyState } from '../src/domain.js';
import { periodMonths, planningBasis, projectCash, adviserName } from '../src/finance-planning.js';
import { directAgentRequest, agentContext, localEmpireRequest } from '../src/empire-agent.js';
import { cashSeries } from '../src/empire-metrics.js';
import { agendaWindow, taskDay } from '../src/agenda.js';
const upsert=(s,collection,record)=>applyFinance(s,{type:'upsert',args:{collection,record}});
function fixture() {
  let s=upsert(emptyFinance(),'accounts',{id:'cash',name:'Cash',currency:'EUR',openingCents:null});
  s=upsert(s,'accounts',{id:'bank',name:'Bank',currency:'EUR',openingCents:null});
  s=upsert(s,'businesses',{id:'digital',name:'Digital Communication',currency:'EUR'});
  for(const [id,date,type,amount,source] of [['old','2025-01-01','income',100,'Marketing e comunicazione'],['may-before','2026-05-01','income',10000,'Marketing e comunicazione'],['july','2026-07-12','income',120000,'Marketing e comunicazione'],['august','2026-08-12','income',150000,'Marketing e comunicazione'],['september','2026-09-12','income',90000,'Marketing e comunicazione'],['gift','2026-09-13','income',60000,'da papà'],['expense','2026-09-15','expense',30000,'Spesa'],['october','2026-10-08','income',113000,'Marketing e comunicazione']])s=upsert(s,'transactions',{id,date,type,amountCents:amount,accountId:'cash',currency:'EUR',sourceData:{originalCategory:source}});
  s=upsert(s,'transactions',{id:'transfer',date:'2026-09-01',type:'transfer',amountCents:100000,accountId:'cash',toAccountId:'bank',currency:'EUR'});
  s=upsert(s,'transactions',{id:'scheduled',date:'2026-09-10',type:'income',status:'scheduled',amountCents:999000,accountId:'cash',currency:'EUR'});
  return s;
}
test('Monthly rows use the exact selected interval, mark both partial edges and reconcile to the period totals',()=>{
  const s=fixture(), period={start:'2026-05-15',end:'2026-10-12'},rows=periodMonths(s,period);
  assert.equal(rows.length,6);assert.equal(rows[0].start,'2026-05-15');assert.equal(rows[0].partial,true);assert.equal(rows[0].income,0);assert.equal(rows.at(-1).end,period.end);assert.equal(rows.at(-1).partial,true);
  const report=financialReport(s,period);assert.equal(rows.reduce((n,r)=>n+r.income,0),report.incomeCents);assert.equal(rows.reduce((n,r)=>n+r.expense,0),report.expenseCents);
  assert.equal(periodMonths(s,{start:'2026-09-01',end:'2026-09-30'})[0].partial,false);
});
test('Planning basis uses only three completed months, keeps gifts as a separate selectable source and detects incomplete coverage',()=>{
  const s=fixture(),basis=planningBasis(s,{at:'2026-10-12'});
  assert.deepEqual(basis.period,{start:'2026-07-01',end:'2026-09-30'});assert.equal(basis.sources.find(r=>r.businessId==='digital').monthlyCents,120000);assert.equal(basis.sources.find(r=>r.name==='da papà').businessId,null);assert.equal(basis.expenseCents,10000);assert.equal(basis.partialArchive,false);
  const short={...s,transactions:s.transactions.filter(t=>t.date>='2026-09-01')};assert.equal(planningBasis(short,{at:'2026-10-12'}).partialArchive,true);
  assert.deepEqual(planningBasis(s,{at:'2026-01-05'}).period,{start:'2025-10-01',end:'2025-12-31'});
});
test('Scenarios start next month, keep exact cents, accept negative balances and never invent a starting balance',()=>{
  const args={incomeCents:200001,expenseCents:90000,extraIncomeCents:10000,extraExpenseCents:2500,months:6,from:'2026-10-12'};
  const rows=projectCash(args);assert.equal(rows[0].date,'2026-11-01');assert.equal(rows.at(-1).date,'2027-04-01');assert.equal(rows[0].net,117501);assert.equal(rows.at(-1).cumulative,705006);assert.equal(rows.at(-1).balance,null);
  assert.equal(projectCash({...args,startingCents:-10000})[0].balance,107501);
  assert.throws(()=>projectCash({...args,incomeCents:1.5}),/centesimi/);assert.throws(()=>projectCash({...args,months:25}),/Orizzonte/);assert.throws(()=>projectCash({...args,startingCents:0.5}),/Saldo/);
});
test('Saving and reloading a scenario preserves all financial records and validates corrupt planning inputs',()=>{
  const s=fixture(),record={id:'plan',name:'Nuovo cliente',currency:'EUR',from:'2026-10-12',months:6,incomeCents:120000,expenseCents:10000,extraIncomeCents:30000,extraExpenseCents:0,startingCents:null,sourceIds:['digital'],basis:{start:'2026-07-01',end:'2026-09-30'}};
  const next=validateFinance(JSON.parse(JSON.stringify(applyFinance(s,{type:'settings',args:{settings:{cashScenarios:[record]}}}))));
  for(const key of ['transactions','accounts','orders','businesses','assets','holdings'])assert.deepEqual(next[key],s[key]);assert.equal(projectCash(next.settings.cashScenarios[0]).at(-1).cumulative,840000);
  assert.throws(()=>validateFinance({...next,settings:{...next.settings,cashScenarios:[{...record,months:0}]}}),/Orizzonte/);assert.throws(()=>validateFinance({...next,settings:{...next.settings,cashScenarios:[{...record,incomeCents:1.1}]}}),/centesimi/);
});
test('Conversational scenarios calculate from explicit inputs without saving and adviser names respect custom names',()=>{
  const s=fixture(),tasks=emptyState(),before=JSON.stringify(s),reply=directAgentRequest('Consigliere, scenario: incasso 2000, spendo 900, per 6 mesi',tasks,s);
  assert.match(reply.message,/6600,00|6\.600,00/);assert.deepEqual(reply.financeActions,[]);assert.deepEqual(reply.taskActions,[]);assert.equal(JSON.stringify(s),before);
  assert.equal(directAgentRequest('Quanto guadagnerò?',tasks,s),null);assert.match(localEmpireRequest('Quanto guadagnerò?',tasks,s).message,/ipotesi/);assert.equal(adviserName({agentName:'Nox'}),'Consigliere');assert.equal(adviserName({agentName:'Merlino'}),'Merlino');
  assert.equal(agentContext(tasks,s).cashHistory.length,12);
});
test('The cumulative chart covers multi-year selections and its final point equals the actual selected totals',()=>{
  const s=fixture(),period={start:'2025-01-01',end:'2026-10-12'},rows=cashSeries(s,period),report=financialReport(s,period);
  assert.ok(rows.length>366);assert.equal(rows.at(-1).date,period.end);assert.equal(rows.at(-1).income,report.incomeCents);assert.equal(rows.at(-1).expense,report.expenseCents);
});
test('Agenda uses Rome calendar dates and actual deadlines, excludes archived and completed tasks and stops after seven days',()=>{
  const s=emptyState();s.tasks=[{id:'midnight',status:'todo',dueAt:'2026-10-11T23:30:00Z'},{id:'edge',status:'todo',dueAt:'2026-10-19'},{id:'later',status:'todo',dueAt:'2026-10-20'},{id:'done',status:'done',dueAt:'2026-10-12'},{id:'archive',status:'todo',archived:true,dueAt:'2026-10-12'},{id:'undated',status:'todo'}];
  assert.equal(taskDay(s.tasks[0]),'2026-10-12');assert.deepEqual(agendaWindow(s,'2026-10-12').map(t=>t.id),['midnight','edge']);
});
