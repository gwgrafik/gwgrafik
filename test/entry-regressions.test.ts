import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Connection,Keypair,PublicKey } from '@solana/web3.js';
import { MintLayout,TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ReadCache } from '../src/cache.js';
import { HttpError,retryDelay,getJson } from '../src/http.js';
import { RequestGate } from '../src/request-gate.js';
import { entryEconomics } from '../src/economics.js';
import { ChainExecutor } from '../src/execution.js';
import { JupiterV2 } from '../src/jupiter.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';
import { Prices } from '../src/prices.js';
import { loadConfig } from '../src/config.js';
import { SOL,USDC,type Quote,type Market,type Executor } from '../src/types.js';
import { createServer } from 'node:http';
const entry:Quote={adapter:'fixture',inputMint:USDC,outputMint:'TOKEN',inAtoms:'2000000',outAtoms:'1000',minOutAtoms:'950',
  outUsd:'1900000',expectedOutUsd:'2000000',networkFeeUsd:'10000',priceImpactPct:.1,at:Date.now(),raw:{inputUsd:'2000000'}};
const exit:Quote={...entry,inputMint:'TOKEN',outputMint:USDC,inAtoms:'1000',outAtoms:'1995000',minOutAtoms:'1895250',outUsd:'1895250',expectedOutUsd:'1995000'};
test('5% slippage caps do not become a fictitious >10% expected round-trip charge',()=>{
  const r=entryEconomics(2000000n,entry,exit,5);
  assert.equal(r.acceptable,true);assert.equal(r.expectedLossUsd,'25000');
  assert.equal(r.entryMinOutAtoms,'950');assert.equal(r.exitMinOutAtoms,'1895250');
  // Previous admission used this worst-case value, despite the expected route losing only 1.25% incl. fee caps.
  assert(2000000n-BigInt(exit.outUsd)+20000n>100000n);
});
test('expected cost above the configured 5% still rejects; no risk limit is raised',()=>{
  assert.equal(entryEconomics(2000000n,entry,{...exit,expectedOutUsd:'1800000'},5).acceptable,false);
  assert.throws(()=>entryEconomics(2000000n,entry,{...exit,inAtoms:'950'},5),/quote_mismatch/);
  assert.throws(()=>entryEconomics(2000000n,entry,{...exit,expectedOutUsd:undefined},5),/expected_exit_quote_value_missing/);
});
test('balance read cache coalesces concurrent requests, expires and never serves a failed refresh',async()=>{
  let now=0,calls=0;const cache=new ReadCache<string,bigint>(3000,()=>now);
  const load=async()=>{calls++;return 10n;};
  assert.deepEqual(await Promise.all([cache.get('SOL',load),cache.get('SOL',load)]),[10n,10n]);assert.equal(calls,1);
  now=2999;await cache.get('SOL',load);assert.equal(calls,1);
  now=3001;await assert.rejects(cache.get('SOL',async()=>{throw Error('RPC 429');}),/429/);
  assert.equal(await cache.get('SOL',async()=>{calls++;return 0n;}),0n);assert.equal(calls,2);
});
test('invalidation prevents an older in-flight read from repopulating the cache',async()=>{
  const cache=new ReadCache<string,bigint>(3000);let release!:(v:bigint)=>void;
  const old=cache.get('SOL',()=>new Promise<bigint>(r=>{release=r;}));await Promise.resolve();
  cache.invalidate();assert.equal(await cache.get('SOL',async()=>0n),0n);
  release(10n);await old;assert.equal(await cache.get('SOL',async()=>99n),0n);
});
test('actual ChainExecutor balance adapter shares SOL reads and invalidates after wallet changes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'spe-wallet-cache-'));
  try{
    const wallet=Keypair.generate(),path=join(dir,'fixture.json');writeFileSync(path,JSON.stringify([...wallet.secretKey]),{mode:0o600});
    const cfg=loadConfig({WALLET_KEYPAIR_PATH:path});let calls=0,balance=50000;
    const rpc={getBalance:async()=>{calls++;return balance;}} as unknown as Connection;
    const executor=new ChainExecutor(rpc,new Prices(),cfg);
    assert.deepEqual(await Promise.all([executor.balance(SOL),executor.balance(SOL),executor.balance(SOL)]),[50000n,50000n,50000n]);
    assert.equal(calls,1);balance=0;executor.invalidateReads();assert.equal(await executor.balance(SOL),0n);assert.equal(calls,2);
  }finally{rmSync(dir,{recursive:true});}
});
test('mint validation decodes the fetched account instead of fetching it a second time',async()=>{
  const mint=Keypair.generate().publicKey,data=Buffer.alloc(MintLayout.span);
  MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,supply:1000000n,decimals:6,isInitialized:true,
    freezeAuthorityOption:0,freezeAuthority:PublicKey.default},data);
  let calls=0;const rpc={getAccountInfo:async()=>{calls++;return {data,owner:TOKEN_PROGRAM_ID,lamports:1000,executable:false,rentEpoch:0};}} as unknown as Connection;
  const executor=new ChainExecutor(rpc,new Prices(),loadConfig());
  assert.equal((await executor.mint(mint.toBase58())).supply,1000000n);await executor.mint(mint.toBase58());assert.equal(calls,1);
});
test('keyless Jupiter cannot be configured above .5 RPS',()=>{
  assert.equal(new JupiterV2('https://api.jup.ag/swap/v2','',1).effectiveRps,.5);
  assert.equal(new JupiterV2('https://api.jup.ag/swap/v2','fixture-key',1).effectiveRps,1);
});
test('production quote adapter preserves expected output separately from protected output',async()=>{
  const prices=new Prices();prices.update(USDC,1);prices.update(SOL,100);
  const executor=new ChainExecutor({} as Connection,prices,loadConfig());
  executor.jupiter.build=async()=>({inputMint:USDC,outputMint:SOL,inAmount:'2000000',outAmount:'20000000',otherAmountThreshold:'19000000',
    slippageBps:500,priceImpactPct:'0',routePlan:[{}]} as any);
  const q=await executor.quote(USDC,SOL,2000000n);
  assert.equal(q.expectedOutUsd,'2000000');assert.equal(q.outUsd,'1900000');assert.equal(q.minOutAtoms,'19000000');
});
test('Jupiter 429 does not fall through to another RPC-heavy curve attempt',async()=>{
  const prices=new Prices();prices.update(USDC,1);prices.update(SOL,100);
  const cfg=loadConfig({ENABLE_PUMP_CURVE:'true'}),executor=new ChainExecutor({} as Connection,prices,cfg);
  executor.jupiter.build=async()=>{throw new HttpError(429,'fixture',60000);};
  let curveCalls=0;executor.pump.fetchSellState=async()=>{curveCalls++;throw Error('Must not hit curve after rate limit');};
  await assert.rejects(executor.quote(USDC,SOL,2000000n),e=>e instanceof HttpError&&e.status===429);assert.equal(curveCalls,0);
});
test('API queue gives exits the next slot and maintains spacing under concurrent submissions',async()=>{
  let now=0,release!:(v:string)=>void;const seen:{name:string;at:number}[]=[];
  const gate=new RequestGate(2000,()=>now,async ms=>{now+=ms;});
  const first=gate.run(()=>{seen.push({name:'first',at:now});return new Promise<string>(r=>{release=r;});});
  const buy=gate.run(async()=>{seen.push({name:'buy',at:now});return 'buy';});
  const sell=gate.run(async()=>{seen.push({name:'sell',at:now});return 'sell';},true);
  release('first');await Promise.all([first,buy,sell]);
  assert.deepEqual(seen.map(x=>x.name),['first','sell','buy']);assert.deepEqual(seen.map(x=>x.at),[0,2000,4000]);
});
test('429 Retry-After prevents queued requests from escaping the cooldown',async()=>{
  let now=0,calls=0;const gate=new RequestGate(2000,()=>now,async ms=>{now+=ms;});
  const first=gate.run(async()=>{calls++;throw new HttpError(429,'fixture',60000);});
  const queued=gate.run(async()=>{calls++;return true;});
  const result=await Promise.allSettled([first,queued]);assert.equal(result[0]!.status,'rejected');assert.equal(result[1]!.status,'rejected');
  assert.equal(calls,1);assert.equal(now,60000);
  await gate.run(async()=>{calls++;return true;});assert.equal(calls,2);
});
test('HTTP adapter preserves Retry-After rather than discarding provider feedback',async()=>{
  const server=createServer((_,res)=>res.writeHead(429,{'Retry-After':'60'}).end());
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  try{
    const address=server.address();assert(address&&typeof address!=='string');
    await assert.rejects(getJson(`http://127.0.0.1:${address.port}/`),e=>e instanceof HttpError&&e.retryAfterMs===60000&&retryDelay(e)===60000);
  }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
test('40 simultaneous BUY signals admit one attempt, preserving minOut and cash limits',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'spe-entry-storm-')),store=new Store(dir),cfg=loadConfig();cfg.MODE='paper';
  const prices=new Prices();prices.update(USDC,1);prices.update(SOL,100);
  let release!:()=>void,calls=0,exitAmount=0n,invalidations=0;
  const ex:Executor={quote:async(input,output,amount)=>{
    calls++;
    if(input===USDC){await new Promise<void>(r=>{release=r;});return {...entry,outputMint:output};}
    exitAmount=amount;return {...exit,inputMint:input};
  },balance:async()=>{throw Error('Paper must not read wallet');},prepare:async()=>{throw Error('Paper must not sign');},broadcast:async()=>{},reconcile:async()=>({status:'pending'}),invalidateReads:()=>{invalidations++;}};
  const engine=new Engine(cfg,store,ex,prices),now=Date.now();
  const current=(mint:string):Market=>({mint,symbol:mint,source:'fixture',receivedAt:now,priceUsd:1.12,liquidityUsd:50000,buys:80,sells:20,volumeUsd:2000,change5m:20,trending:true});
  const warm=(mint:string)=>engine.history.set(mint+':fixture',[
    {...current(mint),receivedAt:now-30000,priceUsd:1,volumeUsd:1000},
    {...current(mint),receivedAt:now-15000,priceUsd:1.05,volumeUsd:1500}]);
  try{
    warm('T0');const active=engine.market(current('T0'));await Promise.resolve();
    const rest=[];for(let i=1;i<40;i++){const m='T'+i;warm(m);rest.push(engine.market(current(m)));}
    await Promise.all(rest);assert.equal(calls,1);release();await active;
    assert.equal(calls,2);assert.equal(exitAmount,1000n);assert.equal(store.positions().length,1);
    assert.equal(invalidations,1);
    assert.equal(store.positions()[0]!.atoms,'950');assert.equal(store.pending().length,0);
    assert.equal(store.recent(500).filter(e=>e.kind==='entry_admitted').length,1);
    warm('NEXT');await engine.market(current('NEXT'));assert.equal(calls,2);
  }finally{store.close();rmSync(dir,{recursive:true});}
});
