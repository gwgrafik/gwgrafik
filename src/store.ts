import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Fill, Intent, Market, Position } from './types.js';
import { json } from './types.js';
import { applySale } from './policy.js';
export class Store {
  db: DatabaseSync;
  constructor(dir: string) {
    mkdirSync(dir,{recursive:true,mode:0o700});
    this.db=new DatabaseSync(join(dir,'engine.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS positions(id TEXT PRIMARY KEY,mint TEXT NOT NULL,active INTEGER NOT NULL,payload TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_position ON positions(mint) WHERE active=1;
      CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY,mint TEXT,state TEXT,side TEXT,payload TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_pending ON intents(mint) WHERE state IN ('reserved','signed','submitted','unknown');
      CREATE TABLE IF NOT EXISTS fills(signature TEXT PRIMARY KEY,intent_id TEXT UNIQUE,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,at INTEGER,kind TEXT,mint TEXT,payload TEXT);
      CREATE TABLE IF NOT EXISTS markets(mint TEXT PRIMARY KEY,payload TEXT);
      CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS charges(signature TEXT PRIMARY KEY,at INTEGER,usd TEXT);
      CREATE TABLE IF NOT EXISTS dedup(key TEXT PRIMARY KEY,at INTEGER);
      CREATE TABLE IF NOT EXISTS realizations(signature TEXT PRIMARY KEY,at INTEGER,usd TEXT,strategy TEXT);
      CREATE TABLE IF NOT EXISTS lease(id INTEGER PRIMARY KEY,owner TEXT,expires INTEGER);
    `);
  }
  transaction<T>(f:()=>T):T { this.db.exec('BEGIN IMMEDIATE');try {const r=f();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;} }
  get<T>(key:string):T|undefined {const r=this.db.prepare('SELECT value FROM kv WHERE key=?').get(key);return r?JSON.parse(String(r.value)):undefined;}
  set(key:string,value:unknown){this.db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,json(value));}
  acquireLease(owner:string,now=Date.now()) {
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM lease WHERE id=1').get();
      if(row && row.owner!==owner && Number(row.expires)>now)throw new Error('Another engine owns this database');
      this.db.prepare('INSERT INTO lease VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires').run(owner,now+30_000);
    });
  }
  assertLease(owner:string){const row=this.db.prepare('SELECT owner,expires FROM lease WHERE id=1').get();if(!row||row.owner!==owner||Number(row.expires)<=Date.now())throw new Error('Engine lease lost');}
  releaseLease(owner:string){this.db.prepare('DELETE FROM lease WHERE id=1 AND owner=?').run(owner);}
  event(kind:string,payload:unknown,mint=''){this.db.prepare('INSERT INTO events(at,kind,mint,payload) VALUES(?,?,?,?)').run(Date.now(),kind,mint,json(payload));}
  market(m:Market){this.db.prepare('INSERT INTO markets VALUES(?,?) ON CONFLICT(mint) DO UPDATE SET payload=excluded.payload').run(m.mint,json(m));this.event('market',m,m.mint);}
  markets():Market[]{return this.db.prepare('SELECT payload FROM markets').all().map(r=>JSON.parse(String(r.payload)));}
  positions(activeOnly=true):Position[]{return this.db.prepare(`SELECT payload FROM positions ${activeOnly?'WHERE active=1':''}`).all().map(r=>JSON.parse(String(r.payload)));}
  savePosition(p:Position){this.db.prepare('INSERT INTO positions VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active,payload=excluded.payload').run(p.id,p.mint,p.status==='closed'?0:1,json(p));}
  pending():Intent[]{return this.db.prepare("SELECT payload FROM intents WHERE state IN ('reserved','signed','submitted','unknown')").all().map(r=>JSON.parse(String(r.payload)));}
  saveIntent(i:Intent){this.db.prepare('INSERT INTO intents VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,payload=excluded.payload').run(i.id,i.mint,i.state,i.side,json(i));}
  reserve(i:Intent,limits:{maxPositions:number;maxCapital:bigint;cash:bigint;entryCost:bigint}){
    return this.transaction(()=>{
      if(this.pending().some(p=>p.mint===i.mint))throw new Error('duplicate_pending');
      if(i.side==='buy') {
        const open=this.positions(),pending=this.pending().filter(p=>p.side==='buy');
        if(open.some(p=>p.mint===i.mint))throw new Error('duplicate_position');
        if(open.length+pending.length>=limits.maxPositions)throw new Error('position_limit');
        const held=pending.reduce((s,p)=>s+BigInt((p.quote.raw as {inputUsd?:string})?.inputUsd??'0')+BigInt(p.quote.networkFeeUsd),0n);
        const used=open.reduce((s,p)=>s+BigInt(p.basisRemainingUsd),0n);
        if(used+held+limits.entryCost>limits.maxCapital)throw new Error('capital_limit');
        if(held+limits.entryCost>limits.cash)throw new Error('cash_reserve');
      } else {
        const p=this.positions().find(p=>p.id===i.positionId);
        if(!p || BigInt(i.quote.inAtoms)>BigInt(p.atoms))throw new Error('invalid_sell');
      }
      this.saveIntent(i);
    });
  }
  commitFill(i:Intent,f:Fill) {
    return this.transaction(()=>{
      if(this.db.prepare('SELECT signature FROM fills WHERE intent_id=?').get(i.id))return false;
      if(i.side==='buy') {
        const cost=BigInt(f.inputUsd)+BigInt(f.networkFeeUsd);
        this.savePosition({id:randomUUID(),mint:i.mint,strategy:i.strategy,openedAt:f.confirmedAt,
          originalAtoms:f.outAtoms,atoms:f.outAtoms,spentUsd:f.inputUsd,entryFeeUsd:f.networkFeeUsd,
          proceedsUsd:'0',realizedUsd:'0',basisRemainingUsd:cost.toString(),recovered:false,tiers:[],
          peakValueUsd:'0',lastPeakAt:f.confirmedAt,status:'open'});
      } else {
        const p=this.positions().find(p=>p.id===i.positionId);
        if(!p)throw new Error('Position missing during reconciliation');
        const before=BigInt(p.realizedUsd);
        applySale(p,BigInt(f.inAtoms),BigInt(f.outputUsd)-BigInt(f.networkFeeUsd),i.reason,i.tier);
        this.savePosition(p);
        this.db.prepare('INSERT INTO realizations VALUES(?,?,?,?)').run(f.signature,f.confirmedAt,(BigInt(p.realizedUsd)-before).toString(),i.strategy);
      }
      this.db.prepare('INSERT INTO fills VALUES(?,?,?)').run(f.signature,i.id,json(f));
      if(f.simulated){
        const cash=BigInt(this.get<string>('paper_cash')??'0');
        const delta=i.side==='buy'?-BigInt(f.inputUsd)-BigInt(f.networkFeeUsd):BigInt(f.outputUsd)-BigInt(f.networkFeeUsd);
        if(cash+delta<0n)throw new Error('paper_cash_insufficient');
        this.set('paper_cash',(cash+delta).toString());
      }
      i.state='confirmed';this.saveIntent(i);this.event('fill',{intent:i,fill:f},i.mint);
      return true;
    });
  }
  recent(limit=100){return this.db.prepare('SELECT at,kind,mint,payload FROM events ORDER BY id DESC LIMIT ?').all(limit).map(r=>({...r,payload:JSON.parse(String(r.payload))}));}
  fills():Fill[]{return this.db.prepare('SELECT payload FROM fills').all().map(r=>JSON.parse(String(r.payload)));}
  charge(signature:string,microUsd:string){this.db.prepare('INSERT OR IGNORE INTO charges VALUES(?,?,?)').run(signature,Date.now(),microUsd);}
  charges(since=0):bigint{return this.db.prepare('SELECT usd FROM charges WHERE at>=?').all(since).reduce((s,r)=>s+BigInt(String(r.usd)),0n);}
  realizedSince(since:number):bigint{return this.db.prepare('SELECT usd FROM realizations WHERE at>=?').all(since).reduce((s,r)=>s+BigInt(String(r.usd)),0n);}
  first(key:string){return this.db.prepare('INSERT OR IGNORE INTO dedup VALUES(?,?)').run(key,Date.now()).changes===1;}
  retention(){
    this.db.prepare("DELETE FROM events WHERE (at<? OR id<(SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET 200000)) AND kind IN ('market','flow','decision','wallet_entry_candidate','mark')").run(Date.now()-86400000);
    this.db.prepare('DELETE FROM dedup WHERE at<?').run(Date.now()-7*86400000);
  }
  close(){this.db.close();}
}
