import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exitDecision,recoverySize,applySale } from '../src/policy.js';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { Prices } from '../src/prices.js';
import { loadConfig } from '../src/config.js';
import { evaluate } from '../src/selection.js';
import { WalletWatch } from '../src/wallets.js';
import { SOL,USDC,type Quote,type Position,type Intent,type Executor,type Fill,type Market } from '../src/types.js';
const now=Date.now();
const position=():Position=>({id:'p',mint:'TOKEN',strategy:'momentum',openedAt:now-10000,originalAtoms:'1000',atoms:'1000',spentUsd:'2000000',entryFeeUsd:'10000',proceedsUsd:'0',realizedUsd:'0',basisRemainingUsd:'2010000',recovered:false,tiers:[],peakValueUsd:'0',lastPeakAt:now,status:'open'});
const quote=(value:bigint,atoms=1000n):Quote=>({adapter:'fixture',inputMint:'TOKEN',outputMint:USDC,inAtoms:atoms.toString(),outAtoms:value.toString(),minOutAtoms:value.toString(),outUsd:value.toString(),networkFeeUsd:'10000',priceImpactPct:0,at:Date.now(),raw:{inputUsd:'2000000'}});
const temp=()=>mkdtempSync(join(tmpdir(),'spe-test-'));
function buyIntent():Intent {return {id:randomUUID(),mint:'TOKEN',side:'buy',strategy:'momentum',reason:'fixture',createdAt:Date.now(),quote:{...quote(2000000n),inAtoms:'2000000',outAtoms:'1000',minOutAtoms:'1000',inputMint:USDC,outputMint:'TOKEN'},state:'reserved'};}
function fill(i:Intent):Fill{return {signature:'fixture:'+i.id,inAtoms:'2000000',outAtoms:'1000',inputUsd:'2000000',outputUsd:'2000000',networkFeeUsd:'10000',confirmedAt:Date.now(),simulated:true};}
const limits={maxPositions:5,maxCapital:10000000n,cash:20000000n,entryCost:2010000n};
test('1: $2 -> $6 recovers original cash plus entry and exit costs, preserving tokens',async()=>{
  const p=position(),q=quote(6000000n),decision=exitDecision(p,q,now);assert.equal(decision?.reason,'recover_capital');
  const result=await recoverySize(1000n,decision!.recoverUsd!,async n=>quote(n*6000n,n));
  assert(result.atoms<1000n);assert(BigInt(result.quote.outUsd)-10000n>=2010000n);
  assert.equal(p.recovered,false);applySale(p,result.atoms,BigInt(result.quote.outUsd)-10000n,'recover_capital');
  assert.equal(p.recovered,true);assert(BigInt(p.atoms)>0n);
});
test('2: jumping straight to $7 triggers recovery independently of trailing',()=>{
  const p=position();p.peakValueUsd='7000000';assert.equal(exitDecision(p,quote(7000000n),now)?.reason,'recover_capital');
  assert.equal(exitDecision(p,quote(7000000n),now)?.reason,'recover_capital');assert.equal(p.recovered,false);
});
test('3: rapid loss uses executable liquidation value and exits the whole position',()=>assert.deepEqual(exitDecision(position(),quote(1400000n),now),{reason:'executable_stop_loss',fraction:1}));
test('4: inactive position exits on strategy-specific stagnation timeout',()=>{const p=position();p.lastPeakAt=now-190000;assert.equal(exitDecision(p,quote(2000000n),now)?.reason,'stagnation');});
test('5: recovery and 5x,10x,20x ladder retain controlled residual exposure',async()=>{
  const p=position();
  for(const multiple of [3,5,10,20]){
    const unit=BigInt(multiple)*2000n,q=quote(BigInt(p.atoms)*unit,BigInt(p.atoms)),d=exitDecision(p,q,now);
    assert(d);
    const n=d.recoverUsd?(await recoverySize(BigInt(p.atoms),d.recoverUsd,async n=>quote(n*unit,n))).atoms:BigInt(p.atoms)/5n;
    applySale(p,n,n*unit-10000n,d.reason,d.tier);
  }
  assert.deepEqual(p.tiers,[5,10,20]);assert(BigInt(p.atoms)>0n);assert.equal(p.status,'open');
});
test('6: simultaneous strategies cannot reserve duplicate purchases or exceed budget',()=>{
  const dir=temp(),s=new Store(dir);try{const a=buyIntent();s.reserve(a,limits);assert.throws(()=>s.reserve(buyIntent(),limits),/duplicate_pending/);
    const b=buyIntent();b.mint='OTHER';assert.throws(()=>s.reserve(b,{...limits,maxCapital:3000000n}),/capital_limit/);
  }finally{s.close();rmSync(dir,{recursive:true});}
});
test('7: unknown sell is reconciled and rebroadcast with the same durable signature, never re-signed',async()=>{
  const dir=temp(),s=new Store(dir),cfg=loadConfig();cfg.MODE='live';const p=position();s.savePosition(p);
  let broadcasts=0,prepares=0;const e:Executor={quote:async()=>quote(2000000n),prepare:async()=>{prepares++;throw Error('Must not prepare');},
    broadcast:async i=>{broadcasts++;assert.equal(i.signature,'durable-signature');assert.equal(i.signedBase64,'same-bytes');},
    reconcile:async()=>({status:'pending'}),balance:async()=>1000n};
  const engine=new Engine(cfg,s,e,new Prices());
  const i:Intent={...buyIntent(),positionId:p.id,side:'sell',state:'unknown',signature:'durable-signature',signedBase64:'same-bytes'};s.saveIntent(i);
  try{await engine.reconcile();assert.equal(prepares,0);assert.equal(broadcasts,1);assert.equal(s.positions().length,1);assert.equal(s.pending()[0]!.state,'unknown');}
  finally{s.close();rmSync(dir,{recursive:true});}
});
test('8: restart preserves position, pending signature, deduplication and paper cash atomically',()=>{
  const dir=temp();let s=new Store(dir);s.set('paper_cash','20000000');const i=buyIntent();s.reserve(i,limits);assert(s.commitFill(i,fill(i)));
  assert(!s.commitFill(i,fill(i)));assert.equal(s.get('paper_cash'),'17990000');s.first('event');s.close();
  s=new Store(dir);try{assert.equal(s.positions()[0]!.atoms,'1000');assert.equal(s.get('paper_cash'),'17990000');assert.equal(s.first('event'),false);}
  finally{s.close();rmSync(dir,{recursive:true});}
});
test('9: fees/slippage produce actual loss, with no fictitious price-based profit',()=>{
  const p=position();applySale(p,1000n,1800000n-200000n,'stop');assert.equal(p.realizedUsd,'-410000');assert.equal(p.recovered,false);assert.equal(p.status,'closed');
});
test('10: old trending token can qualify; age or historical 300% rise alone does not exclude it',()=>{
  const base:Market={mint:'TOKEN',symbol:'TEST',source:'fixture',receivedAt:now-30000,priceUsd:1,liquidityUsd:50000,buys:80,sells:20,volumeUsd:1000,change5m:300,createdAt:now-86400000,trending:true};
  const middle={...base,receivedAt:now-15000,priceUsd:1.05,volumeUsd:1500},current={...base,receivedAt:now,priceUsd:1.12,volumeUsd:2000};
  assert.equal(evaluate(current,[base,middle,current],[],now).decision,'BUY');
});
test('11: migration changes sell route while preserving original position identity',async()=>{
  const dir=temp(),s=new Store(dir),p=position(),cfg=loadConfig();cfg.MODE='paper';s.savePosition(p);const calls:string[]=[];
  const ex:Executor={quote:async(input,output,n)=>{calls.push(output);if(output===USDC)throw Error('no migrated route');return {...quote(2000000n,n),outputMint:SOL};},
    balance:async()=>1000n,prepare:async()=>{throw Error('not live');},broadcast:async()=>{},reconcile:async()=>({status:'pending'})};
  const engine=new Engine(cfg,s,ex,new Prices());try{await engine.manage(p);assert.deepEqual(calls,[USDC,SOL]);assert.equal(s.positions()[0]!.id,p.id);}
  finally{s.close();rmSync(dir,{recursive:true});}
});
test('12: unsellable token has no cash valuation and raises critical alarm',async()=>{
  const dir=temp(),s=new Store(dir),p=position(),cfg=loadConfig();cfg.MODE='paper';s.savePosition(p);
  const ex:Executor={quote:async()=>{throw Error('no executable route');},balance:async()=>1000n,prepare:async()=>{throw Error('not live');},broadcast:async()=>{},reconcile:async()=>({status:'pending'})};
  const engine=new Engine(cfg,s,ex,new Prices());try{await engine.manage(p);assert.equal(s.positions().length,1);
    const critical=s.recent().find(x=>x.kind==='critical');assert(critical);assert.equal((critical.payload as any).liquidationValueUsd,null);
    assert(!s.recent().some(x=>x.kind==='mark'));}
  finally{s.close();rmSync(dir,{recursive:true});}
});
test('wallet ranking excludes unobserved initial allocations and does not certify history',()=>{
  const dir=temp(),s=new Store(dir);try{const w=new WalletWatch(s);
    w.trade({mint:'T',wallet:'INSIDER',at:now,signature:'a',side:'sell',atoms:'100'},100000000n,0n);
    assert.deepEqual(w.leaders(),[]);
    w.trade({mint:'T',wallet:'TRADER',at:now,signature:'b',side:'buy',atoms:'100'},2000000n,10000n);
    w.trade({mint:'T',wallet:'TRADER',at:now,signature:'c',side:'sell',atoms:'100'},6000000n,10000n);
    assert.equal(w.leaders()[0]!.observedRealizedUsd,'3980000');assert.equal(w.leaders()[0]!.liveCopyEligible,false);
  }finally{s.close();rmSync(dir,{recursive:true});}
});
test('LIVE cannot start without explicit funding cap and acknowledgement',()=>assert.throws(()=>loadConfig({MODE:'live'}),/LIVE requires/));
test('oversell is rejected and a partial sale cannot create a false trailing stop',()=>{
  const p=position();p.peakValueUsd='6000000';assert.throws(()=>applySale(p,1001n,1000000n,'x'),/Oversell/);
  applySale(p,400n,2390000n,'recover');assert.equal(p.peakValueUsd,'3600000');
  assert.equal(exitDecision(p,quote(3600000n,600n),now),null);
});
test('confirmed fill ledger agrees with cash, rolling realized result and idempotent revert charges',()=>{
  const dir=temp(),s=new Store(dir);try{
    s.set('paper_cash','20000000');const buy=buyIntent();s.reserve(buy,limits);s.commitFill(buy,fill(buy));
    const p=s.positions()[0]!,sell:Intent={...buyIntent(),side:'sell',positionId:p.id,reason:'exit',quote:quote(3000000n)};s.reserve(sell,limits);
    const sale:Fill={...fill(sell),inAtoms:'1000',outAtoms:'3000000',outputUsd:'3000000'};s.commitFill(sell,sale);
    assert.equal(s.get('paper_cash'),'20980000');assert.equal(s.realizedSince(0),980000n);
    s.charge('same-reverted-signature','5000');s.charge('same-reverted-signature','5000');assert.equal(s.charges(),5000n);
  }finally{s.close();rmSync(dir,{recursive:true});}
});
test('paper restart releases an unsent reservation without replaying a purchase',()=>{
  const dir=temp(),s=new Store(dir);try{
    const cfg=loadConfig();cfg.MODE='paper';s.set('mode','paper');s.reserve(buyIntent(),limits);
    const ex={} as Executor;new Engine(cfg,s,ex,new Prices());assert.equal(s.pending().length,0);assert.equal(s.positions().length,0);
  }finally{s.close();rmSync(dir,{recursive:true});}
});
