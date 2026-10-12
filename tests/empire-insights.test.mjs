import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyActions, validateState } from '../src/domain.js';
import { emptyFinance, applyFinance, financialReport, validateFinance } from '../src/finance-domain.js';
import { incomeBreakdown, incomeMonths, incomeSource, reconciliationCandidates, monthlyComparison, wealthHistory, wealthObservation, recordWealthObservation } from '../src/finance-insights.js';
import { directAgentRequest, validateAgentResult, agentContext } from '../src/empire-agent.js';
import { taskProgress } from '../src/empire-metrics.js';
const upsert = (s,collection,record) => applyFinance(s,{type:'upsert',args:{collection,record}});
const period = {start:'2026-10-01',end:'2026-10-12'};
function fixture() {
  let s=emptyFinance();
  s=upsert(s,'accounts',{id:'cash',name:'Conto',currency:'EUR',openingCents:null});
  s=upsert(s,'accounts',{id:'other',name:'Altro conto',currency:'EUR',openingCents:null});
  s=upsert(s,'businesses',{id:'digital',name:'Digital Communication',currency:'EUR'});
  s=upsert(s,'businesses',{id:'pc',name:'PC',currency:'EUR'});
  s=upsert(s,'transactions',{id:'income',date:'2026-10-08',type:'income',amountCents:113000,accountId:'cash',currency:'EUR',sourceData:{originalCategory:'Marketing e comunicazione'},notes:'Nota originale'});
  s=upsert(s,'transactions',{id:'pc-income',date:'2026-10-05',type:'income',amountCents:10000,accountId:'cash',currency:'EUR',sourceData:{originalCategory:'attività',originalSubcategory:'pc'}});
  s=upsert(s,'transactions',{id:'gift',date:'2026-10-08',type:'income',amountCents:50000,accountId:'cash',currency:'EUR',sourceData:{originalCategory:'da papà'}});
  s=upsert(s,'transactions',{id:'transfer',date:'2026-10-08',type:'transfer',amountCents:113000,accountId:'cash',toAccountId:'other',currency:'EUR'});
  s=upsert(s,'orders',{id:'sale',businessId:'digital',date:'2026-10-08',currency:'EUR',grossCents:113000,status:'completed'});
  return s;
}
test('Money Manager income sources include subcategories, preserve labels and reconcile without summing commercial sales',()=>{
  const state=fixture(), before=JSON.stringify(state), rows=incomeBreakdown(state,period);
  assert.equal(rows.find(r=>r.businessId==='digital').value,113000);
  assert.equal(rows.find(r=>r.businessId==='pc').value,10000);
  assert.equal(rows.reduce((n,r)=>n+r.value,0),financialReport(state,period).incomeCents);
  assert.equal(reconciliationCandidates(state,period).length,1);
  assert.equal(reconciliationCandidates(state,{start:'2026-09-01',end:'2026-09-30'}).length,0);
  assert.equal(state.transactions[0].notes,'Nota originale'); assert.equal(JSON.stringify(state),before);
  assert.equal(incomeSource(state,state.transactions[0]).incomeKind,'not-classified');
});
test('Manual source override can detach an inferred association without rewriting original transactions',()=>{
  const state=fixture(), before=JSON.stringify(state.transactions);
  const next=applyFinance(state,{type:'settings',args:{settings:{incomeSourceRules:[{key:'Marketing e comunicazione',businessId:null}]}}});
  assert.equal(incomeSource(next,next.transactions[0]).businessId,null); assert.equal(JSON.stringify(next.transactions),before);
  assert.throws(()=>validateFinance({...state,settings:{...state.settings,incomeSourceRules:[{key:'A',businessId:'missing'}]}}),/Business/);
});
test('Income comparisons use the same elapsed days and the curve marks the current partial month',()=>{
  let s=fixture();s=upsert(s,'transactions',{id:'last-month',date:'2026-09-12',type:'income',amountCents:100000,accountId:'cash',currency:'EUR'});
  s=upsert(s,'transactions',{id:'later-month',date:'2026-09-20',type:'income',amountCents:50000,accountId:'cash',currency:'EUR'});
  const compare=monthlyComparison(s,period);assert.equal(compare.end,'2026-09-12');assert.equal(compare.report.incomeCents,100000);
  const curve=incomeMonths(s,{end:period.end});assert.equal(curve.at(-1).income,173000);assert.equal(curve.at(-1).partial,true);assert.equal(curve.at(-2).income,150000);
});
test('Explicit memories survive reload and forgetting removes conversation context too',()=>{
  let state=emptyState();state.settings.agentConversation=[{role:'user',text:'Ricorda che preferisco testi pratici'}];
  const result=directAgentRequest('Nox, ricorda che preferisco testi pratici',state,fixture());assert.equal(result.taskActions.length,1);
  state=applyActions(state,result.taskActions);state=validateState(JSON.parse(JSON.stringify(state)));
  assert.equal(agentContext(state,fixture()).memories[0].text,'preferisco testi pratici');
  const forget=directAgentRequest('Dimentica testi pratici',state,fixture());state=applyActions(state,forget.taskActions);
  assert.equal(state.settings.agentMemories.length,0);assert.deepEqual(state.settings.agentConversation,[]);
  assert.equal(directAgentRequest('Preferisco il viola',state,fixture()),null);
});
test('Named deletions are unambiguous proposals; task trash restores a record and never recreates daily selections',()=>{
  let state=applyActions(emptyState(),[{type:'create_task',args:{id:'a',title:'Comprare carta'}},{type:'create_task',args:{id:'b',title:'Comprare carta colorata'}},{type:'set_daily_priorities',args:{date:'2026-10-12',taskIds:['a','b']}}]);
  assert.equal(directAgentRequest('Elimina task carta',state,fixture()).taskActions.length,0);
  const proposal=validateAgentResult(directAgentRequest('Elimina task Comprare carta',state,fixture()),state,fixture());assert.equal(state.tasks.length,2);
  state=applyActions(state,proposal.taskActions);assert.equal(state.tasks.length,1);assert.deepEqual(state.plans['2026-10-12'],['b']);
  state=applyActions(state,directAgentRequest('Ripristina task Comprare carta',state,fixture()).taskActions);assert.equal(state.tasks.length,2);assert.deepEqual(state.plans['2026-10-12'],['b']);
  assert.throws(()=>validateAgentResult(directAgentRequest('Elimina conto Conto',state,fixture()),state,fixture()),/riferimento|Conto/);
});
test('Wealth history records dated observations without fabricating missing openings or backdating current balances',()=>{
  let s=fixture();s=upsert(s,'accounts',{id:'crypto',name:'Crypto',type:'crypto',currency:'EUR',openingDate:'2026-10-12',openingCents:30000});
  const row=wealthObservation(s,'2026-10-12');assert.equal(row.complete,false);assert.equal(row.valueCents,30000);assert.ok(row.missing.includes('account:cash'));assert.deepEqual(wealthHistory(s),[]);
  s=applyFinance(s,{type:'settings',args:{settings:{wealthHistory:[row]}}});assert.deepEqual(wealthHistory(s,'EUR','2026-10-11'),[]);assert.equal(wealthHistory(s,'EUR','2026-10-12').length,1);
  assert.throws(()=>validateFinance({...s,settings:{...s.settings,wealthHistory:[{...row,valueCents:1.5}]}}),/centesimi/);
});
test('Task milestones use actual unique completions and preserve them in trash without inflating progress',()=>{
  let state=applyActions(emptyState(),[{type:'create_task',args:{id:'a',title:'Prima attività'}},{type:'complete_task',args:{id:'a'}}]);
  assert.equal(taskProgress(state).total,1);state=applyActions(state,[{type:'complete_task',args:{id:'a'}},{type:'delete_task',args:{id:'a'}}]);assert.equal(taskProgress(state).total,1);
  state=applyActions(state,[{type:'restore_task',args:{id:'a'}}]);assert.equal(taskProgress(state).total,1);
});
test('Saving today’s wealth observation preserves other currencies and replaces only the same date and currency',()=>{
  const state=fixture();state.settings.wealthHistory=[{date:'2026-10-12',currency:'USD',valueCents:10000,complete:false,missing:['account:x']},{date:'2026-10-11',currency:'EUR',valueCents:5000,complete:false,missing:['account:cash']},{date:'2026-10-12',currency:'EUR',valueCents:6000,complete:false,missing:['account:cash']}];
  const history=recordWealthObservation(state,'2026-10-12','EUR');assert.equal(history.length,3);assert.equal(history.find(r=>r.currency==='USD').valueCents,10000);assert.equal(history.filter(r=>r.date==='2026-10-12'&&r.currency==='EUR').length,1);assert.equal(history.find(r=>r.date==='2026-10-11').valueCents,5000);
});
